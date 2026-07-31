/**
 * AnyAPI provider extension.
 *
 * AnyAPI is an OpenAI-compatible gateway with a free plan and a catalog of
 * explicitly free models. It exposes the catalog at /v1/models and routes
 * chat requests through /v1/chat/completions.
 *
 * Setup:
 *   ANYAPI_API_KEY=...
 *   # or add anyapi_api_key to ~/.pi/free.json
 */

import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import {
	applyHidden,
	getAnyapiApiKey,
	getAnyapiShowPaid,
} from "../../config.ts";
import {
	BASE_URL_ANYAPI,
	DEFAULT_FETCH_TIMEOUT_MS,
	PROVIDER_ANYAPI,
} from "../../constants.ts";
import { createLogger } from "../../lib/logger.ts";
import {
	loadProviderCache,
	saveProviderCache,
} from "../../lib/provider-cache.ts";
import { safeEnrichModelsWithModelsDev } from "../../lib/model-metadata.ts";
import { fetchWithRetry, mapOpenRouterModel } from "../../lib/util.ts";
import { registerNativeOpenAIProvider } from "../../lib/native-provider.ts";
import { anyapiAuth } from "./anyapi-auth.ts";

const _logger = createLogger("anyapi");

interface AnyApiModel {
	id: string;
	name?: string;
	context_length?: number;
	max_completion_tokens?: number | null;
	top_provider?: {
		context_length?: number | null;
		max_completion_tokens?: number | null;
	};
	pricing?: {
		prompt?: string | number | null;
		completion?: string | number | null;
		input_cache_read?: string | number | null;
		input_cache_write?: string | number | null;
	};
	architecture?: {
		input_modalities?: string[] | null;
		output_modalities?: string[] | null;
	};
	supported_parameters?: string[] | null;
	tags?: string[];
	isFree?: boolean;
}

const ANYAPI_METADATA_VERSION = 1;

type AnyApiProviderModel = ProviderModelConfig & {
	_pricingKnown?: boolean;
	_freeKnown?: boolean;
	_isFree?: boolean;
	_anyapiMetadataVersion?: number;
};

function hasPricing(model: AnyApiModel): boolean {
	return (
		(model.pricing?.prompt !== null && model.pricing?.prompt !== undefined) ||
		(model.pricing?.completion !== null &&
			model.pricing?.completion !== undefined) ||
		(model.pricing?.input_cache_read !== null &&
			model.pricing?.input_cache_read !== undefined) ||
		(model.pricing?.input_cache_write !== null &&
			model.pricing?.input_cache_write !== undefined)
	);
}

function normalizePrice(
	value: string | number | null | undefined,
): string | null {
	return value === null || value === undefined ? null : String(value);
}

/**
 * Detect AnyAPI's explicitly free model labels without treating every model
 * with omitted pricing as free. The API may also expose an authoritative flag
 * or zero pricing, both of which are handled here.
 */
export function isAnyApiFreeModel(model: AnyApiModel): boolean {
	if (typeof model.isFree === "boolean") return model.isFree;

	const label = `${model.id} ${model.name ?? ""}`.toLowerCase();
	if (/\bfree\b/.test(label)) return true;

	if (!hasPricing(model)) return false;
	const input = Number(model.pricing?.prompt);
	const output = Number(model.pricing?.completion);
	return input === 0 && output === 0;
}

export function mapAnyApiModel(model: AnyApiModel): AnyApiProviderModel {
	const name = model.name ?? model.id;
	const pricingKnown = hasPricing(model);
	const freeKnown =
		typeof model.isFree === "boolean" ||
		/\bfree\b/i.test(`${model.id} ${name}`) ||
		(pricingKnown && isAnyApiFreeModel(model));

	const tags = model.tags ?? [];
	const supportsReasoning =
		tags.includes("reasoning") || tags.includes("chat_completions:reasoning");
	const supportsVision =
		tags.includes("vision") || tags.includes("chat_completions:vision");

	const mapped = mapOpenRouterModel({
		...model,
		name,
		supported_parameters:
			model.supported_parameters ?? (supportsReasoning ? ["reasoning"] : []),
		architecture: model.architecture ?? {
			input_modalities: supportsVision ? ["text", "image"] : ["text"],
			output_modalities: ["text"],
		},
		pricing: model.pricing
			? {
					prompt: normalizePrice(model.pricing.prompt),
					completion: normalizePrice(model.pricing.completion),
					input_cache_read: normalizePrice(model.pricing.input_cache_read),
					input_cache_write: normalizePrice(model.pricing.input_cache_write),
				}
			: undefined,
	});

	return {
		...mapped,
		_pricingKnown: pricingKnown,
		...(freeKnown && {
			_freeKnown: true,
			_isFree: isAnyApiFreeModel(model),
		}),
	};
}

function isTextModel(model: AnyApiModel): boolean {
	const outputModalities = model.architecture?.output_modalities ?? [];
	if (outputModalities.length > 0 && !outputModalities.includes("text")) {
		return false;
	}

	const tags = model.tags;
	if (!tags || tags.length === 0) return true;
	return tags.some((tag) => tag.startsWith("chat_completions:"));
}

async function fetchAnyApiModels(
	apiKey: string,
	signal?: AbortSignal,
): Promise<AnyApiProviderModel[]> {
	const response = await fetchWithRetry(
		`${BASE_URL_ANYAPI}/models`,
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
		throw new Error(
			`AnyAPI API error: ${response.status} ${response.statusText}`,
		);
	}

	const json = (await response.json()) as { data?: AnyApiModel[] };
	const models = (json.data ?? []).flatMap((model) => {
		if (!model.id || !isTextModel(model)) return [];
		return [mapAnyApiModel(model)];
	});

	_logger.info(`[anyapi] Fetched ${models.length} text models`);

	// AnyAPI's /models response omits context and output limits for its
	// catalog. Use the global models.dev catalog so canonical model IDs such
	// as qwen/qwen3-coder:free do not fall back to the generic 4096-token
	// defaults in mapOpenRouterModel. The AnyAPI-scoped models.dev entry only
	// contains a small paid subset and does not cover the free catalog.
	const enriched = await safeEnrichModelsWithModelsDev(models);
	return applyHidden(
		enriched.map((model) => ({
			...model,
			_anyapiMetadataVersion: ANYAPI_METADATA_VERSION,
		})),
		PROVIDER_ANYAPI,
	) as AnyApiProviderModel[];
}

export default function anyapiProvider(pi: ExtensionAPI): Promise<void> {
	const initialModels = loadProviderCache(PROVIDER_ANYAPI) ?? [];
	registerNativeOpenAIProvider(pi, {
		providerId: PROVIDER_ANYAPI,
		name: "AnyAPI",
		baseUrl: BASE_URL_ANYAPI,
		auth: anyapiAuth,
		getApiKey: getAnyapiApiKey,
		getShowPaid: getAnyapiShowPaid,
		initialModels,
		fetchModels: async (apiKey, signal) => {
			const models = await fetchAnyApiModels(apiKey, signal);
			if (models.length > 0) await saveProviderCache(PROVIDER_ANYAPI, models);
			return models;
		},
		tosUrl: "https://anyapi.ai/terms-of-service",
		suppressTosWhenKey: true,
	});
	return Promise.resolve();
}
