/**
 * Requesty native provider.
 *
 * The factory is synchronous and network-free. Pi restores the catalog from
 * its native models store, then nudges the normal asynchronous refresh at
 * session start. The provider's auth resolves only with a key
 * (REQUESTY_API_KEY, `requesty_api_key` or a stored credential), and Pi
 * fetches the catalog only once it resolves, so Requesty stays hidden without
 * one (#697). Pricing is inline in the catalog, so the standard cost-based
 * free-model detection applies and `/toggle-requesty` switches between the
 * free view and the full catalog (counts: docs/catalog-audit.md).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getRequestyApiKey, getRequestyShowPaid } from "../../config.ts";
import { BASE_URL_REQUESTY, PROVIDER_REQUESTY } from "../../constants.ts";
import { registerNativeOpenAIProvider } from "../../lib/native-provider.ts";
import { requestyAuth } from "./requesty-auth.ts";
import { fetchRequestyModels } from "./requesty-models.ts";

export default function requestyProvider(pi: ExtensionAPI): Promise<void> {
	registerNativeOpenAIProvider(pi, {
		providerId: PROVIDER_REQUESTY,
		name: "Requesty",
		baseUrl: BASE_URL_REQUESTY,
		auth: requestyAuth,
		getApiKey: getRequestyApiKey,
		getShowPaid: getRequestyShowPaid,
		fetchModels: (apiKey, signal) => fetchRequestyModels(apiKey, signal),
	});
	return Promise.resolve();
}
