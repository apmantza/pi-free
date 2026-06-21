/**
 * Naraya AI Router Provider Extension
 *
 * Naraya (https://router.naraya.ai) is an OpenAI-compatible LLM gateway
 * serving 9 models behind a single API key. All models are included in
 * the free plan with a 5,000,000-token-per-day quota.
 *
 * API: https://router.naraya.ai/v1
 * Models: GET  /v1/models
 * Chat:   POST /v1/chat/completions
 *
 * The /v1/models endpoint exposes per-model metadata
 * (id, owned_by, context_window, weight, reasoning?, vision?) but does
 * NOT expose per-token pricing. Per-1M-token rates are sourced from the
 * published rate card (see NARAYA_PRICING below) and used for cost
 * tracking; free detection relies on the freemium model (all models
 * are accessible with the API key under the daily quota).
 *
 * Setup:
 *   NARAYA_API_KEY=sk-nry-...
 *   # or add naraya_api_key to ~/.pi/free.json
 */

import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import {
	getNarayaApiKey,
	getNarayaShowPaid,
	applyHidden,
} from "../../config.ts";
import {
	BASE_URL_NARAYA,
	DEFAULT_FETCH_TIMEOUT_MS,
	PROVIDER_NARAYA,
} from "../../constants.ts";
import { createLogger } from "../../lib/logger.ts";
import { safeEnrichModelsWithModelsDev } from "../../lib/model-metadata.ts";
import { getProxyModelCompat } from "../../lib/provider-compat.ts";
import { isFreeModel, registerWithGlobalToggle } from "../../lib/registry.ts";
import { fetchWithRetry } from "../../lib/util.ts";
import { createReRegister, setupProvider } from "../../provider-helper.ts";

const _logger = createLogger("naraya");

// =============================================================================
// Pricing (sourced from the published rate card — the API does not expose it)
//
// USD per 1M tokens. cacheRead is the published "Cache / 1M" column;
// cacheWrite defaults to the input rate (standard assumption when the
// rate card doesn't break out a separate cache write price).
// =============================================================================

interface NarayaPricing {
	input: number;
	cacheRead: number;
	output: number;
}

const NARAYA_PRICING: Readonly<Record<string, NarayaPricing>> = {
	"deepseek-v4-flash-naraya": { input: 0.03, cacheRead: 0.01, output: 0.05 },
	"minimax-m3": { input: 0.15, cacheRead: 0.03, output: 0.61 },
	"mistral-large": { input: 0.05, cacheRead: 0, output: 0.15 },
	"mistral-medium-3-5": { input: 0.15, cacheRead: 0, output: 0.75 },
	"qwen3.7-max-naraya": { input: 0.25, cacheRead: 0.05, output: 0.75 },
	"claude-sonnet-4.5": { input: 0.3, cacheRead: 0.03, output: 1.52 },
	"claude-haiku-4.5": { input: 0.1, cacheRead: 0.01, output: 0.51 },
	"deepseek-3.2": { input: 0.02, cacheRead: 0, output: 0.03 },
	"glm-5": { input: 0.06, cacheRead: 0.01, output: 0.19 },
};

// =============================================================================
// Types
// =============================================================================

interface NarayaModel {
	id: string;
	object?: string;
	owned_by?: string;
	context_window?: number;
	/** Quota consumption multiplier (1, 1.5, or 2). Higher = consumes
	 *  the daily quota faster. Preserved for reference; not used for
	 *  per-token pricing (we use the rate card above). */
	weight?: number;
	reasoning?: boolean;
	vision?: boolean;
}

// =============================================================================
// Helpers (exported for testing)
// =============================================================================

function defaultMaxTokens(): number {
	return 16_384;
}

/**
 * Build a {@link ProviderModelConfig} from the API model + hardcoded pricing.
 * All Naraya models are marked as authoritatively free (freemium: included
 * in the free plan under the 5M tokens/day quota). Pure function for tests.
 */
