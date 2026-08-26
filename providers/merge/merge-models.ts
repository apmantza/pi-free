/**
 * Merge Gateway model catalog (api-gateway.merge.dev/v1/openai/models).
 *
 * Merge (merge.dev) runs a multi-vendor LLM gateway with an OpenAI-compatible
 * surface. The /models schema is the minimal OpenAI-standard shape — flat
 * `id`, `object`, `created`, `owned_by` only (verified live, 264 entries).
 * Unlike OpenRouter-style catalogs there are NO pricing fields, NO context
 * window / max-output tokens, and NO modality or category fields, so every
 * value pi-free needs beyond the id comes from documented fallbacks or an
 * id-based heuristic. Mapped here instead of through the shared
 * OpenRouter-compatible fetcher.
 *
 * Pricing units: the catalog exposes no pricing at all; per-request cost is
 * only reported in chat `usage.cost` as USD per token (live-verified:
 * openai/gpt-4.1-nano returned 1.3e-06 for 9 prompt + 1 completion tokens,
 * matching $0.10/$0.40 per million list pricing). Because no catalog pricing
 * is exposed, costs map to 0/0 WITHOUT the `_pricingKnown` stamp — free-model
 * detection falls back to Route B name-based classification.
 *
 * Free models: none observed. No zero-priced or `:free` ids exist in the
 * catalog (checked live); the gateway bills every request.
 *
 * Non-chat entries: the schema has no category field, so known non-chat ids
 * (embeddings, transcription/TTS, image-generation, safety classifiers) are
 * excluded by a conservative id pattern instead of a structured filter.
 */

import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { applyHidden } from "../../config.ts";
import {
	BASE_URL_MERGE,
	DEFAULT_FETCH_TIMEOUT_MS,
	PROVIDER_MERGE,
} from "../../constants.ts";
import { createLogger } from "../../lib/logger.ts";
import { isLikelyReasoningModel } from "../../lib/provider-compat.ts";
import { fetchWithRetry } from "../../lib/util.ts";

const _logger = createLogger("merge-models");

interface MergeCatalogModel {
	id?: unknown;
	object?: unknown;
	owned_by?: unknown;
}

/** Fallback context window: the catalog omits context data entirely. */
const FALLBACK_CONTEXT_WINDOW = 128_000;

/** Fallback max output tokens: the catalog omits output limits entirely. */
const FALLBACK_MAX_TOKENS = 4_096;

/**
 * Ids the gateway serves over /models but that are not usable agent chat
 * models: embeddings (`*-embedding-*`), transcription (`whisper-*`),
 * image-generation (`*-image`, `-image-*`), and safety classifiers
 * (`*safeguard*`). Conservative — anything not matching is kept.
 */
const NON_CHAT_ID_PATTERN =
	/(embedding|whisper|-tts|audio|moderation|safeguard|-image($|[-_.]))/i;

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Map one catalog entry to the pi-free model config shape. Returns undefined
 * for entries without a usable id and for known non-chat ids rather than
 * guessing.
 */
export function mapMergeModel(
	entry: MergeCatalogModel,
): ProviderModelConfig | undefined {
	const id = asString(entry.id);
	if (!id) return undefined;
	if (NON_CHAT_ID_PATTERN.test(id)) return undefined;
	const name = id;
	return {
		id,
		name,
		reasoning: isLikelyReasoningModel({ id, name }),
		input: ["text"] as const,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: FALLBACK_CONTEXT_WINDOW,
		maxTokens: FALLBACK_MAX_TOKENS,
		// SAFETY: no _pricingKnown stamp — the catalog exposes no pricing, so
		// Route A cost detection must NOT be marked authoritative; isFreeModel
		// classifies these via Route B (name-based) instead.
	} as ProviderModelConfig;
}

/**
 * Fetch the complete catalog. The endpoint is keyed — anonymous requests
 * return HTTP 401 (verified live) — so a real key is required even for
 * discovery.
 */
export async function fetchMergeModels(
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
		`${BASE_URL_MERGE}/models`,
		{
			headers,
			signal,
		},
		1,
		1_000,
		DEFAULT_FETCH_TIMEOUT_MS,
	);
	if (!response.ok) {
		throw new Error(`Merge catalog returned HTTP ${response.status}`);
	}
	const payload: unknown = await response.json();
	const entries =
		payload &&
		typeof payload === "object" &&
		Array.isArray((payload as { data?: unknown }).data)
			? ((payload as { data: unknown[] }).data as MergeCatalogModel[])
			: [];
	const models: ProviderModelConfig[] = [];
	for (const entry of entries) {
		const mapped = mapMergeModel(entry);
		if (mapped) models.push(mapped);
	}
	if (models.length === 0) {
		_logger.warn("Merge catalog returned no usable chat models");
	}
	return applyHidden(models, PROVIDER_MERGE);
}
