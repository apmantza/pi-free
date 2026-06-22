/**
 * OpenModel Provider Extension
 *
 * OpenModel (https://openmodel.ai) is a multi-model LLM gateway exposing
 * ~40 models through three protocols:
 *   - /v1/messages   (Anthropic-compatible)  ← we use this
 *   - /v1/responses  (OpenAI Responses API)
 *   - /v1/gemini     (Gemini-compatible)
 *   - /v1/images     (image generation)
 *
 * The /v1/messages endpoint serves DeepSeek, Anthropic (Claude), DashScope
 * (Qwen), Xiaomi (MiMo), Moonshot (Kimi), MiniMax, and Zai models with a
 * standard Anthropic Messages request/response shape.
 *
 * Pricing is exposed via the public, no-auth catalog endpoint
 *   GET /web/v1/models?page=N    (paginated, 20 per page)
 * Effective cost = `prices.input_cost_per_token × price_multiplier`.
 * A `price_multiplier` of 0 makes a model free.
 *
 * Current DeepSeek V4 Flash Free Event: the `deepseek-v4-flash` model has
 * price_multiplier=0 (input $0 / output $0), 10 RPM / 100K TPM, up to
 * 1M-token context. See https://docs.openmodel.ai/en/docs/event.
 *
 * Setup:
 *   OPENMODEL_API_KEY=om-...
 *   # or add openmodel_api_key to ~/.pi/free.json
 */

import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import {
	getOpenmodelApiKey,
	getOpenmodelShowPaid,
	applyHidden,
} from "../../config.ts";
import {
	BASE_URL_OPENMODEL,
	DEFAULT_FETCH_TIMEOUT_MS,
	PROVIDER_OPENMODEL,
} from "../../constants.ts";
import { createLogger } from "../../lib/logger.ts";
import { safeEnrichModelsWithModelsDev } from "../../lib/model-metadata.ts";
import { isLikelyReasoningModel } from "../../lib/provider-compat.ts";
import { isFreeModel, registerWithGlobalToggle } from "../../lib/registry.ts";
import { fetchWithRetry } from "../../lib/util.ts";
import { createReRegister, setupProvider } from "../../provider-helper.ts";

const _logger = createLogger("openmodel");

// =============================================================================
// Types
// =============================================================================

/** A model item from the public, no-auth catalog endpoint /web/v1/models. */
interface OpenModelCatalogItem {
	key: string;
	provider_key: string;
	provider_name: string;
	prices: {
		input_cost_per_token?: number;
		output_cost_per_token?: number;
		cache_read_input_token_cost?: number;
		cache_creation_input_token_cost?: number;
		input_cost_per_image?: number;
		[key: string]: number | undefined;
	};
	max: {
		max_input_tokens?: number;
		max_output_tokens?: number;
		max_tokens?: number;
	};
	supports: {
		supports_vision?: boolean;
		supports_reasoning?: boolean;
		supports_function_calling?: boolean;
		supports_native_streaming?: boolean;
		supports_prompt_caching?: boolean;
		supports_system_messages?: boolean;
		supports_tool_choice?: boolean;
		supports_image_generation?: boolean;
		supports_audio_input?: boolean;
		supports_audio_output?: boolean;
		supports_video_input?: boolean;
		supports_pdf_input?: boolean;
		supports_url_context?: boolean;
		supports_web_search?: boolean;
		supports_assistant_prefill?: boolean;
		supports_computer_use?: boolean;
		supports_parallel_function_calling?: boolean;
		supports_response_schema?: boolean;
		supports_service_tier?: boolean;
	};
	price_multiplier: number;
}

/** A model item from the OpenAI-compatible /v1/models endpoint (auth required). */
interface OpenModelProtocolItem {
	id: string;
	object?: string;
	created?: number;
	owned_by?: string;
	supported_protocols?: string[];
}

interface OpenModelWebResponse<T> {
	success: boolean;
	meta?: {
		pagination?: {
			page: number;
			pageSize: number;
			total: number;
			totalPages: number;
		};
	};
	data: T[];
}

/**
 * Source of a model in the merged result.
 *   "priced"     — model has real pricing from /web/v1/models (Route A free detection)
 *   "unpriced"   — model has no web pricing; conservatively treated as paid
 */