export function mapNarayaModel(model: NarayaModel): ProviderModelConfig & {
	_pricingKnown?: boolean;
	_freeKnown?: boolean;
	_isFree?: boolean;
} {
	const id = model.id;
	const pricing = NARAYA_PRICING[id];
	const hasPricing = pricing !== undefined;
	const input: readonly ("text" | "image")[] = model.vision
		? (["text", "image"] as const)
		: (["text"] as const);

	return {
		id,
		name: id,
		reasoning: model.reasoning === true,
		input,
		cost: {
			input: pricing?.input ?? 0,
			output: pricing?.output ?? 0,
			cacheRead: pricing?.cacheRead ?? 0,
			// Cache write defaults to the input rate; the rate card doesn't
			// break out a separate cache write price for Naraya.
			cacheWrite: pricing?.input ?? 0,
		},
		contextWindow: model.context_window ?? 128_000,
		maxTokens: defaultMaxTokens(),
		compat: getProxyModelCompat({ id, name: id }),
		_pricingKnown: hasPricing,
		// Freemium: all included models are free under the daily quota.
		_freeKnown: true,
		_isFree: true,
	} as ProviderModelConfig & {
		_pricingKnown?: boolean;
		_freeKnown?: boolean;
		_isFree?: boolean;
	};
}

// =============================================================================
// Fetch
// =============================================================================

async function fetchNarayaModels(
	apiKey: string,
): Promise<ProviderModelConfig[]> {
	_logger.info("[naraya] Fetching models from Naraya API...");

	try {
		const response = await fetchWithRetry(
			`${BASE_URL_NARAYA}/models`,
			{
				headers: {
					Authorization: `Bearer ${apiKey}`,
					Accept: "application/json",
				},
			},
			3,
			1000,
			DEFAULT_FETCH_TIMEOUT_MS,
		);

		if (!response.ok) {
			throw new Error(`Naraya API error: ${response.status}`);
		}

		const json = (await response.json()) as { data?: NarayaModel[] };
		const models = (json.data ?? []).filter((m) => m.id);

		_logger.info(`[naraya] Fetched ${models.length} models`);

		const mapped = models.map(mapNarayaModel);
		const enriched = await safeEnrichModelsWithModelsDev(mapped, {
			providerId: PROVIDER_NARAYA,
		});

		// Warn about models in the API that we don't have pricing for
		// (new models added without a rate card update).
		const unpriced = mapped.filter(
			(m) => (m as { _pricingKnown?: boolean })._pricingKnown === false,
		);
		if (unpriced.length > 0) {
			_logger.warn(
				`[naraya] ${unpriced.length} model(s) missing from rate card; using cost=0: ${unpriced.map((m) => m.id).join(", ")}`,
			);
		}

		return applyHidden(enriched, PROVIDER_NARAYA);
	} catch (error) {
		_logger.error("[naraya] Failed to fetch models", {
			error: error instanceof Error ? error.message : String(error),
		});
		return [];
	}
}

// =============================================================================
// Extension Entry Point
// =============================================================================

export default async function narayaProvider(pi: ExtensionAPI) {
	const apiKey = getNarayaApiKey();

	if (!apiKey) {
		_logger.info(
			"[naraya] Skipping — NARAYA_API_KEY not set. Sign up at https://router.naraya.ai/",
		);
		return;
	}

	const allModels = await fetchNarayaModels(apiKey);

	if (allModels.length === 0) {
		_logger.warn(
			"[naraya] No models available — verify NARAYA_API_KEY is valid and see ~/.pi/free.log for details",
		);
		return;
	}

	// All Naraya models are freemium (included in the free plan under the
	// 5M tokens/day quota), so mapNarayaModel already set _freeKnown: true
	// and _isFree: true. isFreeModel short-circuits on _freeKnown and returns
	// _isFree === true, so every model lands in the free bucket.
	const freeModels = allModels.filter((m) =>
		isFreeModel({ ...m, provider: PROVIDER_NARAYA }, allModels),
	);
	const stored = { free: freeModels, all: allModels };

	_logger.info(
		`[naraya] Registered ${allModels.length} models (${freeModels.length} freemium)`,
	);

	const reRegister = createReRegister(pi, {
		providerId: PROVIDER_NARAYA,
		baseUrl: BASE_URL_NARAYA,
		apiKey,
	});

	registerWithGlobalToggle(PROVIDER_NARAYA, stored, reRegister, true);

	setupProvider(
		pi,
		{
			providerId: PROVIDER_NARAYA,
			initialShowPaid: getNarayaShowPaid(),
			tosUrl: "https://router.naraya.ai/",
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

	const showPaid = getNarayaShowPaid();
	const initialModels =
		showPaid && stored.all.length > 0 ? stored.all : freeModels;
	reRegister(initialModels);
}
