/**
 * Venice AI model catalog (api.venice.ai/api/v1/models?type=text).
 *
 * The schema is Venice-specific — nested `model_spec` with per-million-token
 * `pricing.{input,output,cache_input,cache_write}.usd` and a
 * `capabilities` flag block — so it is mapped here instead of through the
 * shared OpenRouter-compatible fetcher. Pricing is exposed inline for every
 * text model, which feeds pi-free's cost-based free-model detection (Route A)
 * without any curated list.
 *
 * Units: pi-free's Model.cost fields are USD per token (OpenRouter convention),
 * while Venice reports USD per million tokens — hence the 1e6 divisor.
 *
 * Balance gate: Venice requires a POSITIVE account balance for ALL inference,
 * including zero-priced models — a $0/$0 catalog entry still answers HTTP 402
 * "Insufficient USD or Diem balance" for an unfunded key (verified live).
 * Zero cost therefore does NOT mean usable-for-free, so every Venice model is
 * stamped `_freeKnown: true, _isFree: false` (the same authoritative override
 * OpenRouter uses) to keep unfunded models out of the free-only view.
 */

import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { applyHidden } from "../../config.ts";
import {
	BASE_URL_VENICE,
	DEFAULT_FETCH_TIMEOUT_MS,
	PROVIDER_VENICE,
} from "../../constants.ts";
import { createLogger } from "../../lib/logger.ts";
import { fetchWithRetry } from "../../lib/util.ts";

const _logger = createLogger("venice-models");

interface VeniceCatalogPrice {
	usd?: unknown;
}

interface VeniceCatalogModel {
	id?: unknown;
	type?: unknown;
	context_length?: unknown;
	model_spec?: {
		name?: unknown;
		pricing?: {
			input?: VeniceCatalogPrice;
			output?: VeniceCatalogPrice;
			cache_input?: VeniceCatalogPrice;
			cache_write?: VeniceCatalogPrice;
		};
		availableContextTokens?: unknown;
		maxCompletionTokens?: unknown;
		capabilities?: {
			supportsReasoning?: unknown;
			supportsVision?: unknown;
			supportsMultipleImages?: unknown;
			supportsFunctionCalling?: unknown;
		};
		description?: unknown;
	};
}

/** Fallback context window for entries that omit `context_length`. */
const FALLBACK_CONTEXT_WINDOW = 128_000;

/** Fallback max output tokens for entries that omit `maxCompletionTokens`. */
const FALLBACK_MAX_TOKENS = 4_096;

function asNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Convert a Venice usd-per-million price to the pi-free per-token unit. */
function usdPerMillionToPerToken(
	price: VeniceCatalogPrice | undefined,
): number {
	return (asNumber(price?.usd) ?? 0) / 1_000_000;
}

/**
 * Map one catalog entry to the pi-free model config shape. Returns undefined
 * for non-text endpoints and unusable entries rather than guessing.
 */
export function mapVeniceModel(
	entry: VeniceCatalogModel,
): ProviderModelConfig | undefined {
	if (typeof entry.id !== "string" || entry.id.length === 0) return undefined;
	// The /models endpoint also serves image, audio, video, and embedding
	// models; only chat-completions ("text") models are usable as agent
	// models. Strict check: entries missing `type` are rejected rather than
	// assumed text (matches the Agnes defensive posture).
	if (entry.type !== "text") return undefined;

	const spec = entry.model_spec ?? {};
	const capabilities = spec.capabilities ?? {};
	const vision =
		capabilities.supportsVision === true ||
		capabilities.supportsMultipleImages === true;

	return {
		id: entry.id,
		name:
			typeof spec.name === "string" && spec.name.length > 0 ? spec.name : entry.id,
		reasoning: capabilities.supportsReasoning === true,
		input: vision ? (["text", "image"] as const) : (["text"] as const),
		cost: {
			input: usdPerMillionToPerToken(spec.pricing?.input),
			output: usdPerMillionToPerToken(spec.pricing?.output),
			cacheRead: usdPerMillionToPerToken(spec.pricing?.cache_input),
			cacheWrite: usdPerMillionToPerToken(spec.pricing?.cache_write),
		},
		contextWindow:
			asNumber(entry.context_length) ??
			asNumber(spec.availableContextTokens) ??
			FALLBACK_CONTEXT_WINDOW,
		maxTokens: asNumber(spec.maxCompletionTokens) ?? FALLBACK_MAX_TOKENS,
		// SAFETY: Venice's catalog exposes real pricing for every model, so
		// stamp the undocumented _pricingKnown marker consumed by isFreeModel
		// to mark cost-based (Route A) detection authoritative for these models;
		// the field is metadata only and never read by pi-ai.
		_pricingKnown: true,
		// Balance gate (see file header): even $0-priced models require a
		// positive account balance, so no Venice model is free in the
		// "usable without paying" sense pi-free's free view promises.
		_freeKnown: true,
		_isFree: false,
	} as ProviderModelConfig & {
		_pricingKnown?: boolean;
		_freeKnown?: boolean;
		_isFree?: boolean;
	};
}

/**
 * Fetch the complete text-model catalog. The key is optional for /models; it
 * is only sent when configured so public discovery works for logged-out users.
 */
export async function fetchVeniceModels(
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
		`${BASE_URL_VENICE}/models?type=text`,
		{
			headers,
			signal,
		},
		1,
		1_000,
		DEFAULT_FETCH_TIMEOUT_MS,
	);
	if (!response.ok) {
		throw new Error(`Venice catalog returned HTTP ${response.status}`);
	}
	const payload: unknown = await response.json();
	const entries =
		payload &&
		typeof payload === "object" &&
		Array.isArray((payload as { data?: unknown }).data)
			? ((payload as { data: unknown[] }).data as VeniceCatalogModel[])
			: [];
	const models: ProviderModelConfig[] = [];
	for (const entry of entries) {
		const mapped = mapVeniceModel(entry);
		if (mapped) models.push(mapped);
	}
	if (models.length === 0) {
		_logger.warn("Venice catalog returned no usable chat models");
	}
	return applyHidden(models, PROVIDER_VENICE);
}