type ModelSource = "priced" | "unpriced";

interface MergedOpenModelModel {
	item: OpenModelCatalogItem;
	source: ModelSource;
	/** True when the model's protocol set includes "messages". */
	supportsMessages: boolean;
}

// =============================================================================
// Helpers (exported for testing)
// =============================================================================

/** Strip the "free" alias suffix that the catalog uses for promo models. */
function cleanModelName(id: string): string {
	// The catalog returns ids like "1024-x-1024/gpt-image-1.5" — keep as-is.
	// For chat models like "deepseek-v4-flash", return the id directly.
	return id;
}

function toNumber(value: number | undefined): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Compute the effective per-token cost for a catalog item.
 * `price_multiplier` of 0 → all costs become 0 (free).
 */
export function effectiveCost(
	prices: OpenModelCatalogItem["prices"],
	multiplier: number,
): { input: number; output: number; cacheRead: number; cacheWrite: number } {
	if (multiplier === 0) {
		return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
	}
	return {
		input: toNumber(prices.input_cost_per_token) * multiplier,
		output: toNumber(prices.output_cost_per_token) * multiplier,
		cacheRead: toNumber(prices.cache_read_input_token_cost) * multiplier,
		cacheWrite: toNumber(prices.cache_creation_input_token_cost) * multiplier,
	};
}

function effectiveInputModalities(
	supports: OpenModelCatalogItem["supports"],
): readonly ("text" | "image")[] {
	const hasImage =
		supports.supports_vision ||
		supports.supports_pdf_input ||
		supports.supports_image_generation;
	return hasImage ? (["text", "image"] as const) : (["text"] as const);
}

function effectiveMaxTokens(item: OpenModelCatalogItem): number {
	return (
		item.max.max_output_tokens ??
		item.max.max_tokens ??
		// Anthropic Messages API requires max_tokens; fall back to a safe default.
		16_384
	);
}

function effectiveContextWindow(item: OpenModelCatalogItem): number {
	return item.max.max_input_tokens ?? 128_000;
}

/**
 * Detect whether a model is a reasoning model.
 * Prefer the explicit `supports.supports_reasoning` flag from the catalog;
 * fall back to name-based heuristics from provider-compat.
 */
function detectReasoning(item: OpenModelCatalogItem): boolean {
	if (item.supports.supports_reasoning === true) return true;
	return isLikelyReasoningModel({
		id: item.key,
		name: cleanModelName(item.key),
	});
}

/**
 * Build a {@link ProviderModelConfig} from a merged catalog item.
 * Pure function — no I/O — exported for unit testing.
 */
export function mapOpenModelModel(
	merged: MergedOpenModelModel,
): ProviderModelConfig & {
	_pricingKnown?: boolean;
	_freeKnown?: boolean;
	_isFree?: boolean;
} {
	const { item, source } = merged;
	const reasoning = detectReasoning(item);
	const multiplier = item.price_multiplier;
	const cost = effectiveCost(item.prices, multiplier);

	// The catalog returns multipliers in [0, 1]. If a model has input+output
	// costs > 0 but multiplier === 0, it is an explicit promo/free model.
	// Only set the authoritative _freeKnown override in two cases:
	//   1. priced + multiplier=0  → bulletproof free (handles edge case where
	//      every priced model happens to be cost-0, which would flip
	//      isFreeModel to Route B / name-based and hide this model).
	//   2. unpriced              → conservatively paid (no data to know).
	// For other priced models (multiplier>0 with real prices, OR missing
	// per-token prices), let isFreeModel's Route A decide from effective cost.
	const isAuthoritativelyFree = source === "priced" && multiplier === 0;
	const isAuthoritativelyPaid = source === "unpriced";

	return {
		id: item.key,
		name: cleanModelName(item.key),
		reasoning,
		input: effectiveInputModalities(item.supports),
		cost,
		contextWindow: effectiveContextWindow(item),
		maxTokens: effectiveMaxTokens(item),
		_pricingKnown: source === "priced",
		...(isAuthoritativelyFree && {
			_freeKnown: true as const,
			_isFree: true as const,
		}),
		...(isAuthoritativelyPaid && {
			_freeKnown: true as const,
			_isFree: false as const,
		}),
	} as ProviderModelConfig & {
		_pricingKnown?: boolean;
		_freeKnown?: boolean;
		_isFree?: boolean;
	};
}

