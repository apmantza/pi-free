import { getBaiApiKey } from "../../config.ts";
import { createNativeApiKeyAuth } from "../../lib/native-provider.ts";

export const baiAuth = createNativeApiKeyAuth({
	name: "B.AI API key",
	prompt: "B.AI API key",
	source: "BAI_API_KEY",
	getApiKey: getBaiApiKey,
});
