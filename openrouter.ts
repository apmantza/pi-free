/**
 * OpenRouter Provider Extension
 *
 * Provides access to 29+ free models and 300+ paid models via OpenRouter.
 * Requires OPENROUTER_API_KEY (free account at https://openrouter.ai).
 *
 * By default only free (:free) models are shown.
 * Set PI_FREE_SHOW_PAID=true to also include paid models.
 */

import type { ExtensionAPI, ProviderModelConfig } from "@mariozechner/pi-coding-agent";
import { SHOW_PAID, OPENROUTER_API_KEY as CONFIG_API_KEY, applyHidden, PROVIDER_OPENROUTER } from "./config.ts";
import { getCached, setCached } from "./cache.ts";
import { isUsableModel, mapOpenRouterModel, fetchWithRetry, logWarning } from "./util.ts";
import { BASE_URL_OPENROUTER, DEFAULT_FETCH_TIMEOUT_MS } from "./constants.ts";

// =============================================================================
// Fetch
// =============================================================================

async function fetchOpenRouterModels(apiKey: string): Promise<{
  free: ProviderModelConfig[];
  all: ProviderModelConfig[];
}> {
  const cachedFree = getCached<ProviderModelConfig>("openrouter-free");
  const cachedAll  = getCached<ProviderModelConfig>("openrouter-all");
  if (cachedFree && cachedAll) return { free: cachedFree, all: cachedAll };

  const response = await fetchWithRetry(`${BASE_URL_OPENROUTER}/models`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "User-Agent": "pi-free-providers",
      "HTTP-Referer": "https://github.com/apmantza/pi-free",
      "X-Title": "Pi",
    },
    timeoutMs: DEFAULT_FETCH_TIMEOUT_MS,
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch OpenRouter models: ${response.status} ${response.statusText}`);
  }

  const json = (await response.json()) as { data?: {
    id: string;
    name: string;
    context_length: number;
    max_completion_tokens?: number | null;
    pricing?: { prompt?: string | null; completion?: string | null; input_cache_write?: string | null; input_cache_read?: string | null };
    architecture?: { input_modalities?: string[] | null; output_modalities?: string[] | null };
    top_provider?: { max_completion_tokens?: number | null };
    supported_parameters?: string[];
  }[] };
  if (!json.data || !Array.isArray(json.data)) {
    throw new Error("Invalid OpenRouter models response");
  }

  const chatModels = json.data.filter((m) => {
    const out = m.architecture?.output_modalities ?? [];
    if (out.includes("image")) return false;
    return true;
  });

  const isFree = (m: typeof chatModels[0]): boolean => {
    const prompt = parseFloat(m.pricing?.prompt ?? "1");
    const completion = parseFloat(m.pricing?.completion ?? "1");
    if (prompt !== 0 || completion !== 0) return false;
    if (m.id.includes(":free")) return true;
    if (m.id.startsWith("openrouter/")) return true;
    return false;
  };

  const free = chatModels.filter((m) => isFree(m) && isUsableModel(m.id)).map(mapOpenRouterModel);
  const all = chatModels.filter((m) => isUsableModel(m.id)).map(mapOpenRouterModel);
  const result = { free: applyHidden(free), all: applyHidden(all) };
  setCached("openrouter-free", result.free);
  setCached("openrouter-all", result.all);
  return result;
}

// =============================================================================
// Extension Entry Point
// =============================================================================

export default async function (pi: ExtensionAPI) {
  const apiKey = CONFIG_API_KEY;
  // Inject into process.env so Pi's apiKey lookup finds it even when loaded from ~/.pi/free.json.
  if (apiKey) process.env.OPENROUTER_API_KEY = apiKey;

  if (!apiKey) {
    console.warn("[openrouter] No API key found — set OPENROUTER_API_KEY or add openrouter_api_key to ~/.pi/free.json. Free key at https://openrouter.ai");
    return;
  }

  let models: ProviderModelConfig[] = [];
  let freeCount = 0;

  try {
    const result = await fetchOpenRouterModels(apiKey);
    freeCount = result.free.length;
    models = SHOW_PAID ? result.all : result.free;
  } catch (error) {
    logWarning("openrouter", "Failed to fetch models", error);
  }

  if (models.length === 0) return;

  pi.registerProvider(PROVIDER_OPENROUTER, {
    baseUrl: BASE_URL_OPENROUTER,
    apiKey: "OPENROUTER_API_KEY",
    api: "openai-completions" as const,
    headers: {
      "HTTP-Referer": "https://github.com/apmantza/pi-free",
      "X-Title": "Pi",
      "User-Agent": "pi-free-providers",
    },
    models,
  });

  pi.on("session_start", async (_event, ctx) => {
    const theme = ctx.ui.theme;
    const label = SHOW_PAID
      ? `🔀 OpenRouter (${models.length} models)`
      : `🔀 OpenRouter (${freeCount} free)`;
    ctx.ui.setStatus("openrouter-status", theme.fg("accent", label));
  });

  pi.on("model_select", (_event, ctx) => {
    if (_event.model?.provider !== PROVIDER_OPENROUTER) ctx.ui.setStatus("openrouter-status", undefined);
  });
}
