/**
 * Shared model fetching for OpenRouter-compatible APIs.
 * Consolidates duplicate logic from openrouter.ts and kilo-models.ts
 */

import { DEFAULT_FETCH_TIMEOUT_MS, DEFAULT_MIN_SIZE_B } from "../constants.ts";
import type { ProviderModelConfig } from "../types.ts";
import { fetchWithRetry, isUsableModel, mapOpenRouterModel } from "../util.ts";

interface OpenRouterCompatibleModel {
	id: string;
	name: string;
	context_length: number;
	max_completion_tokens?: number | null;
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
	top_provider?: { max_completion_tokens?: number | null };
	supported_parameters?: string[];
}

interface FetchModelsOptions {
	/** Base URL for the API (e.g., https://api.openrouter.ai/api/v1) */
	baseUrl: string;
	/** API key for authentication (optional) */
	apiKey?: string;
	/** Only return free models (pricing === 0) */
	freeOnly?: boolean;
	/** Additional headers to include */
	extraHeaders?: Record<string, string>;
	/** Number of retries for failed requests */
	retries?: number;
	/** Delay between retries in ms */
	retryDelay?: number;
}

/**
 * Fetch models from an OpenRouter-compatible API.
 * Handles response parsing, filtering, and mapping to ProviderModelConfig.
 */
export async function fetchOpenRouterCompatibleModels(
	options: FetchModelsOptions,
): Promise<ProviderModelConfig[]> {
	const {
		baseUrl,
		apiKey,
		freeOnly = false,
		extraHeaders = {},
		retries = 3,
		retryDelay = 1000,
	} = options;

	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		"User-Agent": "pi-free-providers",
		...extraHeaders,
	};

	if (apiKey) {
		headers.Authorization = `Bearer ${apiKey}`;
	}

	const response = await fetchWithRetry(
		`${baseUrl}/models`,
		{
			headers,
			signal: AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS),
		},
		retries,
		retryDelay,
		DEFAULT_FETCH_TIMEOUT_MS,
	);

	if (!response.ok) {
		throw new Error(
			`Failed to fetch models: ${response.status} ${response.statusText}`,
		);
	}

	const json = (await response.json()) as {
		data?: OpenRouterCompatibleModel[];
	};

	if (!json.data || !Array.isArray(json.data)) {
		throw new Error("Invalid models response: missing data array");
	}

	return json.data
		.filter((m) => {
			// Filter out image generation models
			const outputMods = m.architecture?.output_modalities ?? [];
			if (outputMods.includes("image")) return false;

			// Filter by pricing if freeOnly
			if (freeOnly) {
				const prompt = parseFloat(m.pricing?.prompt ?? "1");
				const completion = parseFloat(m.pricing?.completion ?? "1");
				if (prompt !== 0 || completion !== 0) return false;
			}

			// Filter unusable and too-small models
			if (!isUsableModel(m.id, DEFAULT_MIN_SIZE_B)) return false;

			return true;
		})
		.map(mapOpenRouterModel);
}

/**
 * Fetch both free and all models in a single call.
 * Returns separate arrays for free and paid models.
 */
export async function fetchOpenRouterModelsWithFree(
	options: Omit<FetchModelsOptions, "freeOnly">,
): Promise<{ free: ProviderModelConfig[]; all: ProviderModelConfig[] }> {
	const all = await fetchOpenRouterCompatibleModels({
		...options,
		freeOnly: false,
	});

	const free = all.filter((m) => {
		const cost = m.cost;
		return cost && cost.input === 0 && cost.output === 0;
	});

	return { free, all };
}
