/**
 * Infron AI provider extension.
 *
 * Infron AI (infron.ai) is a unified AI gateway routing to 500+ models
 * across multiple upstream providers with passthrough pricing and pooled
 * uptime. The OpenAI-compatible inference API lives on the OneRouter
 * gateway at `https://llm.onerouter.pro/v1` (chat, vision, tools across
 * ~285 LLM entries; embeddings/image/video entries are filtered out).
 *
 * Endpoint:
 *   Chat:   https://llm.onerouter.pro/v1/chat/completions
 *   Models: https://llm.onerouter.pro/v1/models
 *
 * The model catalog is public (anonymous /models returns 200), so models
 * appear before login; chat requests require an API key from infron.ai.
 *
 * Free models: the catalog's zero-priced LLM entries (currently five,
 * including three explicit `:free` ids) are classified free via Route A
 * pricing detection — no curated list needed.
 *
 * Setup:
 *   INFRON_API_KEY=sk-...
 *   # or add infron_api_key to ~/.pi/free.json
 *
 * Usage:
 *   pi install git:github.com/apmantza/pi-free
 *   # Models appear in /model selector as "infron/moonshotai/kimi-k2.6:free"
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getInfronApiKey, getInfronShowPaid } from "../../config.ts";
import { BASE_URL_INFRON, PROVIDER_INFRON } from "../../constants.ts";
import { registerNativeOpenAIProvider } from "../../lib/native-provider.ts";
import { infronAuth } from "./infron-auth.ts";
import { fetchInfronModels } from "./infron-models.ts";

export default function infronProvider(pi: ExtensionAPI): Promise<void> {
 registerNativeOpenAIProvider(pi, {
  providerId: PROVIDER_INFRON,
  name: "Infron AI",
  baseUrl: BASE_URL_INFRON,
  auth: infronAuth,
  getApiKey: getInfronApiKey,
  getShowPaid: getInfronShowPaid,
  allowUnauthenticated: true,
  fetchModels: (apiKey, signal) => fetchInfronModels(apiKey, signal),
 });
 return Promise.resolve();
}
