/**
 * CommandCode API-key authentication.
 *
 * The model catalog (api.commandcode.ai/provider/v1/models) answers
 * anonymously, but resolution returns undefined without a key, so Pi hides
 * Command Code until one exists (#697). Chat requires an account whose plan
 * includes Provider API access; keys are issued at commandcode.ai (format
 * `user_...`).
 */

import { getCommandCodeApiKey } from "../../config.ts";
import { createNativeApiKeyAuth } from "../../lib/native-provider.ts";

/** CommandCode API-key authentication for catalog refresh and chat requests. */
export const commandCodeAuth = createNativeApiKeyAuth({
	name: "CommandCode API key",
	prompt: "CommandCode API key",
	source: "COMMAND_CODE_API_KEY",
	getApiKey: getCommandCodeApiKey,
});
