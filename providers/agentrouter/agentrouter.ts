/**
 * AgentRouter Provider Extension
 *
 * AgentRouter (https://agentrouter.org) is a free public-welfare AI
 * gateway ("公益站") that fronts Claude, DeepSeek, GLM, and GPT models.
 * All models are free under a quota; `model_price` is 0 for every model.
 *
 * API surface:
 *   - POST /v1/messages   (Anthropic-compatible)  ← we use this
 *   - POST /v1/chat/completions  (OpenAI-compatible, BLOCKED for direct
 *     API clients — only reachable from the official Codex CLI)
 *   - GET  /api/pricing   (public, no-auth catalog with model list,
 *     pricing multipliers, protocol support, and access tiers)
 *
 * The OpenAI-compatible path returns "unauthorized client detected"
 * regardless of User-Agent or headers, so we register with
 * `api: "anthropic-messages"` and filter to models whose
 * `supported_endpoint_types` includes "anthropic" (5 of 10 models).
 * The remaining 5 OpenAI-only models are unreachable from pi-free.
 *
 * Setup:
 *   AGENTROUTER_API_KEY=sk-...
 *   # or add agentrouter_api_key to ~/.pi/free.json
 *   # Get your key at https://agentrouter.org/console/token
 */

import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import {
	getAgentrouterApiKey,
	getAgentrouterShowPaid,
	applyHidden,
} from "../../config.ts";
import {
	BASE_URL_AGENTROUTER,
	DEFAULT_FETCH_TIMEOUT_MS,
	PROVIDER_AGENTROUTER,
} from "../../constants.ts";
import { createLogger } from "../../lib/logger.ts";
import { safeEnrichModelsWithModelsDev } from "../../lib/model-metadata.ts";
import { isFreeModel, registerWithGlobalToggle } from "../../lib/registry.ts";
import { fetchWithRetry } from "../../lib/util.ts";
import { createReRegister, setupProvider } from "../../provider-helper.ts";

const _logger = createLogger("agentrouter");

// =============================================================================
// Types
// =============================================================================

interface AgentRouterPricingItem {
	model_name: string;
	quota_type: number;
	/** Quota consumption multiplier for input tokens. */
	model_ratio: number;
	/** Quota consumption multiplier for output tokens. */
	completion_ratio: number;
	/** Per-token USD price from the rate card (0 = free service). */
	model_price: number;
	owner_by?: string;
	/** Access tier groups (e.g. "default", "vip", "svip"). */
	enable_groups?: string[];
	/** Protocols the model is reachable through. */
	supported_endpoint_types: string[];
}

interface AgentRouterPricingResponse {
	data: AgentRouterPricingItem[];
}

// =============================================================================
// Helpers (exported for testing)
// =============================================================================

/**
 * True when the model is reachable through the Anthropic Messages API.
 * Models with only `["openai"]` are blocked from direct API clients.
 */
export function supportsAnthropicProtocol(
	item: AgentRouterPricingItem,
): boolean {
	return (
		Array.isArray(item.supported_endpoint_types) &&
		item.supported_endpoint_types.includes("anthropic")
	);
}

/**
 * Build a {@link ProviderModelConfig} from a pricing catalog item.
 * All models are marked as authoritatively free (freemium: the service
 * is a free public-welfare gateway with `model_price: 0`).
 * Pure function — exported for unit testing.
 */
