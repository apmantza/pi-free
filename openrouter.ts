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
import { fetchOpenRouterMetrics, setCachedMetrics } from "./metrics.ts";
import { setupProvider, type StoredModels } from "./provider-helper.ts";

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

  // Shared model storage (references held by setupProvider for commands)
  const stored: StoredModels = { free: [], all: [] };

  // Re-registration closure (set in session_start when we have ctx)
  let reRegisterFn: (models: ProviderModelConfig[]) => void = () => {};

  // Wire up shared boilerplate (commands, model_select, turn_end)
  setupProvider(pi, {
    providerId: PROVIDER_OPENROUTER,
    reRegister: (models) => reRegisterFn(models),
  }, stored);

  // Check in session_start if user already has auth for this provider
  // If yes: filter their models to free-only, use their key
  // If no: use our extension's key with filtered models
  pi.on("session_start", async (_event, ctx) => {
    const allModels = ctx.modelRegistry.getAll();
    const availableModels = ctx.modelRegistry.getAvailable();
    const existingModels = allModels.filter((m) => m.provider === PROVIDER_OPENROUTER);
    const hasExistingAuth = availableModels.some((m) => m.provider === PROVIDER_OPENROUTER);

    if (hasExistingAuth && existingModels.length > 0) {
      // User has existing auth - filter to free models, use their key
      // User has existing auth - filtering to free models

      const freeModels = existingModels
        .filter((m) => (m.cost?.input ?? 0) === 0)
        .map((m) => ({
          id: m.id,
          name: m.name,
          reasoning: m.reasoning,
          input: m.input,
          cost: m.cost,
          contextWindow: m.contextWindow,
          maxTokens: m.maxTokens,
        }));

      if (freeModels.length === 0) {
        console.warn("[openrouter] No free models available from existing auth");
        return;
      }

      // Store for command toggle
      stored.free = freeModels;
      stored.all = existingModels;

      // Set up re-registration closure
      reRegisterFn = (m: ProviderModelConfig[]) => {
        ctx.modelRegistry.registerProvider(PROVIDER_OPENROUTER, {
          baseUrl: BASE_URL_OPENROUTER,
          apiKey: "OPENROUTER_API_KEY",
          api: "openai-completions" as const,
          headers: {
            "HTTP-Referer": "https://github.com/apmantza/pi-free",
            "X-Title": "Pi",
            "User-Agent": "pi-free-providers",
          },
          models: m,
        });
      };

      // Register filtered version (no apiKey - uses existing Pi auth)
      reRegisterFn(freeModels);
      return;
    }

    // User doesn't have existing auth — use our extension's key
    if (apiKey) {
      process.env.OPENROUTER_API_KEY = apiKey;
    } else {
      console.warn("[openrouter] No API key found — set OPENROUTER_API_KEY or add openrouter_api_key to ~/.pi/free.json. Free key at https://openrouter.ai");
      return;
    }

    let models: ProviderModelConfig[] = [];
    let freeCount = 0;
    let fetchResult: { free: ProviderModelConfig[]; all: ProviderModelConfig[] } | null = null;

    try {
      fetchResult = await fetchOpenRouterModels(apiKey);
      freeCount = fetchResult.free.length;
      models = SHOW_PAID ? fetchResult.all : fetchResult.free;
    } catch (error) {
      logWarning("openrouter", "Failed to fetch models", error);
    }

    if (models.length === 0) return;

    // Store for command toggle
    if (fetchResult) {
      stored.free = fetchResult.free;
      stored.all = fetchResult.all;
    }

    // Set up re-registration closure
    reRegisterFn = (m: ProviderModelConfig[]) => {
      ctx.modelRegistry.registerProvider(PROVIDER_OPENROUTER, {
        baseUrl: BASE_URL_OPENROUTER,
        apiKey: "OPENROUTER_API_KEY",
        api: "openai-completions" as const,
        headers: {
          "HTTP-Referer": "https://github.com/apmantza/pi-free",
          "X-Title": "Pi",
          "User-Agent": "pi-free-providers",
        },
        models: m,
      });
    };

    // Register our filtered provider
    reRegisterFn(models);

    const theme = ctx.ui.theme;
    const label = SHOW_PAID
      ? `🔀 OpenRouter (${models.length} models)`
      : `🔀 OpenRouter (${freeCount} free)`;
    ctx.ui.setStatus("openrouter-status", theme.fg("accent", label));

    // Fetch and cache metrics
    const metrics = await fetchOpenRouterMetrics();
    if (metrics) {
      setCachedMetrics(PROVIDER_OPENROUTER, metrics);

      const parts: string[] = [];

      // Show remaining daily requests
      if (metrics.rateLimit?.remainingToday !== undefined) {
        const remaining = metrics.rateLimit.remainingToday;
        const reqDisplay = remaining > 900 ? `${remaining} remaining/day` : `${remaining}/day`;
        parts.push(`📊 ${reqDisplay}`);
      }

      // Show credits balance
      if (metrics.credits !== undefined && metrics.credits > 0) {
        parts.push(`💰 $${metrics.credits.toFixed(2)}`);
      }

      if (parts.length > 0) {
        ctx.ui.setStatus("openrouter-metrics", theme.fg("dim", parts.join(" ")));
      }
    }
  });
}
