/** StepFun's OpenAI-compatible model catalog. */

import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { applyHidden } from "../../config.ts";
import { BASE_URL_STEPFUN, PROVIDER_STEPFUN } from "../../constants.ts";
import { fetchOpenAICompatibleModels } from "../../lib/util.ts";

/**
 * Fetch StepFun's authenticated `/models` catalog.
 *
 * StepFun's Step Plan endpoint follows the OpenAI model-list shape. The
 * shared mapper preserves any pricing/capability metadata exposed by the
 * endpoint and applies models.dev enrichment without introducing a second
 * cache or freshness policy.
 */
export async function fetchStepfunModels(
	apiKey: string,
	signal?: AbortSignal,
): Promise<ProviderModelConfig[]> {
	const models = await fetchOpenAICompatibleModels(
		PROVIDER_STEPFUN,
		BASE_URL_STEPFUN,
		apiKey,
		{
			contextWindow: 128_000,
			maxTokens: 16_384,
		},
		undefined,
		signal,
	);
	return applyHidden(models, PROVIDER_STEPFUN);
}
