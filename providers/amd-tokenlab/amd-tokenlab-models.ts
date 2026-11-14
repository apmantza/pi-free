/**
 * AMD Token Lab model catalog (`api.tokenlab.amd.com/v1/models`).
 *
 * The catalog is keyed (anonymous requests answer 401 "Invalid Token Lab API
 * key") and OpenRouter-shaped: `context_length`, `architecture` modalities and
 * `supported_parameters`, but no pricing and no output limit (models.dev
 * enrichment supplies output limits for the published ids). The shared
 * OpenRouter-compatible fetcher owns request shaping, retries, the text-output
 * filter and models.dev enrichment. That filter drops the aux routers
 * (`Clef`, `d3`, `d3-flash`) the catalog lists beside the chat models: they
 * declare `output_modalities: ["decision"]` and `context_length: 0`.
 *
 * Every chat model is stamped authoritatively free (`_freeKnown`/`_isFree`).
 * The catalog publishes no prices, and when every model in a catalog costs
 * $0 `isFreeModel` treats pricing as unexposed and falls back to "free" in the
 * name, which no Token Lab id carries: without the stamp the free view is
 * empty. Token Lab is an AMD AI Developer Program service whose usage draws on
 * a per-user budget AMD grants (`x-ratelimit-limit-user-budget-usd: 10`,
 * resetting monthly, and 20 requests per minute; observed 2026-11-14), not on
 * the user's money.
 */

import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { applyHidden } from "../../config.ts";
import {
	BASE_URL_AMD_TOKENLAB,
	PROVIDER_AMD_TOKENLAB,
} from "../../constants.ts";
import { createLogger } from "../../lib/logger.ts";
import { type ChatModelConfig, isChatModelConfig } from "../../lib/types.ts";
import { fetchOpenRouterCompatibleModels } from "../model-fetcher.ts";

const _logger = createLogger("amd-tokenlab-models");

/**
 * Token Lab controls thinking only through `reasoning_effort`. models.dev
 * enrichment stamps DeepSeek's proxy format on the DeepSeek ids, whose
 * `thinking` field Token Lab rejects with 400 (live, 2026-11-14). Dropping the
 * format leaves pi-ai's OpenAI-style `reasoning_effort` path, including the
 * `none` it sends when thinking is off; reasoning-content replay stays.
 */
function withoutThinkingFormat(
	compat: NonNullable<ChatModelConfig["compat"]>,
): ChatModelConfig["compat"] {
	if (!("thinkingFormat" in compat)) return compat;
	const { thinkingFormat: _rejected, ...accepted } = compat;
	return accepted;
}

export async function fetchAmdTokenlabModels(
	apiKey: string,
	signal?: AbortSignal,
): Promise<ProviderModelConfig[]> {
	const models = await fetchOpenRouterCompatibleModels({
		providerId: PROVIDER_AMD_TOKENLAB,
		baseUrl: BASE_URL_AMD_TOKENLAB,
		apiKey,
		signal,
	});
	if (models.length === 0) {
		_logger.warn("[amd-tokenlab] Catalog returned no usable chat models");
	}
	return applyHidden(
		models.filter(isChatModelConfig).map((model) => ({
			...model,
			...(model.compat && { compat: withoutThinkingFormat(model.compat) }),
			_freeKnown: true,
			_isFree: true,
		})),
		PROVIDER_AMD_TOKENLAB,
	);
}
