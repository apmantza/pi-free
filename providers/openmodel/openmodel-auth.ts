import { getOpenmodelApiKey } from "../../config.ts";
import { createNativeApiKeyAuth } from "../../lib/native-provider.ts";

export const openmodelAuth = createNativeApiKeyAuth({
	name: "OpenModel API key",
	prompt: "OpenModel API key",
	source: "OPENMODEL_API_KEY",
	getApiKey: getOpenmodelApiKey,
	anonymousCatalog: true,
});
