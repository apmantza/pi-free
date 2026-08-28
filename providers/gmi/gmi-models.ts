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
 * rows as `_freeKnown: true, _isFree: true`, so they survive as a distinct
 * free entry alongside the priced copy. Both rows are kept (no dedupe): the
 * priced entry drives the "show paid" view, the promotional row drives the
 * free-only view. The promotion auto-expires when GMI stops publishing the
 * `is_free: true` row — no hardcoded date windows to maintain.
 */

import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { applyHidden } from "../../config.ts";
import { BASE_URL_GMI, PROVIDER_GMI } from "../../constants.ts";
import { fetchOpenAICompatibleModels } from "../../lib/util.ts";

/**
 * Fetch GMI Cloud's authenticated `/v1/models` catalog.
 *
 * GMI publishes priced + promotional SKUs side-by-side; both are kept so
 * the free-only view and the "show paid" view each have the right entry
 * to display. Hidden models in `~/.pi/free.json` are still filtered.
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

 return applyHidden(models, PROVIDER_GMI);
}
