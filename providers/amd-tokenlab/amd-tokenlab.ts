/**
 * AMD Token Lab provider extension.
 *
 * AMD Token Lab (`https://api.tokenlab.amd.com/v1`) serves open models on AMD
 * Instinct GPUs through an OpenAI-compatible surface (it also speaks
 * Anthropic `/v1/messages`; pi-free uses chat completions). Keys come from
 * https://notebooks.amd.com/tokenlab after signing in with the AMD AI
 * Developer Program, and resolve from `AMD_TOKENLAB_API_KEY` or
 * `amd_tokenlab_api_key` in `~/.pi/free.json`. The catalog is keyed, so
 * models appear only once a key resolves.
 *
 * Every model is free: usage draws on a monthly budget AMD grants each user.
 * See [amd-tokenlab-models.ts](./amd-tokenlab-models.ts).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAmdTokenlabApiKey, getAmdTokenlabShowPaid } from "../../config.ts";
import {
	BASE_URL_AMD_TOKENLAB,
	PROVIDER_AMD_TOKENLAB,
} from "../../constants.ts";
import { registerNativeOpenAIProvider } from "../../lib/native-provider.ts";
import { amdTokenlabAuth } from "./amd-tokenlab-auth.ts";
import { fetchAmdTokenlabModels } from "./amd-tokenlab-models.ts";

/** Everything Pi registers for Token Lab; tests drive the same object. */
export const amdTokenlabProviderOptions = {
	providerId: PROVIDER_AMD_TOKENLAB,
	name: "AMD Token Lab",
	baseUrl: BASE_URL_AMD_TOKENLAB,
	auth: amdTokenlabAuth,
	getApiKey: getAmdTokenlabApiKey,
	getShowPaid: getAmdTokenlabShowPaid,
	fetchModels: (apiKey: string, signal?: AbortSignal) =>
		fetchAmdTokenlabModels(apiKey, signal),
};

export default function amdTokenlabProvider(pi: ExtensionAPI): Promise<void> {
	registerNativeOpenAIProvider(pi, amdTokenlabProviderOptions);
	return Promise.resolve();
}
