/**
 * Gitlawb OpenGateway provider.
 *
 * OpenGateway is an OpenAI-compatible gateway at
 * https://opengateway.gitlawb.com/v1. Its model catalog includes paid models,
 * smart routing, and time-limited/free promotional models.
 *
 * Setup:
 *   OPENGATEWAY_API_KEY=ogw_live_...
 *   # or add opengateway_api_key to ~/.pi/free.json
 */

import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import {
	applyHidden,
	getOpengatewayApiKey,
	getOpengatewayShowPaid,
} from "../../config.ts";
import {
	BASE_URL_OPENGATEWAY,
	DEFAULT_FETCH_TIMEOUT_MS,
	PROVIDER_OPENGATEWAY,
} from "../../constants.ts";
import { createLogger } from "../../lib/logger.ts";
import { registerNativeOpenAIProvider } from "../../lib/native-provider.ts";
import {
	getProxyModelCompat,
	isLikelyReasoningModel,
} from "../../lib/provider-compat.ts";
import { fetchWithRetry } from "../../lib/util.ts";
import { opengatewayAuth } from "./opengateway-auth.ts";

const _logger = createLogger("opengateway");
const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 16_384;

interface OpenGatewayPricing {
	prompt?: string | number | null;
	completion?: string | number | null;
	input_cache_read?: string | number | null;
	input_cache_write?: string | number | null;
}

interface OpenGatewayPromo {
	discount?: number | null;
	ends_at?: string | null;
	note?: string | null;
}

export interface OpenGatewayModel {
	id: string;
	name?: string;
	description?: string;
	context_window?: number | null;
	pricing?: OpenGatewayPricing | null;
	effective_pricing?: OpenGatewayPricing | null;
	promo?: OpenGatewayPromo | null;
}

type OpenGatewayProviderModel = ProviderModelConfig & {
	_pricingKnown?: boolean;
	_freeKnown?: boolean;
	_isFree?: boolean;
};

const INITIAL_OPEN_GATEWAY_MODELS: OpenGatewayModel[] = [
	{
		id: "auto",
		name: "Auto (smart routing)",
		description: "Picks the cheapest capable model and escalates on failure",
	},
	{
		id: "mimo-v2.5-pro",
		name: "MiMo V2.5-Pro",
		context_window: 262_144,
		effective_pricing: {
			prompt: "0.000000522",
			completion: "0.000001044",
			input_cache_read: "0.00000000432",
		},
	},
	{
		id: "mimo-v2.5",
		name: "MiMo V2.5",
		context_window: 262_144,
		effective_pricing: {
			prompt: "0.000000168",
			completion: "0.000000336",
			input_cache_read: "0.00000000336",
		},
	},
	{
		id: "google/gemini-3.1-flash-lite",
		name: "Gemini 3.1 Flash Lite",
		context_window: 1_048_576,
		effective_pricing: {
			prompt: "0.0000003",
			completion: "0.0000018",
			input_cache_read: "0.00000003",
		},
	},
	{
		id: "minimax/minimax-m3",
		name: "MiniMax M3",
		context_window: 204_800,
		effective_pricing: {
			prompt: "0.00000036",
			completion: "0.00000144",
			input_cache_read: "0.000000072",
		},
	},
	{
		id: "qwen/qwen3.7-max",
		name: "Qwen 3.7 Max",
		context_window: 262_144,
		effective_pricing: {
			prompt: "0.0000015",
			completion: "0.0000045",
			input_cache_read: "0.0000003",
		},
	},
	{
		id: "moonshotai/kimi-k3",
		name: "Kimi K3",
		context_window: 1_048_576,
		effective_pricing: {
			prompt: "0.0000036",
			completion: "0.000018",
			input_cache_read: "0.00000036",
		},
	},
	{
		id: "z-ai/glm-5.2",
		name: "GLM 5.2",
		context_window: 1_048_576,
		effective_pricing: {
			prompt: "0.00000168",
			completion: "0.00000528",
			input_cache_read: "0.000000312",
		},
	},
	{
		id: "nvidia/nemotron-3-ultra-550b-a55b:free",
		name: "Nemotron 3 Ultra",
		context_window: 131_072,
		effective_pricing: { prompt: 0, completion: 0, input_cache_read: 0 },
	},
	{
		id: "inclusionai/ling-3.0-flash:free",
		name: "Ling 3.0 Flash",
		context_window: 262_144,
		effective_pricing: { prompt: 0, completion: 0, input_cache_read: 0 },
	},
	{
		id: "tencent/hy3",
		name: "Tencent HY3",
		context_window: 262_144,
		effective_pricing: {
			prompt: "0.00000024",
			completion: "0.00000096",
			input_cache_read: "0.00000006",
		},
	},
	{
		id: "mindai/macaron-v1-tall",
		name: "Macaron V1 Tall",
		context_window: 262_144,
		effective_pricing: { prompt: 0, completion: 0, input_cache_read: 0 },
	},
];

