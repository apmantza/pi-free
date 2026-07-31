import { getAnyapiApiKey } from "../../config.ts";
import { createNativeApiKeyAuth } from "../../lib/native-provider.ts";

export const anyapiAuth = createNativeApiKeyAuth({
	name: "AnyAPI API key",
	prompt: "AnyAPI API key",
	source: "ANYAPI_API_KEY",
	getApiKey: getAnyapiApiKey,
});