export function mapAgentRouterModel(
	item: AgentRouterPricingItem,
): ProviderModelConfig & {
	_pricingKnown?: boolean;
	_freeKnown?: boolean;
	_isFree?: boolean;
} {
	const id = item.model_name;
	return {
		id,
		name: id,
		// Reasoning / vision / context are filled in by models.dev
		// enrichment (safeEnrichModelsWithModelsDev). We leave them as
		// false here so the enrichment can override.
		reasoning: false,
		input: ["text"],
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
		},
		contextWindow: 128_000,
		maxTokens: 16_384,
		_pricingKnown: true,
		// Free public-welfare service: every model is included.
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

async function fetchAgentRouterCatalog(): Promise<AgentRouterPricingItem[]> {
	// /api/pricing is a public, no-auth catalog endpoint.
	const url = `${BASE_URL_AGENTROUTER}/api/pricing`;
	const response = await fetchWithRetry(
		url,
		{ headers: { Accept: "application/json" } },
		3,
		1000,
		DEFAULT_FETCH_TIMEOUT_MS,
	);

	if (!response.ok) {
		throw new Error(
			`AgentRouter /api/pricing error: ${response.status} ${response.statusText}`,
		);
	}

	const json = (await response.json()) as
		| AgentRouterPricingItem[]
		| AgentRouterPricingResponse;
	const items = Array.isArray(json) ? json : (json.data ?? []);

	if (items.length === 0) {
		throw new Error("AgentRouter /api/pricing returned no models");
	}

	return items;
}

async function fetchAgentRouterModels(
	_apiKey: string,
): Promise<ProviderModelConfig[]> {
	// Note: _apiKey is unused for the catalog fetch (public endpoint) but
	// is kept in the signature for symmetry with other providers and to
	// document that chat calls require auth.
	void _apiKey;

	const allItems = await fetchAgentRouterCatalog();
	const anthropicItems = allItems.filter(supportsAnthropicProtocol);

	if (anthropicItems.length === 0) {
		_logger.warn(
			"[agentrouter] No models with Anthropic protocol support found",
		);
		return [];
	}

	const skipped = allItems.length - anthropicItems.length;
	if (skipped > 0) {
		_logger.info(
			`[agentrouter] Skipping ${skipped} OpenAI-only model(s) (Anthropic path not supported): ${allItems
				.filter((m) => !supportsAnthropicProtocol(m))
				.map((m) => m.model_name)
				.join(", ")}`,
		);
	}

	_logger.info(
		`[agentrouter] Registering ${anthropicItems.length} models (Anthropic-compatible): ${anthropicItems
			.map((m) => m.model_name)
			.join(", ")}`,
	);

	const mapped = anthropicItems.map(mapAgentRouterModel);
	const enriched = await safeEnrichModelsWithModelsDev(mapped, {
		providerId: PROVIDER_AGENTROUTER,
	});
	return applyHidden(enriched, PROVIDER_AGENTROUTER);
}

// =============================================================================
// Extension Entry Point
// =============================================================================

export default async function agentrouterProvider(pi: ExtensionAPI) {
	const apiKey = getAgentrouterApiKey();

	if (!apiKey) {
		_logger.info(
			"[agentrouter] Skipping — AGENTROUTER_API_KEY not set. Get one at https://agentrouter.org/console/token",
		);
		return;
	}

	const allModels = await fetchAgentRouterModels(apiKey).catch((error) => {
		_logger.error("[agentrouter] Failed to fetch catalog", {
			error: error instanceof Error ? error.message : String(error),
		});
		return [] as ProviderModelConfig[];
	});

	if (allModels.length === 0) {
		_logger.warn(
			"[agentrouter] No models available — see ~/.pi/free.log for details",
		);
		return;
	}

	// All AgentRouter models are free (freemium: public-welfare service
	// with model_price=0 and per-tier quotas). mapAgentRouterModel already
	// set _freeKnown: true and _isFree: true, so every model lands in the
	// free bucket via isFreeModel's _freeKnown short-circuit.
	const freeModels = allModels.filter((m) =>
		isFreeModel({ ...m, provider: PROVIDER_AGENTROUTER }, allModels),
	);
	const stored = { free: freeModels, all: allModels };

	_logger.info(
		`[agentrouter] Registered ${allModels.length} models (${freeModels.length} freemium)`,
	);

	const reRegister = createReRegister(pi, {
		providerId: PROVIDER_AGENTROUTER,
		baseUrl: BASE_URL_AGENTROUTER,
		apiKey,
	});

	registerWithGlobalToggle(PROVIDER_AGENTROUTER, stored, reRegister, true);

	setupProvider(
		pi,
		{
			providerId: PROVIDER_AGENTROUTER,
			initialShowPaid: getAgentrouterShowPaid(),
			tosUrl: "https://agentrouter.org/",
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

	const showPaid = getAgentrouterShowPaid();
	const initialModels =
		showPaid && stored.all.length > 0 ? stored.all : freeModels;
	reRegister(initialModels);
}
