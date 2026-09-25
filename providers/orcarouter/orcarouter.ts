/**
 * OrcaRouter provider extension.
 *
 * OrcaRouter (https://orcarouter.ai) is an OpenAI-compatible gateway. It
 * exposes the catalog at /v1/models and routes chat requests through
 * /v1/chat/completions.
 *
 * Free models are the `-free`-suffixed entries (e.g.
 * `deepseek/deepseek-v4-flash-free`, `tencent/hy3-free`,
 * `z-ai/glm-5.3-flash-free`, plus the `orcarouter/free` router model).
 * The gateway prices them with `pricing.request = "0.000000"` instead of
 * the usual prompt/completion pair, which the free detection below handles
 * explicitly. Paid models carry nonzero prompt/completion pricing, and the
 * `orcarouter/fusion*` house router models expose no pricing at all — those
 * are never treated as free.
 *
 * Setup:
 *   ORCAROUTER_API_KEY=sk-orca-...
 *   # or add orcarouter_api_key to ~/.pi/free.json
 */

import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import {
	applyHidden,
	getOrcarouterApiKey,
	getOrcarouterShowPaid,
} from "../../config.ts";
import {
	BASE_URL_ORCAROUTER,
	DEFAULT_FETCH_TIMEOUT_MS,
	PROVIDER_ORCAROUTER,
} from "../../constants.ts";
import { createLogger } from "../../lib/logger.ts";
import { safeEnrichModelsWithModelsDev } from "../../lib/model-metadata.ts";
import {
	getProxyModelCompat,
	isLikelyReasoningModel,
} from "../../lib/provider-compat.ts";
import {
	fetchWithRetry,
	mapOpenRouterModel,
	withSignal,
} from "../../lib/util.ts";
import { registerNativeOpenAIProvider } from "../../lib/native-provider.ts";
import { orcarouterAuth } from "./orcarouter-auth.ts";

const _logger = createLogger("orcarouter");

interface OrcaRouterPricing {
	prompt?: string | number | null;
	completion?: string | number | null;
	input_cache_read?: string | number | null;
	input_cache_write?: string | number | null;
	/** Per-request pricing used by the gateway's free models. */
	request?: string | number | null;
}

interface OrcaRouterModel {
	id: string;
	name?: string;
	context_length?: number;
	max_completion_tokens?: number | null;
	top_provider?: {
		context_length?: number | null;
		max_completion_tokens?: number | null;
	};
	pricing?: OrcaRouterPricing | null;
	architecture?: {
		input_modalities?: string[] | null;
		output_modalities?: string[] | null;
	} | null;
	supported_parameters?: string[] | null;
	supported_endpoint_types?: string[] | null;
	isFree?: boolean;
}

const ORCAROUTER_METADATA_VERSION = 1;

type OrcaRouterProviderModel = ProviderModelConfig & {
	_pricingKnown?: boolean;
	_freeKnown?: boolean;
	_isFree?: boolean;
	_orcarouterMetadataVersion?: number;
};

function hasPricing(model: OrcaRouterModel): boolean {
	const pricing = model.pricing;
	if (!pricing) return false;
	return (
		(pricing.prompt !== null &&
			pricing.prompt !== undefined &&
			pricing.prompt !== "") ||
		(pricing.completion !== null &&
			pricing.completion !== undefined &&
			pricing.completion !== "") ||
		(pricing.input_cache_read !== null &&
			pricing.input_cache_read !== undefined &&
			pricing.input_cache_read !== "") ||
		(pricing.input_cache_write !== null &&
			pricing.input_cache_write !== undefined &&
			pricing.input_cache_write !== "") ||
		(pricing.request !== null &&
			pricing.request !== undefined &&
			pricing.request !== "")
	);
}

function normalizePrice(
	value: string | number | null | undefined,
): string | null {
	return value === null || value === undefined || value === ""
		? null
		: String(value);
}

/**
 * Detect OrcaRouter's explicitly free models without treating every model
 * with omitted pricing as free. The gateway prices its free tier with
 * `request: "0.000000"`, and the house `orcarouter/fusion*` router models
 * expose no pricing at all — those stay paid-hidden under free-only mode.
 */
