/**
 * FastRouter native provider.
 *
 * The factory is synchronous and network-free. Pi restores the catalog from
 * its native models store, then nudges the normal asynchronous refresh at
 * session start. FastRouter's public /models endpoint is fetched without a
 * credential; chat requests use FASTROUTER_API_KEY when configured.
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
		allowUnauthenticated: true,
		fetchModels: (apiKey, signal) => fetchFastrouterModels(apiKey, signal),
	});
	return Promise.resolve();
}
