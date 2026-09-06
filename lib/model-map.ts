/**
 * Model mapping, filtering, and OpenAI-compatible catalog fetching.
 *
 * Split out of lib/util.ts (arch lifecycle review): this module owns
 * everything that shapes provider model lists. Fetch primitives live
 * in lib/fetch.ts; lib/util.ts re-exports both so existing importers
 * are untouched.
 */

import { createLogger } from "./logger.ts";
import { fetchWithRetry } from "./fetch.ts";
import { safeEnrichModelsWithModelsDev } from "./model-metadata.ts";
import {
	getProxyModelCompat,
	isLikelyReasoningModel,
} from "./provider-compat.ts";
import type { ProviderModelConfig as PiProviderModelConfig } from "@earendil-works/pi-coding-agent";
import type { ProviderModelConfig } from "./types.ts";

/**
 * Optional callbacks that providers can pass to
 * `fetchOpenAICompatibleModels` to override default reasoning/compat
 * detection logic. Keeping these as injected dependencies (rather
 * than hard-coding `isLikelyReasoningModel` / `getProxyModelCompat`)
 * lets `lib/util.ts` stay decoupled from `lib/provider-compat.ts`.
 */
export interface OpenAIModelCallbacks {
	/**
	 * Determine whether a model is a reasoning model.
	 * If omitted, defaults to `isLikelyReasoningModel` from provider-compat.
	 */
	detectReasoning?: (model: { id: string; name?: string }) => boolean;
	/**
	 * Determine proxy-compat overrides for a model.
	 * If omitted, defaults to `getProxyModelCompat` from provider-compat.
	 */
	getProxyCompat?: (model: {
		id: string;
		name?: string;
	}) => PiProviderModelConfig["compat"] | undefined;
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
	let idx = -1;
	if (colonIdx === -1 && slashIdx === -1) {
		// Neither found — return trimmed name as-is
		return name.trim();
	}
	if (colonIdx === -1) {
		// Only slash found
		idx = slashIdx;
	} else if (slashIdx === -1) {
		// Only colon found
		idx = colonIdx;
	} else {
		// Both found — use the earliest
		idx = Math.min(colonIdx, slashIdx);
	}
	return name.slice(idx + 1).trim();
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
	top_provider?: {
		context_length?: number | null;
		max_completion_tokens?: number | null;
	};
	pricing?: {
		prompt?: string | null;
		completion?: string | null;
		input_cache_read?: string | null;
		input_cache_write?: string | null;
	};
	architecture?: {
		input_modalities?: string[] | null;
		output_modalities?: string[] | null;
	};
	supported_parameters?: string[] | null;
	isFree?: boolean;
}): ProviderModelConfig {
	const promptPrice = Number.parseFloat(m.pricing?.prompt ?? "0");
	const completionPrice = Number.parseFloat(m.pricing?.completion ?? "0");
	const cacheReadPrice = Number.parseFloat(m.pricing?.input_cache_read ?? "0");
	const cacheWritePrice = Number.parseFloat(m.pricing?.input_cache_write ?? "0");
	const supportedParameters = m.supported_parameters ?? [];
	const reasoning =
		supportedParameters.includes("reasoning") ||
		supportedParameters.includes("reasoning_effort");

	return {
		id: m.id,
		name: cleanModelName(m.name),
		reasoning,
		...(reasoning && { thinkingLevelMap: { off: "none" } }),
		input: m.architecture?.input_modalities?.includes("image")
			? (["text", "image"] as const)
			: (["text"] as const),
		cost: {
			input: promptPrice,
			output: completionPrice,
			cacheRead: cacheReadPrice,
			cacheWrite: cacheWritePrice,
		},
		contextWindow: m.context_length ?? m.top_provider?.context_length ?? 4096,
		maxTokens:
			m.max_completion_tokens ?? m.top_provider?.max_completion_tokens ?? 4096,
		_pricingKnown: true,
		...(typeof m.isFree === "boolean" && {
			_freeKnown: true,
			_isFree: m.isFree,
		}),
	} as ProviderModelConfig & {
		_pricingKnown?: boolean;
		_freeKnown?: boolean;
		_isFree?: boolean;
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
 *
 * Some providers (SambaNova, DeepInfra) return extended fields beyond
 * the standard OpenAI format. We accept them loosely and use what's
 * available, falling back to defaults otherwise.
 */
interface OpenAIModelEntry {
	id: string;
	object?: string;
	created?: number;
	owned_by?: string;
	/** Extended: per-model reasoning capability (some providers expose this) */
	reasoning?: boolean;
	/** Extended: input modalities (some providers expose this) */
	input_modalities?: string[];
	/** Extended: per-model context length (SambaNova, etc.) */
	context_length?: number;
	/** Extended: alternate field name for context length */
	max_context_length?: number;
	/** Extended: alternate field name for context length (snake_case) */
	context_window?: number;
	/** Extended: per-model max completion tokens (SambaNova, etc.) */
	max_completion_tokens?: number;
	/** Extended: alternate field name for max tokens */
	max_tokens?: number;
	/** Extended: per-model pricing (SambaNova, etc.) */
	pricing?: { prompt?: string | number; completion?: string | number };
	/** Extended: authoritative free/paid flag (camelCase, OpenRouter convention). */
	isFree?: boolean;
	/** Extended: authoritative free/paid flag (snake_case, GMI Cloud convention). */
	is_free?: boolean;
}

/**
 * Fetch and map models from an OpenAI-compatible /v1/models endpoint.
 *
 * Eliminates ~40 lines of duplicated fetch→parse→map boilerplate
 * that was repeated in CrofAI, DeepInfra, and SambaNova providers.
 */
/**
 * Per-model field resolvers for `fetchOpenAICompatibleModels` (arch
 * lifecycle review). Each gateway names the same datum differently
 * (`context_length` vs `max_context_length` vs `context_window`, …), so
 * every resolver tries the per-model fields first and falls back to the
 * provider defaults. Split out of one 24-complexity inline `.map`
 * callback so each rule reads — and tests — in isolation.
 */
function resolveOpenAIContextWindow(
	m: OpenAIModelEntry,
	defaults: OpenAIModelDefaults,
): number {
	return (
		m.context_length ??
		m.max_context_length ??
		m.context_window ??
		defaults.contextWindow ??
		128_000
	);
}

function resolveOpenAIMaxTokens(
	m: OpenAIModelEntry,
	defaults: OpenAIModelDefaults,
): number {
	return (
		m.max_completion_tokens ?? m.max_tokens ?? defaults.maxTokens ?? 4_096
	);
}

function resolveOpenAIReasoning(
	m: OpenAIModelEntry,
	name: string,
	detectReasoning: (model: { id: string; name?: string }) => boolean,
): boolean {
	return m.reasoning ?? detectReasoning({ id: m.id, name });
}

function resolveOpenAIInput(
	m: OpenAIModelEntry,
	defaults: OpenAIModelDefaults,
): PiProviderModelConfig["input"] {
	const hasVision = m.input_modalities?.includes("image") ?? false;
	return (
		(defaults.input as PiProviderModelConfig["input"]) ??
		(hasVision ? ["text", "image"] : ["text"])
	);
}

function resolveOpenAIModelCost(
	m: OpenAIModelEntry,
	defaults: OpenAIModelDefaults,
): { input: number; output: number; pricingKnown: boolean } {
	const apiInput =
		typeof m.pricing?.prompt === "number" ||
		typeof m.pricing?.prompt === "string"
			? Number(m.pricing.prompt)
			: undefined;
	const apiOutput =
		typeof m.pricing?.completion === "number" ||
		typeof m.pricing?.completion === "string"
			? Number(m.pricing.completion)
			: undefined;
	return {
		input: apiInput ?? defaults.cost?.input ?? 0,
		output: apiOutput ?? defaults.cost?.output ?? 0,
		pricingKnown: m.pricing !== undefined,
	};
}

function mapOpenAIEntry(
	m: OpenAIModelEntry,
	defaults: OpenAIModelDefaults,
	detectReasoning: (model: { id: string; name?: string }) => boolean,
	getCompat: (model: {
		id: string;
		name?: string;
	}) => PiProviderModelConfig["compat"] | undefined,
): PiProviderModelConfig {
	const name = m.id.split("/").pop() || m.id;
	const reasoning = resolveOpenAIReasoning(m, name, detectReasoning);
	const cost = resolveOpenAIModelCost(m, defaults);
	return {
		id: m.id,
		name,
		reasoning,
		input: resolveOpenAIInput(m, defaults),
		cost: {
			input: cost.input,
			output: cost.output,
			cacheRead: 0,
			cacheWrite: 0,
		},
		contextWindow: resolveOpenAIContextWindow(m, defaults),
		maxTokens: resolveOpenAIMaxTokens(m, defaults),
		compat: getCompat({ id: m.id, name }),
		_pricingKnown: cost.pricingKnown,
		...((typeof m.isFree === "boolean" || typeof m.is_free === "boolean") && {
			_freeKnown: true,
			_isFree: (m.isFree ?? m.is_free) === true,
		}),
	} as PiProviderModelConfig & {
		_pricingKnown?: boolean;
		_freeKnown?: boolean;
		_isFree?: boolean;
	};
}

export async function fetchOpenAICompatibleModels(
	providerId: string,
	baseUrl: string,
	apiKey: string,
	defaults: OpenAIModelDefaults = {},
	callbacks: OpenAIModelCallbacks = {},
	signal?: AbortSignal,
): Promise<PiProviderModelConfig[]> {
	const logger = createLogger(providerId);
	const detectReasoning = callbacks.detectReasoning ?? isLikelyReasoningModel;
	const getCompat = callbacks.getProxyCompat ?? getProxyModelCompat;

	logger.info(`[${providerId}] Fetching models...`);

	try {
		const response = await fetchWithRetry(
			`${baseUrl}/models`,
			{
				headers: {
					// Public catalogs accept anonymous requests; an empty `Bearer `
					// header can be rejected by gateways that would otherwise
					// serve the endpoint anonymously.
					...(apiKey && { Authorization: `Bearer ${apiKey}` }),
					"Content-Type": "application/json",
				},
				signal,
			},
			3,
			1000,
			30000,
		);

		if (!response.ok) {
			throw new Error(`${providerId} API error: ${response.status}`);
		}

		const body = (await response.json()) as
			| OpenAIModelEntry[]
			| { data?: OpenAIModelEntry[] };
		const models = Array.isArray(body) ? body : (body.data ?? []);

		logger.info(`[${providerId}] Fetched ${models.length} models`);

		const mapped = models
			.filter((m) => m.id)
			.map((m) => mapOpenAIEntry(m, defaults, detectReasoning, getCompat));

		return await safeEnrichModelsWithModelsDev(mapped, { providerId });
	} catch (error) {
		// Abort is normal when Pi supersedes a refresh or the session closes.
		// It should not become a noisy provider failure in the console.
		if (signal?.aborted) {
			return [];
		}
		logger.error(`[${providerId}] Failed to fetch models:`, {
			error: error instanceof Error ? error.message : String(error),
		});
		return [];
	}
}
