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
import { safeEnrichModelsWithModelsDev } from "../../lib/model-metadata.ts";
import {
	fetchWithRetry,
	mapOpenRouterModel,
	withSignal,
} from "../../lib/util.ts";
import {
	registerNativeOpenAIProvider,
	type NativeOpenAIProviderOptions,
} from "../../lib/native-provider.ts";
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

function normalizePrice(
	value: string | number | null | undefined,
): string | null {
	return value === null || value === undefined ? null : String(value);
}

/**
 * Map one AnyAPI row through the shared OpenRouter mapper, which owns the
 * price rule: only numeric, non-negative prompt AND completion prices are
 * known (`_pricingKnown`); "", missing, cache-only and router "-1" rows stay
 * pricing-unknown with placeholder $0 costs (defect shape 15).
 */
function mapCatalogRow(model: AnyApiModel): AnyApiProviderModel {
	const name = model.name ?? model.id;
	const tags = model.tags ?? [];
	const supportsReasoning =
		tags.includes("reasoning") || tags.includes("chat_completions:reasoning");
	const supportsVision =
		tags.includes("vision") || tags.includes("chat_completions:vision");

	return mapOpenRouterModel({
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
}

function hasFreeLabel(model: AnyApiModel): boolean {
	return /\bfree\b/i.test(`${model.id} ${model.name ?? ""}`);
}

function isKnownZeroPrice(mapped: AnyApiProviderModel): boolean {
	return (
		mapped._pricingKnown === true &&
		mapped.cost.input === 0 &&
		mapped.cost.output === 0
	);
}

/**
 * Detect AnyAPI's explicitly free model labels without treating every model
 * with omitted pricing as free. The API may also expose an authoritative flag
 * or a known $0 prompt and completion price, both of which are handled here.
 */
export function isAnyApiFreeModel(model: AnyApiModel): boolean {
	if (typeof model.isFree === "boolean") return model.isFree;
	return hasFreeLabel(model) || isKnownZeroPrice(mapCatalogRow(model));
}

export function mapAnyApiModel(model: AnyApiModel): AnyApiProviderModel {
	const mapped = mapCatalogRow(model);
	const freeKnown =
		typeof model.isFree === "boolean" ||
		hasFreeLabel(model) ||
		isKnownZeroPrice(mapped);

	return {
		...mapped,
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
		withSignal(
			{
				headers: {
					Authorization: `Bearer ${apiKey}`,
					Accept: "application/json",
					"Content-Type": "application/json",
				},
			},
			signal,
		),
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

export const anyapiProviderOptions: NativeOpenAIProviderOptions = {
	providerId: PROVIDER_ANYAPI,
	name: "AnyAPI",
	baseUrl: BASE_URL_ANYAPI,
	auth: anyapiAuth,
	getApiKey: getAnyapiApiKey,
	getShowPaid: getAnyapiShowPaid,
	fetchModels: (apiKey, signal) => fetchAnyApiModels(apiKey, signal),
	tosUrl: "https://anyapi.ai/terms-of-service",
	suppressTosWhenKey: true,
};

export default function anyapiProvider(pi: ExtensionAPI): Promise<void> {
	registerNativeOpenAIProvider(pi, anyapiProviderOptions);
	return Promise.resolve();
}
