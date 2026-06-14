/**
 * TokenRouter Provider Extension
 *
 * TokenRouter is an OpenAI-compatible API gateway routing to 90+ models
 * across multiple providers (OpenAI, Anthropic, Google, DeepSeek, Qwen, etc.).
 *
 * API: https://api.tokenrouter.com/v1
 * Models: /v1/models
 *
 * Setup:
 *   TOKENROUTER_API_KEY=sk-...
 *   # or add tokenrouter_api_key to ~/.pi/free.json
 */

import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import {
	getTokenrouterApiKey,
	getTokenrouterShowPaid,
	applyHidden,
} from "../../config.ts";
import {
	BASE_URL_TOKENROUTER,
	DEFAULT_FETCH_TIMEOUT_MS,
	PROVIDER_TOKENROUTER,
} from "../../constants.ts";
import { createLogger } from "../../lib/logger.ts";
import { safeEnrichModelsWithModelsDev } from "../../lib/model-metadata.ts";
import {
	DEEPSEEK_PROXY_COMPAT,
	getProxyModelCompat,
	isLikelyReasoningModel,
} from "../../lib/provider-compat.ts";
import { isFreeModel, registerWithGlobalToggle } from "../../lib/registry.ts";
import { cleanModelName, fetchWithRetry } from "../../lib/util.ts";
import { createReRegister, setupProvider } from "../../provider-helper.ts";

const _logger = createLogger("tokenrouter");

// =============================================================================
// Known Free Models
// TokenRouter doesn't expose pricing via /v1/models, so known-free models
// are hardcoded. Detected via name suffix also catches `:free`-tagged models.
// =============================================================================

const MINIMAX_M3_ID = "MiniMax-M3";
const KNOWN_FREE_MODELS = new Set([MINIMAX_M3_ID]);
const MINIMAX_ADAPTIVE_COMPAT: NonNullable<ProviderModelConfig["compat"]> = {
	...DEEPSEEK_PROXY_COMPAT,
	thinkingFormat: "deepseek",
};

// =============================================================================
// Types
// =============================================================================

