/**
 * InferX model catalog (`model.inferx.net/endpoints/v1/models`).
 *
 * InferX (https://inferx.net) is a serverless GPU inference platform whose
 * shared `/endpoints/v1` surface is OpenAI-compatible. The catalog is
 * vLLM-shaped: every entry carries only `id`, `object`, `created`, and
 * `owned_by`, with no pricing, context, capability, or modality fields.
 *
 * Context windows, output limits, modalities, and reasoning therefore come
 * from models.dev enrichment (the published InferX provider there lists the
 * same endpoint ids); every entry keeps the conservative 128K/16K defaults
 * when enrichment is unavailable. Two catalog facts are NOT in the payload
 * and cannot be enriched:
 *
 *   - Non-chat endpoints (`Qwen3-Embedding-8B`) are listed beside chat
 *     models, so they are dropped by id pattern.
 *   - The `-no-thinking` variants advertise their own non-reasoning nature
 *     in the id; the shared `isLikelyReasoningModel` heuristic matches the
 *     literal "thinking" substring and would invert it, so those ids are
 *     excluded from the heuristic.
 *
 * Pricing: the catalog publishes none (every public endpoint page states
 * usage is billed per token, without a price). Entries are stamped
 * `_pricingKnown: false`, which degrades `isFreeModel` to its name-based
 * check instead of trusting a fabricated $0. No id or display name carries
 * "free", so no InferX model classifies as free and the catalog appears in
 * the paid view (`/toggle-inferx`, `inferx_show_paid`). InferX's own
 * "InferX Free" plan is a billing-layer tier this catalog does not expose.
 */

import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { applyHidden } from "../../config.ts";
import { BASE_URL_INFERX, PROVIDER_INFERX } from "../../constants.ts";
import { createLogger } from "../../lib/logger.ts";
import { isLikelyReasoningModel } from "../../lib/provider-compat.ts";
import { fetchOpenAICompatibleModels } from "../../lib/util.ts";

const _logger = createLogger("inferx-models");

/** Conservative defaults replaced by models.dev metadata when it resolves. */
const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 16_384;

/**
 * Endpoint ids that are not chat-completion models. InferX publishes its
 * embedding endpoint in the same list as the chat endpoints.
 */
const NON_CHAT_MODEL_PATTERN = /(^|[-_/])(embed|rerank)/i;

/**
 * Ids that advertise a non-reasoning variant of a reasoning model
 * (`…-fp8-no-thinking`). They must not be classified by the family heuristic.
 */
const NO_THINKING_PATTERN = /no[-_]?thinking/i;

/** True for catalog endpoints usable as agent chat models. */
export function isInferxChatModel(id: string): boolean {
	return !NON_CHAT_MODEL_PATTERN.test(id);
}

/**
 * True when the endpoint id is a reasoning model. Wraps the shared family
 * heuristic so the explicit `-no-thinking` variant is never marked reasoning.
 */
export function isInferxReasoningModel(model: {
	id: string;
	name?: string;
}): boolean {
	if (NO_THINKING_PATTERN.test(model.id)) return false;
	return isLikelyReasoningModel(model);
}

/**
 * Fetch InferX's catalog and map it to pi-free model records.
 *
 * The shared OpenAI-compatible fetcher owns request shaping, retries, abort
 * handling, per-entry mapping, models.dev enrichment, and the
 * `_pricingKnown` stamp; InferX only adds the two catalog rules above.
 */
export async function fetchInferxModels(
	apiKey: string,
	signal?: AbortSignal,
): Promise<ProviderModelConfig[]> {
	const models = await fetchOpenAICompatibleModels(
		PROVIDER_INFERX,
		BASE_URL_INFERX,
		apiKey,
		{ contextWindow: DEFAULT_CONTEXT_WINDOW, maxTokens: DEFAULT_MAX_TOKENS },
		{ detectReasoning: isInferxReasoningModel },
		signal,
	);

	const chatModels = models.filter((model) => isInferxChatModel(model.id));
	const dropped = models.length - chatModels.length;
	if (dropped > 0) {
		_logger.info(`[inferx] Dropped ${dropped} non-chat endpoints`);
	}
	if (chatModels.length === 0) {
		_logger.warn("[inferx] Catalog returned no usable chat models");
	}
	return applyHidden(chatModels, PROVIDER_INFERX);
}
