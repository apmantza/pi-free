/**
 * CrofAI Provider Extension
 *
 * Provides access to CrofAI API - OpenAI-compatible LLM inference service
 * hosting DeepSeek, Qwen, and other open-source models.
 *
 * NOTE: CrofAI's /v1/models returns per-model context_length, max_completion_tokens,
 * name, custom_reasoning, and reasoning_effort. Pricing is per-MILLION tokens.
 *
 * Setup:
 *   1. Get API key from https://ai.nahcrof.com
 *   2. Set CROFAI_API_KEY env var or add to ~/.pi/free.json
 *
 * Usage:
 *   pi install git:github.com/apmantza/pi-free
 *   # Set CROFAI_API_KEY env var
 *   # Models appear in /model selector
 */

import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import { getCrofaiApiKey, getCrofaiShowPaid } from "../../config.ts";
import {
	BASE_URL_CROFAI,
	DEFAULT_FETCH_TIMEOUT_MS,
	PROVIDER_CROFAI,
} from "../../constants.ts";
import { createLogger } from "../../lib/logger.ts";
import { safeEnrichModelsWithModelsDev } from "../../lib/model-metadata.ts";
import {
	getProxyModelCompat,
	isLikelyReasoningModel,
} from "../../lib/provider-compat.ts";
import { registerNativeOpenAIProvider } from "../../lib/native-provider.ts";
import { fetchWithRetry } from "../../lib/util.ts";
import { crofaiAuth } from "./crofai-auth.ts";

const _logger = createLogger("crofai");

// =============================================================================
// Types
// =============================================================================

interface CrofaiModel {
	id: string;
	name?: string;
	context_length?: number;
	max_completion_tokens?: number;
	custom_reasoning?: boolean;
	reasoning_effort?: boolean;
	pricing?: {
		prompt?: string;
		completion?: string;
		cache_prompt?: string;
	};
}

// =============================================================================
// Fetch
// =============================================================================

function parseCrofaiPrice(priceStr: string | undefined): number {
	if (priceStr === undefined) return 0;
	const num = Number.parseFloat(priceStr);
	if (Number.isNaN(num)) return 0;
	// CrofAI pricing is per-MILLION tokens. Divide to get per-token (Pi convention).
	return num / 1_000_000;
}

async function fetchCrofaiModels(
	apiKey: string,
	signal?: AbortSignal,
): Promise<ProviderModelConfig[]> {
	const response = await fetchWithRetry(
		`${BASE_URL_CROFAI}/models`,
		{
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
			signal,
		},
		3,
		1000,
		DEFAULT_FETCH_TIMEOUT_MS,
	);

	if (!response.ok) {
		throw new Error(
			`CrofAI API error: ${response.status} ${response.statusText}`,
		);
	}

	// CrofAI returns { data: [...] }
	const json = (await response.json()) as {
		data?: CrofaiModel[];
	};
	const models = json.data ?? [];

	_logger.info(`[crofai] Fetched ${models.length} models`);

	const mapped = models
		.filter((m) => m.id)
		.map((m): ProviderModelConfig => {
			const name = m.name || m.id;
			const reasoning =
				m.custom_reasoning ?? isLikelyReasoningModel({ id: m.id, name });

			return {
				id: m.id,
				name,
				reasoning,
				input: ["text"],
				cost: {
					input: parseCrofaiPrice(m.pricing?.prompt),
					output: parseCrofaiPrice(m.pricing?.completion),
					cacheRead: parseCrofaiPrice(m.pricing?.cache_prompt),
					cacheWrite: 0,
				},
				contextWindow: m.context_length ?? 128_000,
				maxTokens: m.max_completion_tokens ?? 16_384,
				compat: getProxyModelCompat({ id: m.id, name }),
				_pricingKnown:
					m.pricing?.prompt !== undefined ||
					m.pricing?.completion !== undefined ||
					m.pricing?.cache_prompt !== undefined,
			} as ProviderModelConfig & { _pricingKnown?: boolean };
		});

	return await safeEnrichModelsWithModelsDev(mapped, {
		providerId: PROVIDER_CROFAI,
	});
}

// =============================================================================
// Native Provider Entry Point
// =============================================================================

export default function crofaiProvider(pi: ExtensionAPI): Promise<void> {
	registerNativeOpenAIProvider(pi, {
		providerId: PROVIDER_CROFAI,
		name: "CrofAI",
		baseUrl: BASE_URL_CROFAI,
		auth: crofaiAuth,
		getApiKey: getCrofaiApiKey,
		getShowPaid: getCrofaiShowPaid,
		fetchModels: (apiKey, signal) => fetchCrofaiModels(apiKey, signal),
	});
	return Promise.resolve();
}
