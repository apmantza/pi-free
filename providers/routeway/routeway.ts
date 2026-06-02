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
import { getRoutewayApiKey, getRoutewayShowPaid } from "../../config.ts";
import {
	BASE_URL_ROUTEWAY,
	DEFAULT_FETCH_TIMEOUT_MS,
	PROVIDER_ROUTEWAY,
} from "../../constants.ts";
import { applyHidden } from "../../config.ts";
import { createLogger } from "../../lib/logger.ts";
import {
	getProxyModelCompat,
	isLikelyReasoningModel,
} from "../../lib/provider-compat.ts";
import { isFreeModel, registerWithGlobalToggle } from "../../lib/registry.ts";
import { cleanModelName, fetchWithRetry } from "../../lib/util.ts";
import { createReRegister, setupProvider } from "../../provider-helper.ts";

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
	const hasPricing = !!(model.pricing?.input || model.pricing?.output);
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
		return applyHidden(models.map(mapRoutewayModel), PROVIDER_ROUTEWAY);
	} catch (error) {
		_logger.error("[routeway] Failed to fetch models", {
			error: error instanceof Error ? error.message : String(error),
		});
		return [];
	}
}

export default async function routewayProvider(pi: ExtensionAPI) {
	const apiKey = getRoutewayApiKey();

	if (!apiKey) {
		_logger.info(
			"[routeway] Skipping — ROUTEWAY_API_KEY not set. Sign up at https://routeway.ai/",
		);
		return;
	}

	const allModels = await fetchRoutewayModels(apiKey);

	if (allModels.length === 0) {
		_logger.warn("[routeway] No chat models available");
		return;
	}

	const freeModels = allModels.filter((m) =>
		isFreeModel({ ...m, provider: PROVIDER_ROUTEWAY }, allModels),
	);
	const stored = { free: freeModels, all: allModels };

	_logger.info(
		`[routeway] Registered ${allModels.length} models (${freeModels.length} free)`,
	);

	const reRegister = createReRegister(pi, {
		providerId: PROVIDER_ROUTEWAY,
		baseUrl: BASE_URL_ROUTEWAY,
		apiKey,
	});

	registerWithGlobalToggle(PROVIDER_ROUTEWAY, stored, reRegister, true);

	setupProvider(
		pi,
		{
			providerId: PROVIDER_ROUTEWAY,
			initialShowPaid: getRoutewayShowPaid(),
			tosUrl: "https://routeway.ai/terms",
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

	const showPaid = getRoutewayShowPaid();
	const initialModels =
		showPaid && stored.all.length > 0 ? stored.all : freeModels;
	reRegister(initialModels);
}
