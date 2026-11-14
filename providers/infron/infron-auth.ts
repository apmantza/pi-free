/**
 * Infron AI API-key authentication.
 *
 * The model catalog (llm.onerouter.pro/v1/models) is public — anonymous
 * requests return HTTP 200 (verified live) — but keyless resolution returns
 * undefined (shared createNativeApiKeyAuth, #530), so Pi hides the provider
 * until a key is configured. Chat requests use that key; the gateway rejects
 * unauthenticated completions. Infron keys are issued at infron.ai /
 * app.onerouter.pro.
 */

import { getInfronApiKey } from "../../config.ts";
import { createNativeApiKeyAuth } from "../../lib/native-provider.ts";

/** Infron AI API-key authentication for both catalog refresh and chat requests. */
export const infronAuth = createNativeApiKeyAuth({
	name: "Infron API key",
	prompt: "Infron API key",
	source: "INFRON_API_KEY",
	getApiKey: getInfronApiKey,
});
