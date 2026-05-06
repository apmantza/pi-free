import { createLogger } from "./logger.ts";
import {
	getProxyModelCompat,
	isLikelyReasoningModel,
} from "./provider-compat.ts";
import type { ProviderModelConfig as PiProviderModelConfig } from "@mariozechner/pi-coding-agent";
import type { ProviderModelConfig } from "./types.ts";

const _logger = createLogger("util");

// =============================================================================
// Shared Utilities
// =============================================================================

/**
 * Log a warning message for provider operations
 */
export function logWarning(
	provider: string,
	message: string,
	error?: unknown,
): void {
	_logger.warn(
		`[${provider}] ${message}`,
		error ? { error: String(error) } : undefined,
	);
}

/**
 * Fetch with timeout using AbortController
 */
export async function fetchWithTimeout(
	url: string,
	options: RequestInit,
	timeoutMs = 30000,
): Promise<Response> {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const response = await fetch(url, {
			...options,
			signal: controller.signal,
		});
		return response;
	} finally {
		clearTimeout(timeoutId);
	}
}

/**
 * Fetch with retry logic and timeout
 */
export async function fetchWithRetry(
	url: string,
	options: RequestInit,
	retries = 3,
	delayMs = 1000,
	timeoutMs = 30000,
): Promise<Response> {
	let lastError: unknown;

	for (let i = 0; i < retries; i++) {
		try {
			const response = await fetchWithTimeout(url, options, timeoutMs);
			if (response.ok) return response;

			// If it's a rate limit, throw immediately
			if (response.status === 429) {
				throw new Error(`Rate limited (429)`);
			}

			// For server errors, retry
			if (response.status >= 500) {
				lastError = new Error(`Server error ${response.status}`);
				if (i < retries - 1) {
					await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
					continue;
				}
				// Last retry exhausted - throw the error
				throw lastError;
			}

			return response; // Return non-ok but non-retryable responses
		} catch (error) {
			lastError = error;
			if (i < retries - 1) {
				await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
			}
		}
	}

	throw lastError;
}

// =============================================================================
// Shared API Response Parsing
// =============================================================================

/**
 * Parse and validate model list API response
 * Shared between Kilo, OpenRouter, and other providers
 */
export async function parseModelResponse<T>(
	response: Response,
	providerName: string,
): Promise<{ data: T[] }> {
	if (!response.ok) {
		throw new Error(
			`Failed to fetch ${providerName} models: ${response.status} ${response.statusText}`,
		);
	}

	const json = (await response.json()) as { data?: T[] };

	if (!json.data || !Array.isArray(json.data)) {
		throw new Error(
			`Invalid ${providerName} models response: missing data array`,
		);
	}

	return { data: json.data };
}

// =============================================================================
// Model Filtering Utilities
// =============================================================================

// Models known to be small (no "Xb" in their ID) that should be filtered.
// Updated as new small free models appear on OpenRouter/Kilo.
const KNOWN_SMALL_MODELS: ReadonlySet<string> = new Set([
	// Microsoft Phi models (1.5B–14B)
	"microsoft/phi-3-mini-128k-instruct",
	"microsoft/phi-3-mini-4k-instruct",
	"microsoft/phi-3-small-128k-instruct",
	"microsoft/phi-3-small-8k-instruct",
	"microsoft/phi-3-medium-128k-instruct",
	"microsoft/phi-3-medium-4k-instruct",
	"microsoft/phi-3.5-mini-instruct",
	"microsoft/phi-4-mini-instruct",
	"microsoft/phi-4-mini-reasoning",
	"microsoft/phi-4-reasoning-plus",
	// OpenChat (7B)
	"openchat/openchat-3.5-0106",
	"openchat/openchat-3.5-1210",
	// Mistral 7B variants
	"mistralai/mistral-7b-instruct-v0.1",
	"mistralai/mistral-7b-instruct-v0.2",
	"mistralai/mistral-7b-instruct-v0.3",
	// Gemma small variants
	"google/gemma-2b-it",
	"google/gemma-1.1-2b-it",
	// DeepSeek small variants
	"deepseek/deepseek-r1-distill-qwen-1.5b",
	"deepseek/deepseek-r1-distill-llama-8b",
	"deepseek/deepseek-r1-distill-qwen-7b",
	"deepseek/deepseek-r1-distill-qwen-14b",
	// Stripe Hyena (2.7B)
	"togethercomputer/stripedhy-2.7b",
	// TinyLlama
	"tinyllama/tinyllama-1.1b-chat-v1.0",
]);

