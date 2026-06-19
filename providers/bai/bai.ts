/**
 * B.AI Provider Extension
 *
 * B.AI (https://b.ai) is an OpenAI-compatible LLM gateway providing access
 * to many models (OpenAI, Anthropic, Google, DeepSeek, Qwen, GLM, Kimi).
 *
 * API: https://api.b.ai/v1
 * Models: /v1/models
 * Chat: /v1/chat/completions
 *
 * Pricing is not exposed via the /v1/models endpoint, so all models
 * default to cost=0. The `isFreeModel` Route B detection (name contains
 * "free") is therefore used. As a result, with `free_only: true` no b.ai
 * models will be visible until you run `/toggle-bai` to enable paid models.
 *
 * A small set of known-promotional models are hardcoded as known-free so
 * they remain visible even when free-only mode is on (mirrors the
 * TokenRouter approach for `MiniMax-M3`).
 *
 * Setup:
 *   BAI_API_KEY=sk-...
 *   # or add bai_api_key to ~/.pi/free.json
 */

import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import { getBaiApiKey, getBaiShowPaid, applyHidden } from "../../config.ts";
import {
	BASE_URL_BAI,
	DEFAULT_FETCH_TIMEOUT_MS,
	PROVIDER_BAI,
} from "../../constants.ts";
import { createLogger } from "../../lib/logger.ts";
import { safeEnrichModelsWithModelsDev } from "../../lib/model-metadata.ts";
import {
	getProxyModelCompat,
	isLikelyReasoningModel,
} from "../../lib/provider-compat.ts";
import { isFreeModel, registerWithGlobalToggle } from "../../lib/registry.ts";
import { cleanModelName, fetchWithRetry } from "../../lib/util.ts";
import { createReRegister, setupProvider } from "../../provider-helper.ts";

const _logger = createLogger("bai");

// =============================================================================
// Known Free Models
// B.AI doesn't expose pricing via /v1/models, so known-free models are
// hardcoded. The site currently advertises `MiniMax-M3` as a limited-time
// free promotional model; we hardcode that alias and any future `:free`
// suffixed IDs (catches dynamic promotional additions).
// =============================================================================

const BAI_KNOWN_FREE_MODELS = new Set(["minimax-m3", "MiniMax-M3"]);

function isBaiKnownFree(modelId: string): boolean {
	if (BAI_KNOWN_FREE_MODELS.has(modelId)) return true;
	// Catch any future `:free` suffixed model the gateway advertises
	return modelId.toLowerCase().endsWith(":free");
}

// =============================================================================
// Types
// =============================================================================

interface BaiModel {
	id: string;
	object?: string;
	created?: number;
	owned_by?: string;
	supported_endpoint_types?: string[];
}

// =============================================================================
// Helpers
// =============================================================================

/** Text-capable chat endpoints (excludes image/video/audio-only types) */
const CHAT_ENDPOINT_TYPES = new Set([
	"openai",
	"openai-response",
	"anthropic",
	"anthropic-compatible",
	"gemini",
]);

function isTextChatModel(model: BaiModel): boolean {
	const endpoints = model.supported_endpoint_types ?? [];
	if (endpoints.length === 0) {
		// No endpoint info — assume text chat (matches TokenRouter fallback)
		return true;
	}
	return endpoints.some((t) => CHAT_ENDPOINT_TYPES.has(t));
}

function mapBaiModel(model: BaiModel): ProviderModelConfig & {
	_pricingKnown?: boolean;
	_freeKnown?: boolean;
	_isFree?: boolean;
} {
	const name = cleanModelName(model.id);
	const reasoning = isLikelyReasoningModel({ id: model.id, name });
	const isKnownFree = isBaiKnownFree(model.id);

	return {
		id: model.id,
		name,
		reasoning,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128_000,
		maxTokens: 16_384,
		compat: getProxyModelCompat({ id: model.id, name }),
		// Known-free models bypass name-based detection entirely
		_freeKnown: isKnownFree,
		_isFree: isKnownFree,
		// Non-free models signal no pricing data (name-based detection only)
		_pricingKnown: false,
	} as ProviderModelConfig & {
		_pricingKnown?: boolean;
		_freeKnown?: boolean;
		_isFree?: boolean;
	};
}

// =============================================================================
// Fetch Models
// =============================================================================

async function fetchBaiModels(apiKey: string): Promise<ProviderModelConfig[]> {
	_logger.info("[bai] Fetching models from B.AI API...");

	try {
		const response = await fetchWithRetry(
			`${BASE_URL_BAI}/models`,
			{
				headers: {
					Authorization: `Bearer ${apiKey}`,
					Accept: "application/json",
					"Content-Type": "application/json",
				},
			},
			3,
			1000,
			DEFAULT_FETCH_TIMEOUT_MS,
		);

		if (!response.ok) {
			throw new Error(`B.AI API error: ${response.status}`);
		}

		const json = (await response.json()) as { data?: BaiModel[] };
		const models = (json.data ?? []).filter(isTextChatModel);

		_logger.info(`[bai] Fetched ${models.length} text chat models`);
		const enriched = await safeEnrichModelsWithModelsDev(
			models.map(mapBaiModel),
			{ providerId: PROVIDER_BAI },
		);
		return applyHidden(enriched, PROVIDER_BAI);
	} catch (error) {
		_logger.error("[bai] Failed to fetch models", {
			error: error instanceof Error ? error.message : String(error),
		});
		return [];
	}
}

// =============================================================================
// Extension Entry Point
// =============================================================================

export default async function baiProvider(pi: ExtensionAPI) {
	const apiKey = getBaiApiKey();

	if (!apiKey) {
		_logger.info(
			"[bai] Skipping — BAI_API_KEY not set. Sign up at https://b.ai/",
		);
		return;
	}

	const allModels = await fetchBaiModels(apiKey);

	if (allModels.length === 0) {
		_logger.warn("[bai] No text chat models available");
		return;
	}

	// Use isFreeModel with allModels for proper detection
	// B.AI doesn't expose pricing, so Route B (name-based) applies:
	// FREE if name contains "free" OR _isFree is true (known-free hardcoded).
	const freeModels = allModels.filter((m) =>
		isFreeModel({ ...m, provider: PROVIDER_BAI }, allModels),
	);
	const stored = { free: freeModels, all: allModels };

	_logger.info(
		`[bai] Registered ${allModels.length} models (${freeModels.length} free)`,
	);

	const reRegister = createReRegister(pi, {
		providerId: PROVIDER_BAI,
		baseUrl: BASE_URL_BAI,
		apiKey,
	});

	registerWithGlobalToggle(PROVIDER_BAI, stored, reRegister, true);

	setupProvider(
		pi,
		{
			providerId: PROVIDER_BAI,
			initialShowPaid: getBaiShowPaid(),
			tosUrl: "https://b.ai/",
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

	const showPaid = getBaiShowPaid();
	const initialModels =
		showPaid && stored.all.length > 0 ? stored.all : freeModels;
	reRegister(initialModels);
}