export function isOrcaRouterFreeModel(model: OrcaRouterModel): boolean {
	if (typeof model.isFree === "boolean") return model.isFree;

	const label = `${model.id} ${model.name ?? ""}`.toLowerCase();
	if (/\bfree\b/.test(label)) return true;

	if (!hasPricing(model)) return false;
	const request = Number(model.pricing?.request);
	if (
		model.pricing?.request !== null &&
		model.pricing?.request !== undefined &&
		model.pricing?.request !== "" &&
		request === 0
	) {
		return true;
	}
	const input = Number(model.pricing?.prompt);
	const output = Number(model.pricing?.completion);
	return input === 0 && output === 0;
}

/** Text-capable chat endpoints (excludes image/video/audio-only types). */
const CHAT_ENDPOINT_TYPES = new Set([
	"openai",
	"openai-response",
	"anthropic",
	"anthropic-compatible",
	"gemini",
]);

function isTextChatModel(model: OrcaRouterModel): boolean {
	const outputModalities = model.architecture?.output_modalities ?? [];
	if (outputModalities.length > 0 && !outputModalities.includes("text")) {
		return false;
	}
	const endpoints = model.supported_endpoint_types ?? [];
	if (endpoints.length === 0) {
		// No endpoint info — assume text chat (matches the B.AI fallback).
		return true;
	}
	return endpoints.some((t) => CHAT_ENDPOINT_TYPES.has(t));
}

export function mapOrcaRouterModel(
	model: OrcaRouterModel,
): OrcaRouterProviderModel {
	const name = model.name ?? model.id;
	const pricingKnown = hasPricing(model);
	const freeKnown =
		typeof model.isFree === "boolean" ||
		/\bfree\b/i.test(`${model.id} ${name}`) ||
		(pricingKnown && isOrcaRouterFreeModel(model));

	const supportedParameters = model.supported_parameters ?? [];
	const reasoning =
		supportedParameters.includes("reasoning") ||
		supportedParameters.includes("reasoning_effort") ||
		isLikelyReasoningModel({ id: model.id, name });

	const mapped = mapOpenRouterModel({
		...model,
		name,
		supported_parameters: model.supported_parameters ?? null,
		architecture: model.architecture ?? {
			input_modalities: ["text"],
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
		reasoning,
		...(reasoning && { thinkingLevelMap: { off: "none" } }),
		compat: getProxyModelCompat({ id: model.id, name }),
		_pricingKnown: pricingKnown,
		...(freeKnown && {
			_freeKnown: true,
			_isFree: isOrcaRouterFreeModel(model),
		}),
	};
}

async function fetchOrcaRouterModels(
	apiKey: string,
	signal?: AbortSignal,
): Promise<OrcaRouterProviderModel[]> {
	const response = await fetchWithRetry(
		`${BASE_URL_ORCAROUTER}/models`,
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
			`OrcaRouter API error: ${response.status} ${response.statusText}`,
		);
	}

	const json = (await response.json()) as { data?: OrcaRouterModel[] };
	const models = (json.data ?? []).flatMap((model) => {
		if (!model.id || !isTextChatModel(model)) return [];
		return [mapOrcaRouterModel(model)];
	});

	_logger.info(`[orcarouter] Fetched ${models.length} text models`);

	const enriched = await safeEnrichModelsWithModelsDev(models);
	return applyHidden(
		enriched.map((model) => ({
			...model,
			_orcarouterMetadataVersion: ORCAROUTER_METADATA_VERSION,
		})),
		PROVIDER_ORCAROUTER,
	) as OrcaRouterProviderModel[];
}

export default function orcarouterProvider(pi: ExtensionAPI): Promise<void> {
	registerNativeOpenAIProvider(pi, {
		providerId: PROVIDER_ORCAROUTER,
		name: "OrcaRouter",
		baseUrl: BASE_URL_ORCAROUTER,
		auth: orcarouterAuth,
		getApiKey: getOrcarouterApiKey,
		getShowPaid: getOrcarouterShowPaid,
		fetchModels: (apiKey, signal) => fetchOrcaRouterModels(apiKey, signal),
		tosUrl: "https://orcarouter.ai/terms",
		suppressTosWhenKey: true,
	});
	return Promise.resolve();
}
