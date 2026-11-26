/**
 * TrustedRouter's public OpenRouter-compatible model catalog
 * (`api.trustedrouter.com/v1/models`).
 *
 * The shared OpenRouter-compatible fetcher owns request shaping, retries,
 * USD-per-token -> USD-per-million conversion, pricing provenance, and
 * models.dev enrichment. TrustedRouter-specific admission and effort rules
 * attach through `adaptRow` and `thinkingLevelMapFromEfforts` (AGENTS.md
 * convention 21):
 *
 * - Rows marked `internal_only`, `configuration_hidden`, `synthetic_monitor`,
 *   or `supports_chat: false` are dropped (internal presets, decision models,
 *   embeddings, rerank, image/video/speech/transcription generators, and
 *   non-chat orchestration endpoints).
 * - Only text-in, text-only-out rows are admitted, so image-output hybrids
 *   (`text+image->text+image`) stay out of the chat picker while multimodal
 *   vision-input models (`text+image->text`) remain.
 * - `supported_parameters` is not tool-gated because TrustedRouter lists a
 *   minimal `["max_tokens"]` placeholder on many routing pools and chat
 *   models that accept tools (including `trustedrouter/free`,
 *   `google/gemini-pro-latest`, and `mistralai/mistral-large-2512`).
 * - Unpublished context/output limits fall back to 128K / 16K rather than
 *   4096; both stay in models.dev's fallback set so enrichment still fills
 *   exact upstream limits when known.
 * - Where a row publishes `reasoning.supported_efforts`, Pi's thinking levels
 *   map strictly to those declared values via `thinkingLevelMapFromEfforts`.
 */

import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { applyHidden } from "../../config.ts";
import {
	BASE_URL_TRUSTEDROUTER,
	PROVIDER_TRUSTEDROUTER,
} from "../../constants.ts";
import { createLogger } from "../../lib/logger.ts";
import {
	firstPositiveLimit,
	type OpenRouterCatalogRow,
} from "../../lib/model-map.ts";
import { thinkingLevelMapFromEfforts } from "../../lib/model-metadata.ts";
import { isChatModelConfig } from "../../lib/types.ts";
import { fetchOpenRouterCompatibleModels } from "../model-fetcher.ts";

const _logger = createLogger("trustedrouter-models");

/** Fallback context window for rows omitting `context_length` (models.dev overrides when known). */
const FALLBACK_CONTEXT_WINDOW = 128_000;

/** Fallback max output tokens for rows omitting `max_completion_tokens` (models.dev overrides when known). */
const FALLBACK_MAX_TOKENS = 16_384;

/** The fields of a TrustedRouter `/v1/models` row this module reads. */
type TrustedrouterRow = OpenRouterCatalogRow & {
	reasoning?: {
		mandatory?: boolean;
		default_enabled?: boolean;
		supported_efforts?: unknown[] | null;
		default_effort?: string | null;
	} | null;
	trustedrouter?: {
		internal_only?: boolean;
		configuration_hidden?: boolean;
		synthetic_monitor?: boolean;
		supports_chat?: boolean;
	} | null;
};

function isUsableTrustedrouterChatRow(row: TrustedrouterRow): boolean {
	if (typeof row.id !== "string" || row.id.length === 0) return false;
	const meta = row.trustedrouter;
	if (
		meta?.internal_only === true ||
		meta?.configuration_hidden === true ||
		meta?.synthetic_monitor === true ||
		meta?.supports_chat === false
	) {
		return false;
	}
	const input = row.architecture?.input_modalities ?? [];
	const output = row.architecture?.output_modalities ?? [];
	return (
		input.includes("text") &&
		output.length > 0 &&
		output.every((mod) => mod === "text")
	);
}

/**
 * Fetch the complete public TrustedRouter chat catalog. `/v1/models` answers
 * without a key, so Authorization is sent only when a key is present; in
 * production Pi refreshes TrustedRouter only once a key resolves (#697).
 */
export async function fetchTrustedrouterModels(
	apiKey: string,
	signal?: AbortSignal,
): Promise<ProviderModelConfig[]> {
	const declaredEffortsById = new Map<string, string[]>();

	const adaptTrustedrouterRow = (
		row: TrustedrouterRow,
	): OpenRouterCatalogRow | undefined => {
		if (!isUsableTrustedrouterChatRow(row)) return undefined;
		const declaredEfforts = row.reasoning?.supported_efforts;
		if (Array.isArray(declaredEfforts)) {
			declaredEffortsById.set(
				row.id,
				declaredEfforts.filter(
					(value): value is string => typeof value === "string",
				),
			);
		}
		return {
			...row,
			context_length:
				firstPositiveLimit(
					row.context_length,
					row.top_provider?.context_length,
				) ?? FALLBACK_CONTEXT_WINDOW,
			max_completion_tokens:
				firstPositiveLimit(
					row.max_completion_tokens,
					row.top_provider?.max_completion_tokens,
				) ?? FALLBACK_MAX_TOKENS,
		};
	};

	const models = await fetchOpenRouterCompatibleModels<TrustedrouterRow>({
		providerId: PROVIDER_TRUSTEDROUTER,
		baseUrl: BASE_URL_TRUSTEDROUTER,
		apiKey,
		signal,
		adaptRow: adaptTrustedrouterRow,
	});

	if (models.length === 0) {
		_logger.warn("[trustedrouter] Catalog returned no usable chat models");
	}

	const shaped = models.map((model) => {
		if (!isChatModelConfig(model)) return model;
		const declared = declaredEffortsById.get(model.id);
		if (!declared) return model;
		return {
			...model,
			reasoning: model.reasoning || declared.length > 0,
			thinkingLevelMap: thinkingLevelMapFromEfforts(declared),
		};
	});

	return applyHidden(shaped, PROVIDER_TRUSTEDROUTER);
}
