import { getRoutewayApiKey } from "../../config.ts";
import { createNativeApiKeyAuth } from "../../lib/native-provider.ts";

export const routewayAuth = createNativeApiKeyAuth({
	name: "Routeway API key",
	prompt: "Routeway API key",
	source: "ROUTEWAY_API_KEY",
	getApiKey: getRoutewayApiKey,
});
