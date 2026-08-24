/**
 * GMI Cloud native provider.
 *
 * GMI Cloud exposes a single OpenAI-compatible Inference API at
 * `https://api.gmi-serving.com/v1` covering chat, vision, tools, and
 * reasoning across 200+ open and frontier models. Pi owns authentication,
 * model-store persistence, refresh scheduling, and request streaming through
 * the native provider lifecycle.
 *
 * Setup:
 *   GMI_API_KEY=...
 *   # or add gmi_api_key to ~/.pi/free.json
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getGmiApiKey, getGmiShowPaid } from "../../config.ts";
import { BASE_URL_GMI, PROVIDER_GMI } from "../../constants.ts";
import { registerNativeOpenAIProvider } from "../../lib/native-provider.ts";
import { gmiAuth } from "./gmi-auth.ts";
import { fetchGmiModels } from "./gmi-models.ts";

export default function gmiProvider(pi: ExtensionAPI): Promise<void> {
 registerNativeOpenAIProvider(pi, {
  providerId: PROVIDER_GMI,
  name: "GMI Cloud",
  baseUrl: BASE_URL_GMI,
  auth: gmiAuth,
  getApiKey: getGmiApiKey,
  getShowPaid: getGmiShowPaid,
  fetchModels: (apiKey, signal) => fetchGmiModels(apiKey, signal),
 });
 return Promise.resolve();
}
