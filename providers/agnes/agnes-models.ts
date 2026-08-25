/**
 * Agnes AI's OpenAI-compatible model catalog.
 *
 * Agnes AI exposes a plain OpenAI `/v1/models` list (id, object, created,
 * owned_by, supported_endpoint_types) with NO pricing or architecture fields.
 * The catalog mixes text chat models with image/video generation models;
 * pi-free feeds a coding agent that speaks Chat Completions, so only text
 * chat models are published and the rest are filtered out.
 *
 * Free vs. paid: the `/v1/models` endpoint does not expose pricing, so the
 * adaptive Route A/B detector in lib/registry.ts cannot tell them apart
 * (Route B falls back to name-based "free" detection, and no Agnes model id
 * contains "free"). Per the Agnes pricing docs
 * (https://wiki.agnes-ai.com/en/docs/pricing), only the flash-class chat
 * models are free; the pro models are billed at list price:
 *   - agnes-2.0-flash     — free
 *   - agnes-2.5-flash     — free
 *   - agnes-2.5-pro       — paid
 *   - agnes-2.5-pro-alpha — paid
 *
 * The free flash models are therefore stamped with the authoritative free
 * flag (`_freeKnown`/`_isFree`, the same escape hatch used by the anyapi, bai,
 * and gmi gateways) so the free-only view and `/free-providers` counts are
 * correct. The pro models are left unstamped; with no pricing exposed and no
 * "free" token in their ids, Route B classifies them as paid (correct).
 */

import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { applyHidden } from "../../config.ts";
import { BASE_URL_AGNES, PROVIDER_AGNES } from "../../constants.ts";
import { fetchOpenAICompatibleModels } from "../../lib/util.ts";

/** Augmented model shape carrying the authoritative free/paid flag. */
type AgnesProviderModel = ProviderModelConfig & {
 _freeKnown?: boolean;
 _isFree?: boolean;
};

/**
 * Agnes's catalog lists image and video *generation* models alongside text
 * chat models. pi-free targets Chat Completions for coding, so generation
 * models are excluded by name. (e.g. `agnes-image-2.1-flash`,
 * `agnes-video-2.5`.)
 */
function isChatModel(id: string): boolean {
 const lower = id.toLowerCase();
 return !lower.includes("image") && !lower.includes("video");
}

/**
 * Agnes chat models that are free to use (per the Agnes pricing docs). Kept as
 * an explicit set rather than a name pattern because Agnes publishes both free
 * (flash) and paid (pro) chat models under the same gateway, and only the
 * flash class is free — "flash" alone is not a reliable free signal
 * (`agnes-image-2.1-flash` is a paid generation model), so match on the full
 * text-chat model ids only. Update this set if Agnes changes its free tier.
 */
const FREE_CHAT_MODEL_IDS: ReadonlySet<string> = new Set([
 "agnes-2.0-flash",
 "agnes-2.5-flash",
]);

/**
 * Fetch Agnes AI's authenticated `/v1/models` catalog, keep only the text
 * chat models, and stamp the free flash models as authoritatively free.
 */
export async function fetchAgnesModels(
 apiKey: string,
 signal?: AbortSignal,
): Promise<ProviderModelConfig[]> {
 const models = await fetchOpenAICompatibleModels(
  PROVIDER_AGNES,
  BASE_URL_AGNES,
  apiKey,
  {
   contextWindow: 128_000,
   maxTokens: 16_384,
  },
  undefined,
  signal,
 );

 const chatModels = models.filter((model) => isChatModel(model.id));

 const stamped: AgnesProviderModel[] = chatModels.map((model) => {
  if (!FREE_CHAT_MODEL_IDS.has(model.id)) return model;
  return {
   ...model,
   _freeKnown: true,
   _isFree: true,
  };
 });

 return applyHidden(stamped, PROVIDER_AGNES);
}
