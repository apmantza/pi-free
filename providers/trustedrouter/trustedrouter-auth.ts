import { getTrustedrouterApiKey } from "../../config.ts";
import { createNativeApiKeyAuth } from "../../lib/native-provider.ts";

/**
 * TrustedRouter native authentication. The /v1/models endpoint is public,
 * but chat requests require an API key: without a stored credential or
 * TRUSTEDROUTER_API_KEY resolve() returns undefined and Pi hides the
 * provider (#697).
 */
export const trustedrouterAuth = createNativeApiKeyAuth({
	name: "TrustedRouter API key",
	prompt: "TrustedRouter API key",
	source: "TRUSTEDROUTER_API_KEY",
	getApiKey: getTrustedrouterApiKey,
});
