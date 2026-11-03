/**
 * InferX provider extension.
 *
 * InferX (https://inferx.net) is a serverless GPU inference platform. Its
 * shared OpenAI-compatible surface lives at
 * `https://model.inferx.net/endpoints/v1` and bills usage per token.
 *
 * The catalog endpoint requires an API key (anonymous requests answer 401
 * "no tenant context"), so models appear only after a credential resolves —
 * `INFERX_API_KEY` or `inferx_api_key` in `~/.pi/free.json`. The catalog is
 * vLLM-shaped (ids only) and publishes no prices: see
 * [inferx-models.ts](./inferx-models.ts) for the mapping, the non-chat
 * filter, and why no model classifies as free.
 *
 * Toggle with `/toggle-inferx`; the catalog shows in the paid view.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getInferxApiKey, getInferxShowPaid } from "../../config.ts";
import { BASE_URL_INFERX, PROVIDER_INFERX } from "../../constants.ts";
import { registerNativeOpenAIProvider } from "../../lib/native-provider.ts";
import { inferxAuth } from "./inferx-auth.ts";
import { fetchInferxModels } from "./inferx-models.ts";

export default function inferxProvider(pi: ExtensionAPI): Promise<void> {
	registerNativeOpenAIProvider(pi, {
		providerId: PROVIDER_INFERX,
		name: "InferX",
		baseUrl: BASE_URL_INFERX,
		auth: inferxAuth,
		getApiKey: getInferxApiKey,
		getShowPaid: getInferxShowPaid,
		fetchModels: (apiKey, signal) => fetchInferxModels(apiKey, signal),
		tosUrl: "https://inferx.net/terms",
	});
	return Promise.resolve();
}
