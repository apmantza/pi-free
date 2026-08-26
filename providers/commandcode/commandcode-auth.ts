/**
 * CommandCode API-key authentication.
 *
 * The model catalog (api.commandcode.ai/provider/v1/models) is public —
 * anonymous GET returns 200 (verified live) — so keyless resolution returns a
 * truthy anonymous result and Pi's model refresh populates the catalog. Chat
 * requires an account whose plan includes Provider API access; keys are
 * issued at commandcode.ai (format `user_...`).
 */

import { getCommandCodeApiKey } from "../../config.ts";
import { createNativeApiKeyAuth } from "../../lib/native-provider.ts";

/** CommandCode API-key authentication for catalog refresh and chat requests. */
export const commandCodeAuth = createNativeApiKeyAuth({
 name: "CommandCode API key",
 prompt: "CommandCode API key",
 source: "COMMAND_CODE_API_KEY",
 getApiKey: getCommandCodeApiKey,
 anonymousCatalog: true,
});
