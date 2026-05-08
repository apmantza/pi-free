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
import {
	getProxyModelCompat,
	isLikelyReasoningModel,
} from "../../lib/provider-compat.ts";
import { isFreeModel, registerWithGlobalToggle } from "../../lib/registry.ts";
import { fetchWithRetry } from "../../lib/util.ts";
import { createReRegister, setupProvider } from "../../provider-helper.ts";

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
): Promise<ProviderModelConfig[]> {
	const response = await fetchWithRetry(
		`${BASE_URL_CROFAI}/models`,
		{
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
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

	return models
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
			};
		});
}

// =============================================================================
// Extension Entry Point
// =============================================================================

export default async function crofaiProvider(pi: ExtensionAPI) {
	const apiKey = getCrofaiApiKey();

	if (!apiKey) {
		_logger.info(
			"[crofai] Skipping - CROFAI_API_KEY not set (env var or ~/.pi/free.json)",
		);
		return;
	}

	// Fetch models
	const allModels = await fetchCrofaiModels(apiKey);

	if (allModels.length === 0) {
		_logger.warn("[crofai] No models available");
		return;
	}

	const freeModels = allModels.filter((m) =>
		isFreeModel({ ...m, provider: PROVIDER_CROFAI }, allModels),
	);

	const stored = { free: freeModels, all: allModels };

	_logger.info(
		`[crofai] Registered ${allModels.length} models (${freeModels.length} free)`,
	);

	// Create re-register function
	const reRegister = createReRegister(pi, {
		providerId: PROVIDER_CROFAI,
		baseUrl: BASE_URL_CROFAI,
		apiKey,
	});

	// Register with global toggle
	registerWithGlobalToggle(PROVIDER_CROFAI, stored, reRegister, true);

	// Setup provider with toggle command
	setupProvider(
		pi,
		{
			providerId: PROVIDER_CROFAI,
			initialShowPaid: getCrofaiShowPaid(),
			reRegister: (models, _stored) => {
				if (_stored) {
					stored.free = _stored.free;
					stored.all = _stored.all;
				}
				reRegister(models);
			},
		},
		stored,
	);

	// Initial registration — respect persisted toggle state
	const showPaid = getCrofaiShowPaid();
	const initialModels =
		showPaid && stored.all.length > 0 ? stored.all : freeModels;
	reRegister(initialModels);
}