/**
 * Merge the priced catalog (with real pricing) and the protocol list
 * (for protocol filtering), then return only the models whose protocol
 * set includes `"messages"`. Unpriced messages-protocol models are
 * included with source `"unpriced"` so the user can still see them
 * under /toggle-openmodel — we just don't claim they're free.
 *
 * Pure function — exported for unit testing.
 */
export function mergeOpenModelModels(
	catalog: OpenModelCatalogItem[],
	protocolItems: OpenModelProtocolItem[],
): MergedOpenModelModel[] {
	const protocolsById = new Map<string, string[]>();
	for (const item of protocolItems) {
		if (item.id) protocolsById.set(item.id, item.supported_protocols ?? []);
	}

	const seen = new Set<string>();
	const result: MergedOpenModelModel[] = [];

	// 1) Priced catalog models, filtered to "messages" support.
	for (const item of catalog) {
		if (!item.key) continue;
		const protocols = protocolsById.get(item.key) ?? [];
		if (!protocols.includes("messages")) continue;
		seen.add(item.key);
		result.push({
			item,
			source: "priced",
			supportsMessages: true,
		});
	}

	// 2) Unpriced messages-protocol models (e.g. MiniMax, MiMo, Kimi, Qwen).
	for (const item of protocolItems) {
		if (!item.id) continue;
		if (seen.has(item.id)) continue;
		const protocols = item.supported_protocols ?? [];
		if (!protocols.includes("messages")) continue;

		// Synthesize a minimal catalog item so mapOpenModelModel has
		// uniform input shape. All cost fields default to 0 and
		// reasoning is detected name-based.
		result.push({
			item: {
				key: item.id,
				provider_key: item.owned_by ?? "unknown",
				provider_name: item.owned_by ?? "unknown",
				prices: {},
				max: {},
				supports: {},
				price_multiplier: 1,
			},
			source: "unpriced",
			supportsMessages: true,
		});
	}

	return result;
}

// =============================================================================
// Fetch
// =============================================================================

const OPENMODEL_PAGINATION_DELAY_MS = 200;

async function fetchOpenModelWebCatalog(
	baseUrl: string,
): Promise<OpenModelCatalogItem[]> {
	const items: OpenModelCatalogItem[] = [];
	let cleanBase = baseUrl;
	while (cleanBase.endsWith("/")) cleanBase = cleanBase.slice(0, -1);
	let page = 1;

	while (true) {
		const url = `${cleanBase}/web/v1/models?page=${page}`;
		_logger.info(`[openmodel] Fetching public catalog page ${page}: ${url}`);

		const response = await fetchWithRetry(
			url,
			{ headers: { Accept: "application/json" } },
			3,
			1000,
			DEFAULT_FETCH_TIMEOUT_MS,
		);

		if (!response.ok) {
			throw new Error(
				`OpenModel web catalog error: ${response.status} ${response.statusText}`,
			);
		}

		const json =
			(await response.json()) as OpenModelWebResponse<OpenModelCatalogItem>;
		if (json.success !== true || !Array.isArray(json.data)) {
			throw new Error(
				"OpenModel web catalog: unexpected response shape (missing success/data)",
			);
		}

		items.push(...json.data);

		const pagination = json.meta?.pagination;
		if (
			!pagination ||
			page >= pagination.totalPages ||
			json.data.length === 0
		) {
			break;
		}
		page += 1;
		// Be polite to the public endpoint — small delay between pages.
		await new Promise((resolve) =>
			setTimeout(resolve, OPENMODEL_PAGINATION_DELAY_MS),
		);
	}

	_logger.info(
		`[openmodel] Fetched ${items.length} models from public catalog`,
	);
	return items;
}

async function fetchOpenModelProtocols(
	apiKey: string,
	baseUrl: string,
): Promise<OpenModelProtocolItem[]> {
	let cleanBase = baseUrl;
	while (cleanBase.endsWith("/")) cleanBase = cleanBase.slice(0, -1);
	const response = await fetchWithRetry(
		`${cleanBase}/v1/models`,
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
		throw new Error(
			`OpenModel /v1/models error: ${response.status} ${response.statusText}`,
		);
	}

	const json = (await response.json()) as
		| { data?: OpenModelProtocolItem[] }
		| OpenModelProtocolItem[];
	const items = Array.isArray(json) ? json : (json.data ?? []);
	_logger.info(`[openmodel] Fetched ${items.length} protocol entries`);
	return items;
}