interface TokenRouterModel {
	id: string;
	object: string;
	created: number;
	owned_by: string;
	supported_endpoint_types: string[];
	tags?: string;
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

function isTextChatModel(model: TokenRouterModel): boolean {
	const tags = (model.tags ?? "").toLowerCase();
	// Exclude models whose only tags are non-text
	const nonTextTags = ["image", "video", "audio"];
	const hasNonTextTag = nonTextTags.some((t) => tags.includes(t));
	const hasTextTag = tags.includes("text");
	// If it has a text tag, include it. If only non-text tags, exclude.
	if (hasTextTag) return true;
	if (hasNonTextTag && !hasTextTag) return false;
	// No tags or empty tags: check endpoint types
	return model.supported_endpoint_types.some((t) => CHAT_ENDPOINT_TYPES.has(t));
}

function isTokenRouterMinimaxModel(modelId: string): boolean {
	return modelId.toLowerCase().includes("minimax");
}

export function finalizeTokenRouterModel(
	model: ProviderModelConfig,
): ProviderModelConfig {
	if (!isTokenRouterMinimaxModel(model.id)) return model;

	return {
		...model,
		reasoning: true,
		compat: {
			...MINIMAX_ADAPTIVE_COMPAT,
			...(model.compat ?? {}),
			thinkingFormat: "deepseek",
			supportsReasoningEffort: true,
		},
	};
}

export function patchTokenRouterMinimaxThinkingPayload(payload: unknown): unknown {
	if (typeof payload !== "object" || payload === null) return payload;
	const body = payload as {
		model?: unknown;
		thinking?: { type?: unknown };
	};
	if (!isTokenRouterMinimaxModel(String(body.model ?? ""))) return payload;
	if (body.thinking?.type !== "enabled") return payload;

	return {
		...body,
		thinking: {
			...body.thinking,
			type: "adaptive",
		},
	};
}

export function mapTokenRouterModel(model: TokenRouterModel): ProviderModelConfig & {
	_pricingKnown?: boolean;
	_freeKnown?: boolean;
	_isFree?: boolean;
} {
	const name = cleanModelName(model.id);
	const isMinimax = isTokenRouterMinimaxModel(model.id);
	const reasoning = isMinimax || isLikelyReasoningModel({ id: model.id, name });
	const isResponseApi =
		model.supported_endpoint_types.includes("openai-response");
	const isKnownFree = KNOWN_FREE_MODELS.has(model.id);

	return {
		id: model.id,
		name,
		reasoning,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128_000,
		maxTokens: 16_384,
		compat: {
			...(isMinimax
				? MINIMAX_ADAPTIVE_COMPAT
				: getProxyModelCompat({ id: model.id, name })),
			// openai-response models use a different API shape
			...(isResponseApi ? { apiType: "openai-response" as const } : {}),
		},
		// Known-free models bypass pricing detection entirely
		_freeKnown: isKnownFree,
		_isFree: isKnownFree,
		// Non-free models signal no pricing data (name-based detection only)
		_pricingKnown: false,
	} as ProviderModelConfig & { _pricingKnown?: boolean };
}

// =============================================================================
// Fetch Models
// =============================================================================

async function fetchTokenRouterModels(
	apiKey: string,
): Promise<ProviderModelConfig[]> {
	_logger.info("[tokenrouter] Fetching models from TokenRouter API...");

	try {
		const response = await fetchWithRetry(
			`${BASE_URL_TOKENROUTER}/models`,
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
			throw new Error(`TokenRouter API error: ${response.status}`);
		}

		const json = (await response.json()) as { data?: TokenRouterModel[] };
		const models = (json.data ?? []).filter(isTextChatModel);

		_logger.info(`[tokenrouter] Fetched ${models.length} text chat models`);
		const enriched = await safeEnrichModelsWithModelsDev(
			models.map(mapTokenRouterModel),
			{ providerId: PROVIDER_TOKENROUTER },
		);
		return applyHidden(
			enriched.map(finalizeTokenRouterModel),
			PROVIDER_TOKENROUTER,
		);
	} catch (error) {
		_logger.error("[tokenrouter] Failed to fetch models", {
			error: error instanceof Error ? error.message : String(error),
		});
		return [];
	}
}

// =============================================================================
// Extension Entry Point
// =============================================================================

export default async function tokenRouterProvider(pi: ExtensionAPI) {
	const apiKey = getTokenrouterApiKey();

	if (!apiKey) {
		_logger.info("[tokenrouter] Skipping — TOKENROUTER_API_KEY not set.");
		return;
	}

	const allModels = await fetchTokenRouterModels(apiKey);

	if (allModels.length === 0) {
		_logger.warn("[tokenrouter] No text chat models available");
		return;
	}

	const freeModels = allModels.filter((m) =>
		isFreeModel({ ...m, provider: PROVIDER_TOKENROUTER }, allModels),
	);
	const stored = { free: freeModels, all: allModels };

	_logger.info(
		`[tokenrouter] Registered ${allModels.length} models (${freeModels.length} free)`,
	);

	const reRegister = createReRegister(pi, {
		providerId: PROVIDER_TOKENROUTER,
		baseUrl: BASE_URL_TOKENROUTER,
		apiKey,
	});

	registerWithGlobalToggle(PROVIDER_TOKENROUTER, stored, reRegister, true);

	pi.on("before_provider_request", (event) =>
		patchTokenRouterMinimaxThinkingPayload(event.payload),
	);

	setupProvider(
		pi,
		{
			providerId: PROVIDER_TOKENROUTER,
			initialShowPaid: getTokenrouterShowPaid(),
			tosUrl: "https://tokenrouter.com/terms",
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

	const showPaid = getTokenrouterShowPaid();
	const initialModels =
		showPaid && stored.all.length > 0 ? stored.all : freeModels;
	reRegister(initialModels);
}
