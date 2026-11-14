/**
 * GMI Cloud's OpenAI-compatible model catalog.
 *
 * GMI Cloud's Inference API follows the OpenAI model-list shape and exposes
 * per-model pricing (`pricing.prompt`/`pricing.completion`), which the shared
 * mapper reads so pi-free's Route A cost-based free-detector is active. The
 * shared mapper preserves pricing/capability metadata and applies models.dev
 * enrichment without introducing a second cache or freshness policy.
 *
 * Promotional free models: GMI runs time-limited "free week" promotions
 * (e.g. MiniMax Week) where specific models are free to use at the billing
 * layer. GMI publishes each promotional model TWICE in `/v1/models`:
 *
 *   1. The normal priced SKU (nonzero `pricing.prompt`/`pricing.completion`).
 *   2. A duplicate id with `pricing` zeroed and an authoritative
 *      `is_free: true` flag — the promotional SKU.
 *
 * The shared `fetchOpenAICompatibleModels` mapper stamps the `is_free: true`
 * rows as `_freeKnown: true, _isFree: true`. Pi keys models by id, and the
 * free view selects by id, so the two rows are folded into one model per id:
 * the free row when GMI lists one (wherever it appears), otherwise the priced
 * row. The promotion auto-expires when GMI stops publishing the
 * `is_free: true` row; no hardcoded date windows to maintain.
 */

import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { applyHidden } from "../../config.ts";
import { BASE_URL_GMI, PROVIDER_GMI } from "../../constants.ts";
import { fetchOpenAICompatibleModels } from "../../lib/util.ts";

type GmiModel = ProviderModelConfig & {
	_freeKnown?: boolean;
	_isFree?: boolean;
};

/**
 * One model per id: a row GMI stamps `is_free` replaces any other row with
 * that id, keeping the first row's position; otherwise the first row wins.
 */
function oneModelPerId(models: readonly GmiModel[]): GmiModel[] {
	const byId = new Map<string, GmiModel>();
	for (const model of models) {
		const kept = byId.get(model.id);
		if (!kept || (model._isFree === true && kept._isFree !== true)) {
			byId.set(model.id, model);
		}
	}
	return [...byId.values()];
}

/**
 * Fetch GMI Cloud's authenticated `/v1/models` catalog and fold the priced
 * and promotional rows of each id into one model (see the module comment).
 * Hidden models in `~/.pi/free.json` are still filtered.
 */
export async function fetchGmiModels(
	apiKey: string,
	signal?: AbortSignal,
): Promise<ProviderModelConfig[]> {
	const models = await fetchOpenAICompatibleModels(
		PROVIDER_GMI,
		BASE_URL_GMI,
		apiKey,
		{
			contextWindow: 128_000,
			maxTokens: 16_384,
		},
		undefined,
		signal,
	);

	return applyHidden(oneModelPerId(models), PROVIDER_GMI);
}