async function fetchOpenModelModels(
	apiKey: string,
): Promise<ProviderModelConfig[]> {
	const [catalog, protocols] = await Promise.all([
		fetchOpenModelWebCatalog(BASE_URL_OPENMODEL).catch((error) => {
			_logger.error("[openmodel] Failed to fetch public catalog", {
				error: error instanceof Error ? error.message : String(error),
			});
			return [] as OpenModelCatalogItem[];
		}),
		fetchOpenModelProtocols(apiKey, BASE_URL_OPENMODEL).catch((error) => {
			_logger.error("[openmodel] Failed to fetch /v1/models", {
				error: error instanceof Error ? error.message : String(error),
			});
			return [] as OpenModelProtocolItem[];
		}),
	]);

	if (catalog.length === 0 && protocols.length === 0) {
		_logger.warn(
			"[openmodel] Both catalog and protocol fetch failed — no models to register",
		);
		return [];
	}

	const merged = mergeOpenModelModels(catalog, protocols);
	const mapped = merged.map(mapOpenModelModel);

	const pricedCount = merged.filter((m) => m.source === "priced").length;
	const unpricedCount = merged.length - pricedCount;
	_logger.info(
		`[openmodel] ${merged.length} messages-protocol models (${pricedCount} priced, ${unpricedCount} unpriced)`,
	);

	const enriched = await safeEnrichModelsWithModelsDev(mapped, {
		providerId: PROVIDER_OPENMODEL,
	});
	return applyHidden(enriched, PROVIDER_OPENMODEL);
}

// =============================================================================
// Extension Entry Point
// =============================================================================

export default async function openmodelProvider(pi: ExtensionAPI) {
	const apiKey = getOpenmodelApiKey();

	if (!apiKey) {
		_logger.info(
			"[openmodel] Skipping — OPENMODEL_API_KEY not set. Sign up at https://openmodel.ai/",
		);
		return;
	}

	const allModels = await fetchOpenModelModels(apiKey);

	if (allModels.length === 0) {
		_logger.warn(
			"[openmodel] No models available — verify OPENMODEL_API_KEY is valid and see ~/.pi/free.log for details",
		);
		return;
	}

	// isFreeModel handles the heavy lifting:
	//   - Priced models (multiplier>0): Route A — free if effective cost is 0.
	//   - Free-event models (multiplier=0, e.g. deepseek-v4-flash): Route A
	//     sees cost 0 → free. This is the headline free model.
	//   - Unpriced models: _freeKnown=true, _isFree=false → definitively paid.
	const freeModels = allModels.filter((m) =>
		isFreeModel({ ...m, provider: PROVIDER_OPENMODEL }, allModels),
	);
	const stored = { free: freeModels, all: allModels };

	_logger.info(
		`[openmodel] Registered ${allModels.length} models (${freeModels.length} free)`,
	);

	const reRegister = createReRegister(pi, {
		providerId: PROVIDER_OPENMODEL,
		baseUrl: BASE_URL_OPENMODEL,
		apiKey,
		// OpenModel is an Anthropic-protocol gateway — /v1/chat/completions
		// does not exist on it. Without `api: "anthropic-messages"`, the
		// helper defaults to openai-completions and pi-ai POSTs to a 404
		// path. Pin the wire format so it dispatches to the Anthropic SDK.
		api: "anthropic-messages",
	});

	registerWithGlobalToggle(PROVIDER_OPENMODEL, stored, reRegister, true);

	setupProvider(
		pi,
		{
			providerId: PROVIDER_OPENMODEL,
			initialShowPaid: getOpenmodelShowPaid(),
			tosUrl: "https://docs.openmodel.ai/en/docs",
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

	const showPaid = getOpenmodelShowPaid();
	const initialModels =
		showPaid && stored.all.length > 0 ? stored.all : freeModels;
	reRegister(initialModels);
}
