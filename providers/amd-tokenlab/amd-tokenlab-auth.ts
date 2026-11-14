import { getAmdTokenlabApiKey } from "../../config.ts";
import { createNativeApiKeyAuth } from "../../lib/native-provider.ts";

export const amdTokenlabAuth = createNativeApiKeyAuth({
	name: "AMD Token Lab API key",
	prompt: "AMD Token Lab API key",
	source: "AMD_TOKENLAB_API_KEY",
	getApiKey: getAmdTokenlabApiKey,
});
