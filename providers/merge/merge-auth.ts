/**
 * Merge Gateway API-key authentication.
 *
 * The model catalog (api-gateway.merge.dev/v1/openai/models) is KEYED —
 * anonymous requests return HTTP 401 (verified live) — so unlike public-
 * catalog providers this auth does NOT opt into `anonymousCatalog`: without a
 * stored credential or ambient key, `resolve()` returns undefined and Pi's
 * model refresh skips the provider until login/key setup. Chat requests use
 * the same key. Merge keys are issued at merge.dev.
 */

import { getMergeApiKey } from "../../config.ts";
import { createNativeApiKeyAuth } from "../../lib/native-provider.ts";

/** Merge Gateway API-key authentication for both catalog refresh and chat requests. */
export const mergeAuth = createNativeApiKeyAuth({
	name: "Merge API key",
	prompt: "Merge API key",
	source: "MERGE_API_KEY",
	getApiKey: getMergeApiKey,
});
