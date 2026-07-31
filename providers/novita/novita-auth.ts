import { getNovitaApiKey } from "../../config.ts";
import { createNativeApiKeyAuth } from "../../lib/native-provider.ts";

export const novitaAuth = createNativeApiKeyAuth({
	name: "Novita API key",
	prompt: "Novita API key",
	source: "NOVITA_API_KEY",
	getApiKey: getNovitaApiKey,
});
