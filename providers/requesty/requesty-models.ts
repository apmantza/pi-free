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
import { perMillionFromPerToken } from "../../lib/model-map.ts";
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
	description?: unknown;
}

/** Fallback context window for entries that omit `context_window`. */
const FALLBACK_CONTEXT_WINDOW = 128_000;

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
		maxTokens: asNumber(entry.max_output_tokens) || 4_096,
		_pricingKnown: pricingKnown,
	} as ChatModelConfig & { _pricingKnown?: boolean };
}

/**
 * Fetch the complete public catalog. The key is optional for /models; it is
 * only passed when configured so public discovery works for logged-out users.
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
	const models: ProviderModelConfig[] = [];
	for (const entry of entries) {
		const mapped = mapRequestyModel(entry);
		if (mapped) models.push(mapped);
	}
	if (models.length === 0) {
		_logger.warn("Requesty catalog returned no usable chat models");
	}
	return applyHidden(models, PROVIDER_REQUESTY);
}
