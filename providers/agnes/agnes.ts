/**
 * Agnes AI native provider.
 *
 * Agnes AI (https://agnes-ai.com) is a free omni-modal AI gateway exposing a
 * single OpenAI-compatible Inference API at `https://apihub.agnes-ai.com/v1`
 * covering text, image, and video models under one `sk-` API key. Pi owns
 * authentication, model-store persistence, refresh scheduling, and request
 * streaming through the native provider lifecycle.
 *
 * Agnes is an entirely-free gateway: every chat model in its catalog is free
 * to use, so models are stamped explicitly free (`_freeKnown`/`_isFree`) and
 * the catalog defaults to the free-only view. Image/video generation models
 * are filtered out — only text chat models are published, since pi-free feeds
 * a coding agent that speaks Chat Completions.
 *
 * Setup:
 *   AGNES_API_KEY=...
 *   # or add agnes_api_key to ~/.pi/free.json
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgnesApiKey, getAgnesShowPaid } from "../../config.ts";
import { BASE_URL_AGNES, PROVIDER_AGNES } from "../../constants.ts";
import { registerNativeOpenAIProvider } from "../../lib/native-provider.ts";
import { agnesAuth } from "./agnes-auth.ts";
import { fetchAgnesModels } from "./agnes-models.ts";

export default function agnesProvider(pi: ExtensionAPI): Promise<void> {
 registerNativeOpenAIProvider(pi, {
  providerId: PROVIDER_AGNES,
  name: "Agnes AI",
  baseUrl: BASE_URL_AGNES,
  auth: agnesAuth,
  getApiKey: getAgnesApiKey,
  getShowPaid: getAgnesShowPaid,
  fetchModels: (apiKey, signal) => fetchAgnesModels(apiKey, signal),
 });
 return Promise.resolve();
}
