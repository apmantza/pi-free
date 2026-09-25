import { getXkiroApiKey } from "../../config.ts";
import { createNativeApiKeyAuth } from "../../lib/native-provider.ts";

export const xkiroAuth = createNativeApiKeyAuth({
	name: "Xkiro API key",
	prompt: "Xkiro API key",
	source: "XKIRO_API_KEY",
	getApiKey: getXkiroApiKey,
});
