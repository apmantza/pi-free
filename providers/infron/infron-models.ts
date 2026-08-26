/**
 * Infron AI model catalog (llm.onerouter.pro/v1/models).
 *
 * Infron AI (infron.ai) runs its unified gateway on OneRouter
 * (llm.onerouter.pro). The /models schema is OpenRouter-inspired but NOT
 * identical: flat `min_prompt_price`/`min_completion_price` numbers in USD
 * per MILLION tokens (verified against Google's list pricing: gemini-3.1-
 * flash-lite reports 0.125/0.75), a `category_type` string, flat
 * `input_modalities`/`output_modalities` arrays with inconsistent casing,
 * and no per-model reasoning flag. Mapped here instead of through the shared
 * OpenRouter-compatible fetcher.
 *
 * Free models: exactly the zero-priced LLM entries — currently five, three
 * with an explicit `:free` id suffix, one with a `-reasoning` id whose
 * display name carries "(free)", all reported at 0/0 min prices by the
 * catalog. Classification follows published pricing via Route A
 * (`_pricingKnown: true`, no free/paid override).
 */

import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { applyHidden } from "../../config.ts";
import {
	BASE_URL_INFRON,
	DEFAULT_FETCH_TIMEOUT_MS,
	PROVIDER_INFRON,
} from "../../constants.ts";
import { createLogger } from "../../lib/logger.ts";
import { isLikelyReasoningModel } from "../../lib/provider-compat.ts";
import { fetchWithRetry } from "../../lib/util.ts";

const _logger = createLogger("infron-models");

interface InfronCatalogModel {
	id?: unknown;
	category_type?: unknown;
	is_display_only?: unknown;
	display_name?: unknown;
	context_length?: unknown;
	max_output_tokens?: unknown;
	min_prompt_price?: unknown;
	min_completion_price?: unknown;
	input_modalities?: unknown;
}

/** Fallback context window for entries that omit `context_length`. */
const FALLBACK_CONTEXT_WINDOW = 128_000;

/** Fallback max output tokens for entries that omit `max_output_tokens`. */
const FALLBACK_MAX_TOKENS = 4_096;

function asNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asStringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value
				.filter((v): v is string => typeof v === "string")
				.map((v) => v.toLowerCase())
		: [];
}

/**
 * Map one catalog entry to the pi-free model config shape. Returns undefined
 * for non-LLM categories (embeddings, rerankers, image/video/TTS), display-only
 * placeholders, and unusable entries rather than guessing.
 */
export function mapInfronModel(
	entry: InfronCatalogModel,
): ProviderModelConfig | undefined {
	if (typeof entry.id !== "string" || entry.id.length === 0) return undefined;
	// Only chat-completion LLMs are usable as agent models; the catalog also
	// lists embeddings, rerankers, image/video generation, TTS, and search.
	// Case-insensitive: the gateway's casing is inconsistent across fields.
	if (
		typeof entry.category_type !== "string" ||
		entry.category_type.toUpperCase() !== "LLM"
	) {
		return undefined;
	}
	if (entry.is_display_only === true) return undefined;

	const name =
		typeof entry.display_name === "string" && entry.display_name.length > 0
			? entry.display_name
			: entry.id;
	const inputMods = asStringArray(entry.input_modalities);

	// Min prices are USD per million tokens -> convert to pi-free per-token.
	// Route A authority requires BOTH prices to arrive as genuine non-negative
	// finite numbers: a string/null/absent/negative price must NOT masquerade
	// as a verified $0 (that would stamp a paid model authoritatively free).
	const promptPrice = asNumber(entry.min_prompt_price);
	const completionPrice = asNumber(entry.min_completion_price);
	const pricingKnown =
		promptPrice !== undefined &&
		completionPrice !== undefined &&
		promptPrice >= 0 &&
		completionPrice >= 0;

	return {
		id: entry.id,
		name,
		reasoning: isLikelyReasoningModel({ id: entry.id, name }),
		input: inputMods.includes("image")
			? (["text", "image"] as const)
			: (["text"] as const),
		cost: {
			input: pricingKnown ? promptPrice / 1_000_000 : 0,
			output: pricingKnown ? completionPrice / 1_000_000 : 0,
			cacheRead: 0,
			cacheWrite: 0,
		},
		contextWindow: asNumber(entry.context_length) ?? FALLBACK_CONTEXT_WINDOW,
		maxTokens: asNumber(entry.max_output_tokens) ?? FALLBACK_MAX_TOKENS,
		// SAFETY: stamp the undocumented _pricingKnown marker consumed by
		// isFreeModel ONLY when both prices were genuine numbers (verified live
		// at implementation time for every LLM entry); otherwise leave it false
		// so detection degrades to Route B's name-based fallback instead of
		// trusting fabricated $0 costs. The field is metadata only and never
		// read by pi-ai.
		_pricingKnown: pricingKnown,
	} as ProviderModelConfig & { _pricingKnown?: boolean };
}

/**
 * Fetch the complete catalog. The key is optional for /models (public
 * endpoint); it is only sent when configured so discovery works for
 * logged-out users.
 */
export async function fetchInfronModels(
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
		`${BASE_URL_INFRON}/models`,
		{
			headers,
			signal,
		},
		1,
		1_000,
		DEFAULT_FETCH_TIMEOUT_MS,
	);
	if (!response.ok) {
		throw new Error(`Infron catalog returned HTTP ${response.status}`);
	}
	const payload: unknown = await response.json();
	const entries =
		payload &&
		typeof payload === "object" &&
		Array.isArray((payload as { data?: unknown }).data)
			? ((payload as { data: unknown[] }).data as InfronCatalogModel[])
			: [];
	const models: ProviderModelConfig[] = [];
	for (const entry of entries) {
		const mapped = mapInfronModel(entry);
		if (mapped) models.push(mapped);
	}
	if (models.length === 0) {
		_logger.warn("Infron catalog returned no usable chat models");
	}
	return applyHidden(models, PROVIDER_INFRON);
}
