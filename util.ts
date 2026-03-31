import { createLogger } from "./lib/logger.ts";
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

/**
 * Check if model is usable based on size constraints and naming
 * Used by NVIDIA provider to filter out test/debug and small models.
 * Extracts model size from ID (e.g., "llama-3-70b" -> 70) and compares to minSizeB.
 */
export function isUsableModel(modelId: string, minSizeB?: number): boolean {
	// Filter out models that are likely test or debug models
	if (modelId.includes("test") || modelId.includes("debug")) {
		return false;
	}

	// Filter by minimum size if specified
	if (minSizeB !== undefined) {
		// Check Mixture-of-Experts models first (e.g., "8x22b" = 176b total)
		const moeMatch = modelId.match(/(\d+)x(\d+(?:\.\d+)?)b/i);
		if (moeMatch) {
			const experts = Number.parseInt(moeMatch[1], 10);
			const expertSize = Number.parseFloat(moeMatch[2]);
			if (experts * expertSize < minSizeB) return false;
			return true; // MoE model passed size check
		}

		// Standard model size (e.g., "70b", "8b")
		const sizeMatch = modelId.match(/(\d+(?:\.\d+)?)b(?!\w)/i);
		if (sizeMatch) {
			const modelSize = Number.parseFloat(sizeMatch[1]);
			if (modelSize < minSizeB) return false;
		}
	}

	return true;
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
	const promptPrice = parseFloat(m.pricing?.prompt ?? "0");
	const completionPrice = parseFloat(m.pricing?.completion ?? "0");

	return {
		id: m.id,
		name: m.name,
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
