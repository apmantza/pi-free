import { getGmiApiKey } from "../../config.ts";
import { createNativeApiKeyAuth } from "../../lib/native-provider.ts";

/** GMI Cloud API-key authentication for both catalog refresh and chat requests. */
export const gmiAuth = createNativeApiKeyAuth({
	name: "GMI Cloud API key",
	prompt: "GMI Cloud API key",
	source: "GMI_API_KEY",
	getApiKey: getGmiApiKey,
});
