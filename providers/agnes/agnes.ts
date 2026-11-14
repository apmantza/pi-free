/**
 * Agnes AI native provider.
 *
 * Agnes AI (https://agnes-ai.com) is a free omni-modal AI gateway exposing a
 * single OpenAI-compatible Inference API at `https://apihub.agnes-ai.com/v1`
 * covering text, image, and video models under one `sk-` API key. Pi owns
 * authentication, model-store persistence, refresh scheduling, and request
 * streaming through the native provider lifecycle.
 *
 * Agnes is a freemium gateway, not an entirely-free one: per the Agnes
 * pricing docs (2026-11-15) the flash text models (agnes-2.5-flash,
 * agnes-3.0-flash) are free; the pro models are billed at list price.
 * agnes-models.ts publishes only the documented text models and stamps each
 * with its documented verdict (`_freeKnown`/`_isFree`); the paid pro models
 * surface via `/toggle-agnes`. Image/video generators are not published.
 *
 * Setup:
 *   AGNES_API_KEY=...
 *   # or add agnes_api_key to ~/.pi/free.json
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgnesApiKey, getAgnesShowPaid } from "../../config.ts";
import { BASE_URL_AGNES, PROVIDER_AGNES } from "../../constants.ts";
import {
	registerNativeOpenAIProvider,
	type NativeOpenAIProviderOptions,
} from "../../lib/native-provider.ts";
import { agnesAuth } from "./agnes-auth.ts";
import { fetchAgnesModels } from "./agnes-models.ts";

export const agnesProviderOptions: NativeOpenAIProviderOptions = {
	providerId: PROVIDER_AGNES,
	name: "Agnes AI",
	baseUrl: BASE_URL_AGNES,
	auth: agnesAuth,
	getApiKey: getAgnesApiKey,
	getShowPaid: getAgnesShowPaid,
	fetchModels: (apiKey, signal) => fetchAgnesModels(apiKey, signal),
};

export default function agnesProvider(pi: ExtensionAPI): Promise<void> {
	registerNativeOpenAIProvider(pi, agnesProviderOptions);
	return Promise.resolve();
}
