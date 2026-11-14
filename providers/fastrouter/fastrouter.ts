/**
 * FastRouter native provider.
 *
 * The factory is synchronous and network-free. Pi restores the catalog from
 * its native models store, then nudges the normal asynchronous refresh at
 * session start. Chat needs a key, so without a stored key or
 * FASTROUTER_API_KEY auth does not resolve and Pi hides the provider (#697);
 * once a key exists the /models fetch and chat requests both carry it.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getFastrouterApiKey, getFastrouterShowPaid } from "../../config.ts";
import { BASE_URL_FASTROUTER, PROVIDER_FASTROUTER } from "../../constants.ts";
import { registerNativeOpenAIProvider } from "../../lib/native-provider.ts";
import { fastrouterAuth } from "./fastrouter-auth.ts";
import { fetchFastrouterModels } from "./fastrouter-models.ts";

export default function fastrouterProvider(pi: ExtensionAPI): Promise<void> {
	registerNativeOpenAIProvider(pi, {
		providerId: PROVIDER_FASTROUTER,
		name: "FastRouter",
		baseUrl: BASE_URL_FASTROUTER,
		auth: fastrouterAuth,
		getApiKey: getFastrouterApiKey,
		getShowPaid: getFastrouterShowPaid,
		fetchModels: (apiKey, signal) => fetchFastrouterModels(apiKey, signal),
	});
	return Promise.resolve();
}
