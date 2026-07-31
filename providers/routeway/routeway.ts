/**
 * Routeway AI Provider Extension
 *
 * Routeway exposes an OpenAI-compatible chat completions API with a model
 * catalog that includes free models marked by a `:free` suffix and zero token
 * pricing.
 *
 * API: https://api.routeway.ai/v1
 * Models: /v1/models
 * Docs: https://docs.routeway.ai
 *
 * Setup:
 *   ROUTEWAY_API_KEY=sk-...
 *   # or add routeway_api_key to ~/.pi/free.json
 */

import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import { applyHidden, getRoutewayApiKey, getRoutewayShowPaid } from "../../config.ts";
import {
	BASE_URL_ROUTEWAY,
	DEFAULT_FETCH_TIMEOUT_MS,
	PROVIDER_ROUTEWAY,
} from "../../constants.ts";
import { createLogger } from "../../lib/logger.ts";
import { safeEnrichModelsWithModelsDev } from "../../lib/model-metadata.ts";
import {
	getProxyModelCompat,
	isLikelyReasoningModel,
} from "../../lib/provider-compat.ts";
import { createOpenAIAvailabilityProbe } from "../../lib/provider-probe.ts";
import {
	registerNativeAvailabilityProbe,
	registerNativeOpenAIProvider,
} from "../../lib/native-provider.ts";
import { loadProviderCache, saveProviderCache } from "../../lib/provider-cache.ts";
import { cleanModelName, fetchWithRetry } from "../../lib/util.ts";
import { routewayAuth } from "./routeway-auth.ts";

const _logger = createLogger("routeway");

interface RoutewayPrice {
	unit?: string;
	price_per_million_t?: number;
	price_per_token_usd?: string;
}

interface RoutewayModel {
	id: string;
	name?: string;
	short_name?: string;
	description?: string;
	context_length?: number;
	available?: boolean;
	type?: string;
	endpoints?: string[];
	pricing?: {
		input?: RoutewayPrice;
		output?: RoutewayPrice;
		caching?: { read?: RoutewayPrice; write?: RoutewayPrice };
	};
	supported_parameters?: string[];
	capabilities?: {
		vision?: boolean;
		function_call?: boolean;
		reasoning?: boolean;
	};
}

function parsePricePerToken(price: RoutewayPrice | undefined): number {
	if (!price) return 0;
	if (typeof price.price_per_token_usd === "string") {
		const parsed = Number.parseFloat(price.price_per_token_usd);
		if (!Number.isNaN(parsed)) return parsed;
	}
	if (typeof price.price_per_million_t === "number") {
		return price.price_per_million_t / 1_000_000;
	}
	return 0;
}

function isChatModel(model: RoutewayModel): boolean {
	return (
		model.available !== false &&
		(model.type === "chat.completions" ||
			(model.endpoints ?? []).includes("/v1/chat/completions"))
	);
}

function mapRoutewayModel(
	model: RoutewayModel,
): ProviderModelConfig & { _pricingKnown?: boolean } {
	const rawName = model.short_name || model.name || model.id;
	const name = cleanModelName(rawName);
	const inputCost = parsePricePerToken(model.pricing?.input);
	const outputCost = parsePricePerToken(model.pricing?.output);
	const cacheRead = parsePricePerToken(model.pricing?.caching?.read);
	const cacheWrite = parsePricePerToken(model.pricing?.caching?.write);
	const hasPricing = Boolean(model.pricing?.input || model.pricing?.output);
	const reasoning =
		model.capabilities?.reasoning === true ||
		(model.supported_parameters ?? []).includes("reasoning_effort") ||
		isLikelyReasoningModel({ id: model.id, name });
	const free = inputCost === 0 && outputCost === 0;

	return {
		id: model.id,
		name: `${name} (Routeway)${free ? "" : " 💰"}`,
		reasoning,
		input: model.capabilities?.vision ? ["text", "image"] : ["text"],
		cost: {
			input: inputCost,
			output: outputCost,
			cacheRead,
			cacheWrite,
		},
		contextWindow: model.context_length ?? 128_000,
		maxTokens: 16_384,
		compat: getProxyModelCompat({ id: model.id, name }),
		_pricingKnown: hasPricing,
	} as ProviderModelConfig & { _pricingKnown?: boolean };
}

async function fetchRoutewayModels(
	apiKey: string,
	signal?: AbortSignal,
): Promise<ProviderModelConfig[]> {
	_logger.info("[routeway] Fetching models from Routeway API...");

	try {
		const response = await fetchWithRetry(
			`${BASE_URL_ROUTEWAY}/models`,
			{
				headers: {
					Authorization: `Bearer ${apiKey}`,
					Accept: "application/json",
					"Content-Type": "application/json",
				},
				signal,
			},
			3,
			1000,
			DEFAULT_FETCH_TIMEOUT_MS,
		);

		if (!response.ok) {
			throw new Error(`Routeway API error: ${response.status}`);
		}

		const json = (await response.json()) as { data?: RoutewayModel[] };
		const models = (json.data ?? []).filter(isChatModel);

		_logger.info(`[routeway] Fetched ${models.length} chat models`);
		const enriched = await safeEnrichModelsWithModelsDev(
			models.map(mapRoutewayModel),
			{
				providerId: PROVIDER_ROUTEWAY,
			},
		);
		return applyHidden(enriched, PROVIDER_ROUTEWAY);
	} catch (error) {
		_logger.error("[routeway] Failed to fetch models", {
			error: error instanceof Error ? error.message : String(error),
		});
		return [];
	}
}

// =============================================================================
// Extension Entry Point
// =============================================================================

export default function routewayProvider(pi: ExtensionAPI): Promise<void> {
	const initialModels = loadProviderCache(PROVIDER_ROUTEWAY) ?? [];
	const handle = registerNativeOpenAIProvider(pi, {
		providerId: PROVIDER_ROUTEWAY,
		name: "Routeway",
		baseUrl: BASE_URL_ROUTEWAY,
		auth: routewayAuth,
		getApiKey: getRoutewayApiKey,
		getShowPaid: getRoutewayShowPaid,
		initialModels,
		fetchModels: async (apiKey, signal) => {
			const models = await fetchRoutewayModels(apiKey, signal);
			if (models.length > 0) await saveProviderCache(PROVIDER_ROUTEWAY, models);
			return models;
		},
		tosUrl: "https://routeway.ai/terms",
	});

	const apiKey = getRoutewayApiKey();
	if (apiKey) {
		const probe = createOpenAIAvailabilityProbe(
			PROVIDER_ROUTEWAY,
			BASE_URL_ROUTEWAY,
		);
		registerNativeAvailabilityProbe(pi, {
			providerId: PROVIDER_ROUTEWAY,
			label: "Routeway",
			apiKey,
			probe,
			handle,
		});
	}
	return Promise.resolve();
}
