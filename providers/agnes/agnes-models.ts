/**
 * Agnes AI's OpenAI-compatible model catalog.
 *
 * Agnes AI exposes a plain OpenAI `/v1/models` list (id, object, created,
 * owned_by, supported_endpoint_types) with no pricing or architecture fields.
 * The catalog mixes text chat models with image/video generation models;
 * pi-free feeds a coding agent that speaks Chat Completions, so only text
 * chat models are published and the rest are filtered out.
 *
 * Agnes is an entirely-free gateway, but none of its model ids contain
 * "free" and the API exposes no pricing — so the adaptive Route A/B free-model
 * detector in lib/registry.ts cannot identify them as free on its own. Each
 * published model is therefore stamped with the authoritative free flag
 * (`_freeKnown`/`_isFree`, the same escape hatch used by the anyapi and bai
 * gateways) so the free-only view and `/free-providers` counts are correct.
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
 * Fetch Agnes AI's authenticated `/v1/models` catalog, keep only the text
 * chat models, and stamp them as authoritatively free.
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

	// Agnes is an entirely-free gateway; mark every published chat model as
	// authoritatively free so the global free-only filter and `/free-providers`
	// counts treat them correctly (no "free" in the name, no pricing exposed).
	const stamped: AgnesProviderModel[] = chatModels.map((model) => ({
		...model,
		_freeKnown: true,
		_isFree: true,
	}));

	return applyHidden(stamped, PROVIDER_AGNES);
}
