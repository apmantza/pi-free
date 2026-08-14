import { getDeepinfraApiKey } from "../../config.ts";
import { createNativeApiKeyAuth } from "../../lib/native-provider.ts";

export const deepinfraAuth = createNativeApiKeyAuth({
	name: "DeepInfra API key",
	prompt: "DeepInfra API key",
	source: "DEEPINFRA_TOKEN",
	getApiKey: getDeepinfraApiKey,
	anonymousCatalog: true,
});