/**
 * Check if model is usable based on size constraints and naming.
 * Extracts model size from ID (e.g., "llama-3-70b" -> 70) and compares to minSizeB.
 * Falls back to a blocklist for models that don't encode size in the name.
 */
export function isUsableModel(modelId: string, minSizeB?: number): boolean {
	// Filter out models that are likely test or debug models
	if (modelId.includes("test") || modelId.includes("debug")) {
		return false;
	}

	// Filter by minimum size if specified
	if (minSizeB !== undefined) {
		// Known-small blocklist (models without "Xb" in the name)
		// Strip :free suffix used by OpenRouter/Kilo
		const baseId = modelId.replace(/:free$/, "");
		if (KNOWN_SMALL_MODELS.has(baseId)) return false;

		// Check Mixture-of-Experts models first (e.g., "8x22b" = 176b total)
		const parsed = parseModelSize(modelId);
		if (parsed?.type === "moe") {
			if (parsed.experts * parsed.sizePerExpert < minSizeB) return false;
			return true; // MoE model passed size check
		}

		// Standard model size (e.g., "70b", "8b")
		if (parsed?.type === "standard" && parsed.size < minSizeB) return false;
	}

	return true;
}

// =============================================================================
// Model Size Parsing (no regex — avoids SonarCloud S5852 flags)
// =============================================================================

interface MoeSize {
	type: "moe";
	experts: number;
	sizePerExpert: number;
}

interface StandardSize {
	type: "standard";
	size: number;
}

/**
 * Extract model size from a model ID without using regex.
 * Handles both MoE ("8x22b") and standard ("70b", "8b") formats.
 */
/**
 * Parse MoE (Mixture of Experts) model size like "8x22b".
 */
function parseMoeSize(lower: string): MoeSize | null {
	let searchPos = 0;
	while (true) {
		const xIdx = lower.indexOf("x", searchPos);
		if (xIdx <= 0) break;
		const beforeChar = lower[xIdx - 1];
		if (!(beforeChar >= "0" && beforeChar <= "9")) {
			searchPos = xIdx + 1;
			continue;
		}
		const bIdx = lower.indexOf("b", xIdx + 1);
		if (bIdx <= xIdx + 1) {
			searchPos = xIdx + 1;
			continue;
		}
		let countStart = xIdx - 1;
		while (
			countStart > 0 &&
			lower[countStart - 1] >= "0" &&
			lower[countStart - 1] <= "9"
		) {
			countStart--;
		}
		const experts = Number.parseInt(lower.slice(countStart, xIdx), 10);
		const size = Number.parseFloat(lower.slice(xIdx + 1, bIdx));
		if (
			!Number.isNaN(experts) &&
			!Number.isNaN(size) &&
			experts > 0 &&
			size > 0
		) {
			const afterB = lower.slice(bIdx + 1);
			if (
				afterB.length === 0 ||
				((afterB[0] < "0" || afterB[0] > "9") && afterB[0] !== ".")
			) {
				return { type: "moe", experts, sizePerExpert: size };
			}
		}
		searchPos = xIdx + 1;
	}
	return null;
}

/**
 * Parse standard model size like "70b" or "8b".
 */
function parseStandardSize(lower: string): StandardSize | null {
	for (let i = 0; i < lower.length; i++) {
		if (lower[i] !== "b") continue;
		const afterB = lower.slice(i + 1);
		if (
			afterB.length > 0 &&
			((afterB[0] >= "0" && afterB[0] <= "9") || afterB[0] === ".")
		) {
			continue; // b followed by digit or dot — not our match
		}
		let start = i;
		while (
			start > 0 &&
			((lower[start - 1] >= "0" && lower[start - 1] <= "9") ||
				lower[start - 1] === ".")
		) {
			start--;
		}
		if (start < i) {
			const numStr = lower.slice(start, i);
			const size = Number.parseFloat(numStr);
			if (!Number.isNaN(size) && size > 0) {
				return { type: "standard", size };
			}
		}
		break;
	}
	return null;
}

function parseModelSize(modelId: string): MoeSize | StandardSize | null {
	const lower = modelId.toLowerCase();
	return parseMoeSize(lower) ?? parseStandardSize(lower) ?? null;
}

// =============================================================================
// Model Name Cleaning
// =============================================================================

/**
 * Strip provider prefix from model names.
 * OpenRouter/Kilo return names like "Provider : Model Name" or "Provider / Model Name".
 * We only want the model name part.
 */
