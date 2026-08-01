/**
 * StepFun Step Plan native provider.
 *
 * StepFun exposes an OpenAI-compatible Chat Completions API at the supplied
 * `/step_plan/v1` base URL. Pi owns authentication, model-store persistence,
 * refresh scheduling, and request streaming through the native provider
 * lifecycle.
 *
 * Setup:
 *   STEPFUN_API_KEY=...
 *   # or add stepfun_api_key to ~/.pi/free.json
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getStepfunApiKey, getStepfunShowPaid } from "../../config.ts";
import { BASE_URL_STEPFUN, PROVIDER_STEPFUN } from "../../constants.ts";
import { registerNativeOpenAIProvider } from "../../lib/native-provider.ts";
import { stepfunAuth } from "./stepfun-auth.ts";
import { fetchStepfunModels } from "./stepfun-models.ts";

export default function stepfunProvider(pi: ExtensionAPI): Promise<void> {
	registerNativeOpenAIProvider(pi, {
		providerId: PROVIDER_STEPFUN,
		name: "StepFun",
		baseUrl: BASE_URL_STEPFUN,
		auth: stepfunAuth,
		getApiKey: getStepfunApiKey,
		getShowPaid: getStepfunShowPaid,
		fetchModels: (apiKey, signal) => fetchStepfunModels(apiKey, signal),
	});
	return Promise.resolve();
}
