import { getFastrouterApiKey } from "../../config.ts";
import { createNativeApiKeyAuth } from "../../lib/native-provider.ts";

/**
 * FastRouter native authentication. The /models endpoint is public, but chat
 * needs a key: without one resolve() returns undefined and Pi hides the
 * provider (#697).
 */
export const fastrouterAuth = createNativeApiKeyAuth({
	name: "FastRouter API key",
	prompt: "FastRouter API key",
	source: "FASTROUTER_API_KEY",
	getApiKey: getFastrouterApiKey,
});
