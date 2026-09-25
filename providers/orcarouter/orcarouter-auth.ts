import { getOrcarouterApiKey } from "../../config.ts";
import { createNativeApiKeyAuth } from "../../lib/native-provider.ts";

export const orcarouterAuth = createNativeApiKeyAuth({
	name: "OrcaRouter API key",
	prompt: "OrcaRouter API key",
	source: "ORCAROUTER_API_KEY",
	getApiKey: getOrcarouterApiKey,
});
