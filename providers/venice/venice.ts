/**
 * Venice AI provider extension.
 *
 * Venice.ai offers a privacy-focused, OpenAI-compatible inference API
 * spanning 100+ text models (frontier reasoning, open weights, and stealth
 * preview models) billed in USD or DIEM per million tokens.
 *
 * Endpoint:
 *   Chat:   https://api.venice.ai/api/v1/chat/completions
 *   Models: https://api.venice.ai/api/v1/models?type=text
 *
 * The model catalog is public (no credential required to list models), so
 * models appear before login; chat requests require an API key.
 *
 * Balance gate: Venice requires a positive account balance for ALL
 * inference — including $0-listed models — so an unfunded key will see
 * request-time 402 errors even for models classified free. Classification
 * intentionally follows the published pricing data; the catalog defaults
 * to showing paid models via /toggle-venice.
 *
 * Setup:
 *   1. Sign up at https://venice.ai/ and create an API key
 *      (https://venice.ai/settings/api)
 *   2. Set VENICE_API_KEY env var (or add venice_api_key to ~/.pi/free.json)
 *
 * Usage:
 *   pi install git:github.com/apmantza/pi-free
 *   # Set VENICE_API_KEY env var
 *   # Models appear in /model selector as "venice/claude-sonnet-4-6"
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getVeniceApiKey, getVeniceShowPaid } from "../../config.ts";
import { BASE_URL_VENICE, PROVIDER_VENICE } from "../../constants.ts";
import { registerNativeOpenAIProvider } from "../../lib/native-provider.ts";
import { veniceAuth } from "./venice-auth.ts";
import { fetchVeniceModels } from "./venice-models.ts";

export default function veniceProvider(pi: ExtensionAPI): Promise<void> {
 registerNativeOpenAIProvider(pi, {
  providerId: PROVIDER_VENICE,
  name: "Venice AI",
  baseUrl: BASE_URL_VENICE,
  auth: veniceAuth,
  getApiKey: getVeniceApiKey,
  getShowPaid: getVeniceShowPaid,
  allowUnauthenticated: true,
  fetchModels: (apiKey, signal) => fetchVeniceModels(apiKey, signal),
 });
 return Promise.resolve();
}
