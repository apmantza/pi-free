/**
 * Requesty's public model catalog (router.requesty.ai/v1/models).
 *
 * The schema is Requesty-specific — flat `input_price`/`output_price` numbers,
 * a `context_window` field, and `supports_*` capability flags — so it is
 * mapped here instead of through the shared OpenRouter-compatible fetcher.
 * Pricing is exposed inline for every model, which feeds pi-free's
 * cost-based free-model detection (Route A) without any curated list.
 */

import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { type ChatModelConfig } from "../../lib/types.ts";
import { applyHidden } from "../../config.ts";
import {
	BASE_URL_REQUESTY,
	DEFAULT_FETCH_TIMEOUT_MS,
	PROVIDER_REQUESTY,
} from "../../constants.ts";
import { createLogger } from "../../lib/logger.ts";
import {
	firstPositiveLimit,
	keepToolCallingModels,
	perMillionFromPerToken,
} from "../../lib/model-map.ts";
import { fetchWithRetry, withSignal } from "../../lib/util.ts";

const _logger = createLogger("requesty-models");

interface RequestyCatalogModel {
	id?: unknown;
	api?: unknown;
	input_price?: unknown;
	output_price?: unknown;
	cached_price?: unknown;
	caching_price?: unknown;
	context_window?: unknown;
	max_output_tokens?: unknown;
	supports_reasoning?: unknown;
	supports_tool_calling?: unknown;
	supports_vision?: unknown;
	supports_image_generation?: unknown;
	retires?: unknown;
	description?: unknown;
}

/** Fallback context window for entries that omit `context_window`. */
const FALLBACK_CONTEXT_WINDOW = 128_000;

/**
 * Fallback output limit where `max_output_tokens` is 0 (unpublished; 114 of
 * 727 live chat rows on 2026-11-15, e.g. deepinfra/deepseek-v4.1-flash-1017).
 * The prior 4096 cut long answers and left reasoning models no room to
 * answer after thinking; 16384 is the unpublished-limit default the other
 * gateway catalogs here use (Novita, Routeway, OpenGateway, InferX).
 */
const FALLBACK_MAX_TOKENS = 16_384;

/**
 * Whether a row is still served at `now`. `retires` is a Unix time in
 * seconds; rows past it stay listed (38 of 727 live chat rows on
 * 2026-11-15, e.g. google/gemini-2.5-flash, retired 2026-10-16). An absent
 * field means no retirement is scheduled; any other value is unrecognized
 * and refused.
 */
function isStillServed(entry: RequestyCatalogModel, now: number): boolean {
	const retires = entry.retires;
	if (retires === undefined) return true;
	return typeof retires === "number" && retires * 1000 > now;
}

function asNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

/** Requesty quotes USD per token; `Model.cost` is USD per million. */
function asPricePerMillion(value: unknown): number | undefined {
	const price = asNumber(value);
	return price === undefined ? undefined : perMillionFromPerToken(price);
}

/**
 * Map one catalog entry to the pi-free model config shape. Returns undefined
 * for non-chat endpoints and unusable entries rather than guessing.
 */
export function mapRequestyModel(
	entry: RequestyCatalogModel,
): ChatModelConfig | undefined {
	if (typeof entry.id !== "string" || entry.id.length === 0) return undefined;
	// The /models endpoint also serves image-generation and other api types;
	// only chat completions are usable as an agent model.
	if (entry.api !== "chat") return undefined;
	// Image-generation models are served through the chat surface but cannot
	// act as agent chat models (23 live on 2026-10-15, #608). Vision
	// *understanding* (supports_vision) stays: it is legitimate chat input.
	if (entry.supports_image_generation === true) return undefined;
	// NVIDIA NIM guard classifiers are served through the chat surface but
	// cannot hold a conversation.
	if (entry.id.includes("content-safety")) return undefined;

	const inputPrice = asPricePerMillion(entry.input_price);
	const outputPrice = asPricePerMillion(entry.output_price);
	// SAFETY: a missing/non-numeric price is a parse miss, not a zero price.
	// Defaulting to 0 without the marker lets Route A classify a paid model
	// as free whenever any sibling exposes pricing (#610). Both standard
	// prices must parse; cache prices are informational only and never gate
	// the free/paid verdict.
	const pricingKnown = inputPrice !== undefined && outputPrice !== undefined;

	return {
		id: entry.id,
		name: entry.id,
		reasoning: entry.supports_reasoning === true,
		input: entry.supports_vision === true ? ["text", "image"] : ["text"],
		cost: {
			input: inputPrice ?? 0,
			output: outputPrice ?? 0,
			cacheRead: asPricePerMillion(entry.cached_price) ?? 0,
			cacheWrite: asPricePerMillion(entry.caching_price) ?? 0,
		},
		contextWindow: asNumber(entry.context_window) ?? FALLBACK_CONTEXT_WINDOW,
		maxTokens:
			firstPositiveLimit(asNumber(entry.max_output_tokens)) ??
			FALLBACK_MAX_TOKENS,
		_pricingKnown: pricingKnown,
	} as ChatModelConfig & { _pricingKnown?: boolean };
}

/**
 * Fetch the complete catalog. Requesty's /models answers without a key, so
 * the key is sent only when present; in production Pi calls this only once
 * the provider's auth resolves (see requesty.ts).
 */
export async function fetchRequestyModels(
	apiKey: string,
	signal?: AbortSignal,
): Promise<ProviderModelConfig[]> {
	const headers: Record<string, string> = {
		Accept: "application/json",
	};
	if (apiKey) {
		headers.Authorization = `Bearer ${apiKey}`;
	}
	const response = await fetchWithRetry(
		`${BASE_URL_REQUESTY}/models`,
		withSignal(
			{
				headers,
			},
			signal,
		),
		1,
		1_000,
		DEFAULT_FETCH_TIMEOUT_MS,
	);
	if (!response.ok) {
		throw new Error(`Requesty catalog returned HTTP ${response.status}`);
	}
	const payload: unknown = await response.json();
	const entries =
		payload &&
		typeof payload === "object" &&
		Array.isArray((payload as { data?: unknown }).data)
			? ((payload as { data: unknown[] }).data as RequestyCatalogModel[])
			: [];
	const now = Date.now();
	const served = entries.filter((entry) => isStillServed(entry, now));
	const toolCalling = keepToolCallingModels(
		PROVIDER_REQUESTY,
		served,
		(entry) => entry.supports_tool_calling === true,
	);
	const models: ProviderModelConfig[] = [];
	for (const entry of toolCalling) {
		const mapped = mapRequestyModel(entry);
		if (mapped) models.push(mapped);
	}
	if (models.length === 0) {
		_logger.warn("Requesty catalog returned no usable chat models");
	}
	return applyHidden(models, PROVIDER_REQUESTY);
}
