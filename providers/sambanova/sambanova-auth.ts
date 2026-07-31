import { getSambanovaApiKey } from "../../config.ts";
import { createNativeApiKeyAuth } from "../../lib/native-provider.ts";

export const sambanovaAuth = createNativeApiKeyAuth({
	name: "SambaNova API key",
	prompt: "SambaNova API key",
	source: "SAMBANOVA_API_KEY",
	getApiKey: getSambanovaApiKey,
});
