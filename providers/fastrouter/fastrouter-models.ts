/** FastRouter's public OpenRouter-compatible model catalog. */

import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { applyHidden } from "../../config.ts";
import { BASE_URL_FASTROUTER, PROVIDER_FASTROUTER } from "../../constants.ts";
import { fetchOpenRouterCompatibleModels } from "../model-fetcher.ts";

/**
 * Fetch the complete public catalog. The key is optional for /models; it is
 * only passed when configured so public discovery works for logged-out users.
 */
export async function fetchFastrouterModels(
	apiKey: string,
	signal?: AbortSignal,
): Promise<ProviderModelConfig[]> {
	const models = await fetchOpenRouterCompatibleModels({
		providerId: PROVIDER_FASTROUTER,
		baseUrl: BASE_URL_FASTROUTER,
		apiKey: apiKey || undefined,
		signal,
		// FastRouter's free view must not contain media-generation models:
		// zero-priced image/audio hybrids (gemini-*-image, prompt-to-audio)
		// would otherwise be classified as free chat models.
		excludeOutputModalities: ["image", "audio", "video", "speech"],
	});
	return applyHidden(models, PROVIDER_FASTROUTER);
}
