import { getOpengatewayApiKey } from "../../config.ts";
import { createNativeApiKeyAuth } from "../../lib/native-provider.ts";

export const opengatewayAuth = createNativeApiKeyAuth({
	name: "OpenGateway API key",
	prompt: "OpenGateway API key",
	source: "OPENGATEWAY_API_KEY",
	getApiKey: getOpengatewayApiKey,
});
