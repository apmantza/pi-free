/** GMI Cloud's OpenAI-compatible model catalog. */

import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { applyHidden } from "../../config.ts";
import { BASE_URL_GMI, PROVIDER_GMI } from "../../constants.ts";
import { fetchOpenAICompatibleModels } from "../../lib/util.ts";

/**
 * Fetch GMI Cloud's authenticated `/v1/models` catalog.
 *
 * GMI Cloud's Inference API follows the OpenAI model-list shape. The
 * shared mapper preserves any pricing/capability metadata exposed by the
 * endpoint and applies models.dev enrichment without introducing a second
 * cache or freshness policy.
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