function normalizeModelId(id: string): string {
	if (id === "xiaomi/mimo-v2.5-pro" || id === "xiaomi/mimo-v2.5") {
		return id.slice("xiaomi/".length);
	}
	return id;
}

function parsePrice(value: string | number | null | undefined): number {
	const parsed = typeof value === "number" ? value : Number(value);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function hasCompletePricing(
	pricing: OpenGatewayPricing | null | undefined,
): pricing is OpenGatewayPricing {
	return (
		pricing?.prompt !== null &&
		pricing?.prompt !== undefined &&
		pricing?.completion !== null &&
		pricing?.completion !== undefined
	);
}

function supportsImages(id: string): boolean {
	return /(?:mimo-v2\.5|gemini|kimi-k3|tencent\/hy3)/iu.test(id);
}

export function mapOpenGatewayModel(
	model: OpenGatewayModel,
): OpenGatewayProviderModel {
	const id = normalizeModelId(model.id);
	const name = model.name?.trim() || id;
	const pricing = hasCompletePricing(model.effective_pricing)
		? model.effective_pricing
		: model.pricing;
	const pricingKnown = hasCompletePricing(pricing);
	const input = parsePrice(pricing?.prompt);
	const output = parsePrice(pricing?.completion);
	const isFree = pricingKnown && input === 0 && output === 0;
	const freeKnown = pricingKnown;
	const contextWindow =
		model.context_window && model.context_window > 0
			? model.context_window
			: DEFAULT_CONTEXT_WINDOW;

	return {
		id,
		name: `${name} (OpenGateway)`,
		reasoning: isLikelyReasoningModel({ id, name }),
		input: supportsImages(id) ? ["text", "image"] : ["text"],
		cost: {
			input,
			output,
			cacheRead: parsePrice(pricing?.input_cache_read),
			cacheWrite: parsePrice(pricing?.input_cache_write),
		},
		contextWindow,
		maxTokens: DEFAULT_MAX_TOKENS,
		compat: getProxyModelCompat({ id, name }),
		_pricingKnown: pricingKnown,
		...(freeKnown
			? {
					_freeKnown: true,
					_isFree: isFree,
				}
			: {}),
	};
}

export function getInitialOpenGatewayModels(): ProviderModelConfig[] {
	return applyHidden(
		INITIAL_OPEN_GATEWAY_MODELS.map(mapOpenGatewayModel),
		PROVIDER_OPENGATEWAY,
	);
}

export async function fetchOpenGatewayModels(
	apiKey: string,
	signal?: AbortSignal,
): Promise<ProviderModelConfig[]> {
	const response = await fetchWithRetry(
		`${BASE_URL_OPENGATEWAY}/models`,
		{
			headers: {
				Authorization: `Bearer ${apiKey}`,
				Accept: "application/json",
				"Content-Type": "application/json",
				"User-Agent": "pi-free-providers",
			},
			signal,
		},
		3,
		1000,
		DEFAULT_FETCH_TIMEOUT_MS,
	);

	if (!response.ok) {
		throw new Error(
			`OpenGateway API error: ${response.status} ${response.statusText}`,
		);
	}

	const json = (await response.json()) as { data?: OpenGatewayModel[] };
	const models = (json.data ?? []).flatMap((model) => {
		if (typeof model.id !== "string" || model.id.trim().length === 0) {
			return [];
		}
		return [mapOpenGatewayModel(model)];
	});

	_logger.info(`[opengateway] Fetched ${models.length} models`);
	return applyHidden(models, PROVIDER_OPENGATEWAY);
}

export default function opengatewayProvider(pi: ExtensionAPI): Promise<void> {
	registerNativeOpenAIProvider(pi, {
		providerId: PROVIDER_OPENGATEWAY,
		name: "OpenGateway",
		baseUrl: BASE_URL_OPENGATEWAY,
		auth: opengatewayAuth,
		getApiKey: getOpengatewayApiKey,
		getShowPaid: getOpengatewayShowPaid,
		initialModels: getInitialOpenGatewayModels(),
		fetchModels: (apiKey, signal) => fetchOpenGatewayModels(apiKey, signal),
		tosUrl: "https://gitlawb.com/opengateway",
		suppressTosWhenKey: true,
	});
	return Promise.resolve();
}
