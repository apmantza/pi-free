/**
 * Infron AI API-key authentication.
 *
 * The model catalog (llm.onerouter.pro/v1/models) is public — anonymous
 * requests return HTTP 200 (verified live) — so keyless resolution returns a
 * truthy anonymous result and Pi's model refresh still populates the catalog.
 * Chat requests use the configured key; the gateway rejects unauthenticated
 * completions. Infron keys are issued at infron.ai / app.onerouter.pro.
 */

import { getInfronApiKey } from "../../config.ts";
import { createNativeApiKeyAuth } from "../../lib/native-provider.ts";

/** Infron AI API-key authentication for both catalog refresh and chat requests. */
export const infronAuth = createNativeApiKeyAuth({
	name: "Infron API key",
	prompt: "Infron API key",
	source: "INFRON_API_KEY",
	getApiKey: getInfronApiKey,
	anonymousCatalog: true,
});
