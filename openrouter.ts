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
import { SHOW_PAID, OPENROUTER_API_KEY as CONFIG_API_KEY, applyHidden } from "./config.ts";
import { getCached, setCached } from "./cache.ts";
import { isUsableModel } from "./model-filter.ts";
import { fetchWithRetry } from "./fetch-util.ts";

const OPENROUTER_GATEWAY_BASE = "https://openrouter.ai/api/v1";
const MODELS_FETCH_TIMEOUT_MS = 10_000;

// =============================================================================
// Types
// =============================================================================

interface OpenRouterModel {
  id: string;
  name: string;
  context_length: number;
  max_completion_tokens?: number | null;
  pricing?: {
    prompt?: string | null;
    completion?: string | null;
    input_cache_write?: string | null;
    input_cache_read?: string | null;
  };
  architecture?: {
    input_modalities?: string[] | null;
    output_modalities?: string[] | null;
  };
  top_provider?: { max_completion_tokens?: number | null };
  supported_parameters?: string[];
}

// =============================================================================
// Helpers
// =============================================================================

function parsePrice(price: string | null | undefined): number {
  if (!price) return 0;
  const n = parseFloat(price);
  // OpenRouter prices are per-token; Pi expects per-million-token
  return isNaN(n) ? 0 : n * 1_000_000;
}

function isFreeModel(m: OpenRouterModel): boolean {
  const prompt = parseFloat(m.pricing?.prompt ?? "1");
  const completion = parseFloat(m.pricing?.completion ?? "1");
  if (prompt !== 0 || completion !== 0) return false;
  if (m.id.includes(":free")) return true;
  if (m.id.startsWith("openrouter/")) return true;
  return false;
}

function mapModel(m: OpenRouterModel): ProviderModelConfig {
  const inputMods = m.architecture?.input_modalities ?? ["text"];
  const maxTokens =
    m.top_provider?.max_completion_tokens ??
    m.max_completion_tokens ??
    Math.ceil(m.context_length * 0.2);

  return {
    id: m.id,
    name: m.name,
    reasoning: m.supported_parameters?.includes("reasoning") ?? false,
    input: inputMods.includes("image") ? ["text", "image"] : ["text"],
    cost: {
      input: parsePrice(m.pricing?.prompt),
      output: parsePrice(m.pricing?.completion),
      cacheRead: parsePrice(m.pricing?.input_cache_read),
      cacheWrite: parsePrice(m.pricing?.input_cache_write),
    },
    contextWindow: m.context_length,
    maxTokens,
  };
}

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

  const response = await fetchWithRetry(`${OPENROUTER_GATEWAY_BASE}/models`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "User-Agent": "pi-free-providers",
      "HTTP-Referer": "https://github.com/apmantza/pi-free",
      "X-Title": "Pi",
    },
    signal: AbortSignal.timeout(MODELS_FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch OpenRouter models: ${response.status} ${response.statusText}`);
  }

  const json = (await response.json()) as { data?: OpenRouterModel[] };
  if (!json.data || !Array.isArray(json.data)) {
    throw new Error("Invalid OpenRouter models response");
  }

  const chatModels = json.data.filter((m) => {
    const out = m.architecture?.output_modalities ?? [];
    if (out.includes("image")) return false;
    return true;
  });

  const free = chatModels.filter((m) => isFreeModel(m) && isUsableModel(m.id)).map(mapModel);
  const all = chatModels.filter((m) => isUsableModel(m.id)).map(mapModel);
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
  if (!apiKey) {
    console.warn("[openrouter] No API key found — set OPENROUTER_API_KEY or add openrouter_api_key to ~/.pi-free.json. Free key at https://openrouter.ai");
    return;
  }

  let models: ProviderModelConfig[] = [];
  let freeCount = 0;

  try {
    const result = await fetchOpenRouterModels(apiKey);
    freeCount = result.free.length;
    models = SHOW_PAID ? result.all : result.free;
  } catch (error) {
    console.warn("[openrouter] Failed to fetch models:", error instanceof Error ? error.message : error);
  }

  if (models.length === 0) return;

  pi.registerProvider("openrouter", {
    baseUrl: OPENROUTER_GATEWAY_BASE,
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
    if (_event.model?.provider !== "openrouter") ctx.ui.setStatus("openrouter-status", undefined);
  });
}
