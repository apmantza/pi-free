/**
 * TrustedRouter native provider.
 *
 * TrustedRouter (`https://api.trustedrouter.com/v1`) is an OpenAI-compatible
 * gateway running inside attested GCP Confidential Space TEEs, serving both
 * the `trustedrouter/free` pool, privacy-routed pools (`trustedrouter/zdr`,
 * `trustedrouter/e2e`, `trustedrouter/confidential`, `trustedrouter/eu`,
 * `trustedrouter/auto`), and direct upstream models.
 *
 * The factory is synchronous and network-free. Pi restores the catalog from
 * its native models store and nudges asynchronous refresh at session start.
 * `/v1/models` is public, but chat requests require a key, so without a stored
 * credential or `TRUSTEDROUTER_API_KEY` (or `trustedrouter_api_key` in
 * `~/.pi/free.json`) auth does not resolve and Pi hides the provider (#697).
 * Pricing is published inline per token, so standard Route A classification
 * exposes `trustedrouter/free` in the default free view and `/toggle-trustedrouter`
 * reveals the full catalog.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	getTrustedrouterApiKey,
	getTrustedrouterShowPaid,
} from "../../config.ts";
import {
	BASE_URL_TRUSTEDROUTER,
	PROVIDER_TRUSTEDROUTER,
} from "../../constants.ts";
import {
	type NativeOpenAIProviderOptions,
	registerNativeOpenAIProvider,
} from "../../lib/native-provider.ts";
import { trustedrouterAuth } from "./trustedrouter-auth.ts";
import { fetchTrustedrouterModels } from "./trustedrouter-models.ts";

/** Everything Pi registers for TrustedRouter; tests drive the same object. */
export const trustedrouterProviderOptions: NativeOpenAIProviderOptions = {
	providerId: PROVIDER_TRUSTEDROUTER,
	name: "TrustedRouter",
	baseUrl: BASE_URL_TRUSTEDROUTER,
	auth: trustedrouterAuth,
	getApiKey: getTrustedrouterApiKey,
	getShowPaid: getTrustedrouterShowPaid,
	fetchModels: (apiKey, signal) => fetchTrustedrouterModels(apiKey, signal),
};

export default function trustedrouterProvider(pi: ExtensionAPI): Promise<void> {
	registerNativeOpenAIProvider(pi, trustedrouterProviderOptions);
	return Promise.resolve();
}
