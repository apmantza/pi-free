import { getStepfunApiKey } from "../../config.ts";
import { createNativeApiKeyAuth } from "../../lib/native-provider.ts";

/** StepFun API-key authentication for both catalog refresh and chat requests. */
export const stepfunAuth = createNativeApiKeyAuth({
	name: "StepFun API key",
	prompt: "StepFun API key",
	source: "STEPFUN_API_KEY",
	getApiKey: getStepfunApiKey,
});
