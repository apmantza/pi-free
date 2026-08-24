import { getAgnesApiKey } from "../../config.ts";
import { createNativeApiKeyAuth } from "../../lib/native-provider.ts";

/** Agnes AI API-key authentication for both catalog refresh and chat requests. */
export const agnesAuth = createNativeApiKeyAuth({
	name: "Agnes AI API key",
	prompt: "Agnes AI API key",
	source: "AGNES_API_KEY",
	getApiKey: getAgnesApiKey,
});
