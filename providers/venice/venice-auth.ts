/**
 * Venice AI API-key authentication.
 *
 * The model catalog (api.venice.ai/api/v1/models) answers anonymously, but
 * resolution returns undefined without a key, so Pi hides Venice until one
 * exists (#697): the gateway rejects unauthenticated completions.
 */

import { getVeniceApiKey } from "../../config.ts";
import { createNativeApiKeyAuth } from "../../lib/native-provider.ts";

/** Venice AI API-key authentication for both catalog refresh and chat requests. */
export const veniceAuth = createNativeApiKeyAuth({
	name: "Venice API key",
	prompt: "Venice API key",
	source: "VENICE_API_KEY",
	getApiKey: getVeniceApiKey,
});