export function cleanModelName(name: string): string {
	// Handle patterns like "Provider : Model Name" or "Provider / Model Name"
	const colonIdx = name.indexOf(":");
	const slashIdx = name.indexOf("/");
	const idx =
		colonIdx === -1
			? slashIdx
			: slashIdx === -1
				? colonIdx
				: Math.min(colonIdx, slashIdx);
	if (idx > 0) {
		return name.slice(idx + 1).trim();
	}
	return name.trim();
}

// =============================================================================
// Model Mapping
// =============================================================================

/**
 * Map OpenRouter/Kilo API model to ProviderModelConfig
 * Shared between OpenRouter and Kilo providers
 */
export function mapOpenRouterModel(m: {
	id: string;
	name: string;
	context_length?: number;
	max_completion_tokens?: number | null;
	top_provider?: { max_completion_tokens?: number | null };
	pricing?: { prompt?: string | null; completion?: string | null };
	architecture?: {
		input_modalities?: string[] | null;
		output_modalities?: string[] | null;
	};
}): ProviderModelConfig {
	const promptPrice = Number.parseFloat(m.pricing?.prompt ?? "0");
	const completionPrice = Number.parseFloat(m.pricing?.completion ?? "0");

	return {
		id: m.id,
		name: cleanModelName(m.name),
		reasoning: false, // OpenRouter doesn't expose reasoning flag directly
		input: m.architecture?.input_modalities?.includes("image")
			? (["text", "image"] as const)
			: (["text"] as const),
		cost: {
			input: promptPrice,
			output: completionPrice,
			cacheRead: 0,
			cacheWrite: 0,
		},
		contextWindow: m.context_length ?? 4096,
		maxTokens:
			m.max_completion_tokens ?? m.top_provider?.max_completion_tokens ?? 4096,
	};
}

// =============================================================================
// OpenAI-Compatible Provider Helpers
// =============================================================================

/**
 * Defaults for mapping models from OpenAI-compatible /v1/models endpoints.
 */
export interface OpenAIModelDefaults {
	/** Per-model cost defaults (set to 0 if provider is free-tier). */
	cost?: { input: number; output: number };
	/** Default context window (tokens). */
	contextWindow?: number;
	/** Default max output tokens. */
	maxTokens?: number;
	/** Default input modalities. */
	input?: string[];
}

/**
 * Generic model shape returned by OpenAI-compatible /v1/models endpoints.
 */
export interface OpenAIModelEntry {
	id: string;
	object?: string;
	created?: number;
	owned_by?: string;
}

/**
 * Fetch and map models from an OpenAI-compatible /v1/models endpoint.
 *
 * Eliminates ~40 lines of duplicated fetch→parse→map boilerplate
 * that was repeated in CrofAI, DeepInfra, and SambaNova providers.
 */
export async function fetchOpenAICompatibleModels(
	providerId: string,
	baseUrl: string,
	apiKey: string,
	defaults: OpenAIModelDefaults = {},
): Promise<PiProviderModelConfig[]> {
	const logger = createLogger(providerId);

	logger.info(`[${providerId}] Fetching models...`);

	try {
		const response = await fetchWithRetry(
			`${baseUrl}/models`,
			{
				headers: {
					Authorization: `Bearer ${apiKey}`,
					"Content-Type": "application/json",
				},
			},
			3,
			1000,
			30000,
		);

		if (!response.ok) {
			throw new Error(`${providerId} API error: ${response.status}`);
		}

		const data = (await response.json()) as { data?: OpenAIModelEntry[] };
		const models = data.data ?? [];

		logger.info(`[${providerId}] Fetched ${models.length} models`);

		return models
			.filter((m) => m.id)
			.map((m): PiProviderModelConfig => {
				const name = m.id.split("/").pop() || m.id;
				return {
					id: m.id,
					name,
					reasoning: isLikelyReasoningModel({ id: m.id, name }),
					input: (defaults.input as PiProviderModelConfig["input"]) ?? ["text"],
					cost: {
						input: defaults.cost?.input ?? 0,
						output: defaults.cost?.output ?? 0,
						cacheRead: 0,
						cacheWrite: 0,
					},
					contextWindow: defaults.contextWindow ?? 128_000,
					maxTokens: defaults.maxTokens ?? 4_096,
					compat: getProxyModelCompat({ id: m.id, name }),
				};
			});
	} catch (error) {
		logger.error(`[${providerId}] Failed to fetch models:`, {
			error: error instanceof Error ? error.message : String(error),
		});
		return [];
	}
}
