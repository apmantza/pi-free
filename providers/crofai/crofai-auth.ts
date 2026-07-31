import { getCrofaiApiKey } from "../../config.ts";
import { createNativeApiKeyAuth } from "../../lib/native-provider.ts";

export const crofaiAuth = createNativeApiKeyAuth({
	name: "CrofAI API key",
	prompt: "CrofAI API key",
	source: "CROFAI_API_KEY",
	getApiKey: getCrofaiApiKey,
});
