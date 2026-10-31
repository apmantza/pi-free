import { getInferxApiKey } from "../../config.ts";
import { createNativeApiKeyAuth } from "../../lib/native-provider.ts";

export const inferxAuth = createNativeApiKeyAuth({
	name: "InferX API key",
	prompt: "InferX API key",
	source: "INFERX_API_KEY",
	getApiKey: getInferxApiKey,
});
