/**
 * OpenCode Zen Provider Extension
 *
 * Provides access to curated AI models via the OpenCode Zen gateway.
 * Free models are available immediately with no account needed.
 * Set OPENCODE_API_KEY (or opencode_api_key in ~/.pi/free.json) for paid access.
 *
 * Model list fetched directly from the Zen gateway — only returns models that
 * are actually deployed. Metadata (pricing, context) enriched from models.dev.
 */

import type { ExtensionAPI, ProviderModelConfig } from "@mariozechner/pi-coding-agent";
import type { ZenGatewayModel, ModelsDevModel } from "./types.ts";
import { SHOW_PAID, OPENCODE_API_KEY as CONFIG_API_KEY, applyHidden, PROVIDER_ZEN } from "./config.ts";
import { getCached, setCached } from "./cache.ts";
import { fetchWithRetry, logWarning } from "./util.ts";
import { BASE_URL_ZEN, URL_MODELS_DEV, URL_ZEN_TOS, DEFAULT_FETCH_TIMEOUT_MS } from "./constants.ts";
import { setupProvider, type StoredModels } from "./provider-helper.ts";

// =============================================================================
// Static fallback models (from Pi's built-in + OpenCode docs)
// Used when /models API is unavailable
// =============================================================================

const STATIC_ZEN_MODELS: ProviderModelConfig[] = [
  // Free models (from OpenCode Zen docs)
  {
    id: "big-pickle",
    name: "Big Pickle",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0 },
    contextWindow: 200000,
    maxTokens: 128000,
  },
  {
    id: "trinity-large-preview-free",
    name: "Trinity Large Preview Free",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0 },
    contextWindow: 128000,
    maxTokens: 16384,
  },
  {
    id: "minimax-m2.5-free",
    name: "MiniMax M2.5 Free",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0 },
    contextWindow: 200000,
    maxTokens: 16384,
  },
  {
    id: "mimo-v2-pro-free",
    name: "MiMo V2 Pro Free",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0 },
    contextWindow: 128000,
    maxTokens: 16384,
  },
  {
    id: "mimo-v2-omni-free",
    name: "MiMo V2 Omni Free",
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 0, output: 0 },
    contextWindow: 128000,
    maxTokens: 16384,
  },
  {
    id: "mimo-v2-flash-free",
    name: "MiMo V2 Flash Free",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0 },
    contextWindow: 128000,
    maxTokens: 16384,
  },
  {
    id: "nemotron-3-super-free",
    name: "Nemotron 3 Super Free",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0 },
    contextWindow: 128000,
    maxTokens: 16384,
  },
  // Paid models (available when show_paid: true and API key set)
  {
    id: "claude-3-5-haiku",
    name: "Claude Haiku 3.5",
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 0.8, output: 4 },
    contextWindow: 200000,
    maxTokens: 8192,
  },
  {
    id: "claude-haiku-4-5",
    name: "Claude Haiku 4.5",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 1, output: 5 },
    contextWindow: 200000,
    maxTokens: 64000,
  },
  {
    id: "claude-opus-4-5",
    name: "Claude Opus 4.5",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 5, output: 25 },
    contextWindow: 200000,
    maxTokens: 64000,
  },
  {
    id: "claude-sonnet-4-5",
    name: "Claude Sonnet 4.5",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 3, output: 15 },
    contextWindow: 200000,
    maxTokens: 64000,
  },
  {
    id: "gemini-3-flash",
    name: "Gemini 3 Flash",
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 0.5, output: 3 },
    contextWindow: 128000,
    maxTokens: 16384,
  },
  {
    id: "gemini-3.1-pro",
    name: "Gemini 3.1 Pro",
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 2, output: 12 },
    contextWindow: 200000,
    maxTokens: 16384,
  },
  {
    id: "minimax-m2.5",
    name: "MiniMax M2.5",
    reasoning: true,
    input: ["text"],
    cost: { input: 0.3, output: 1.2 },
    contextWindow: 200000,
    maxTokens: 16384,
  },
];

// =============================================================================
// Fetch helpers
// =============================================================================

// Models confirmed broken (always return empty content regardless of token budget).
const ZEN_BROKEN_MODELS = new Set([
  "gpt-5-nano",   // always returns empty content/choices
  "gpt-5.4-nano", // same family, same issue
]);

/** Fetch the model list from the Zen gateway — authoritative for what's deployed. */
async function fetchGatewayModels(token: string): Promise<string[]> {
  const response = await fetchWithRetry(`${BASE_URL_ZEN}/models`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "pi-free-providers",
    },
    timeoutMs: DEFAULT_FETCH_TIMEOUT_MS,
  });

  if (!response.ok) {
    throw new Error(`Zen /models returned ${response.status} ${response.statusText}`);
  }

  const json = (await response.json()) as { data?: ZenGatewayModel[] };
  return (json.data ?? []).map((m) => m.id).filter((id) => !ZEN_BROKEN_MODELS.has(id));
}

/** Fetch metadata for the opencode provider from models.dev. */
async function fetchModelsMeta(): Promise<Record<string, ModelsDevModel>> {
  const response = await fetchWithRetry(URL_MODELS_DEV, {
    headers: { "User-Agent": "pi-free-providers" },
    timeoutMs: DEFAULT_FETCH_TIMEOUT_MS,
  });

  if (!response.ok) return {};

  const json = (await response.json()) as Record<string, { id?: string; models?: Record<string, ModelsDevModel> }>;
  const provider = Object.values(json).find((p) => p?.id === "opencode");
  return provider?.models ?? {};
}

// =============================================================================
// Main fetch
// =============================================================================

async function fetchZenModels(token: string): Promise<{
  all: ProviderModelConfig[];
  free: ProviderModelConfig[];
  useStaticFallback: boolean;
}> {
  const cachedAll = getCached<ProviderModelConfig>(PROVIDER_ZEN);
  if (cachedAll) {
    return { all: cachedAll, free: cachedAll.filter((m) => (m.cost.input ?? 0) === 0), useStaticFallback: false };
  }

  try {
    const [gatewayIds, meta] = await Promise.all([
      fetchGatewayModels(token),
      fetchModelsMeta(),
    ]);

    const all: ProviderModelConfig[] = [];
    const free: ProviderModelConfig[] = [];

    for (const id of gatewayIds) {
      const m = meta[id];

      // Skip image-output models
      if (m?.modalities?.output?.includes("image")) continue;

      const config: ProviderModelConfig = {
        id,
        name: m?.name ?? id,
        reasoning: m?.reasoning ?? false,
        input: m?.modalities?.input?.includes("image") ? ["text", "image"] : ["text"],
        cost: {
          input: m?.cost?.input ?? 0,
          output: m?.cost?.output ?? 0,
          cacheRead: m?.cost?.cache_read,
          cacheWrite: m?.cost?.cache_write,
        },
        contextWindow: m?.limit?.context ?? 128_000,
        maxTokens: m?.limit?.output ?? 16_384,
      };

      all.push(config);
      if ((m?.cost?.input ?? 0) === 0) free.push(config);
    }

    const result = { all: applyHidden(all), free: applyHidden(free), useStaticFallback: false };
    setCached(PROVIDER_ZEN, result.all);
    return result;
  } catch (error) {
    // API failed - return special flag to skip registration
    // Pi's built-in OpenCode provider will be used instead
    logWarning("zen", "API unavailable, letting Pi use built-in provider", error);
    return { all: [], free: [], useStaticFallback: true };
  }
}

// =============================================================================
// Extension Entry Point
// =============================================================================

export default async function (pi: ExtensionAPI) {
  const hasKey = !!CONFIG_API_KEY;
  const token = CONFIG_API_KEY ?? "public";

  // Use a private env var so we don't accidentally activate Pi's built-in
  // opencode provider, which also watches OPENCODE_API_KEY.
  const ZEN_KEY_VAR = "PI_FREE_ZEN_API_KEY";

  // Shared model storage (references held by setupProvider for commands)
  const stored: StoredModels = { free: [], all: [] };

  function registerZenModels(models: ProviderModelConfig[]) {
    ctx_modelRegistry_register(models);
  }

  // We need a closure that captures the runtime ctx for re-registration.
  // setupProvider's reRegister callback will call this with the current ctx.
  let ctx_modelRegistry_register: (models: ProviderModelConfig[]) => void = () => {};

  // Wire up shared boilerplate (commands, model_select, turn_end, ToS)
  setupProvider(pi, {
    providerId: PROVIDER_ZEN,
    tosUrl: URL_ZEN_TOS,
    hasKey,
    reRegister: (models, _stored) => {
      ctx_modelRegistry_register(models);
    },
  }, stored);

  // Check in session_start if user already has auth for this provider
  // Only register our filtered version if they don't have existing setup
  pi.on("session_start", async (_event, ctx) => {
    const availableModels = ctx.modelRegistry.getAvailable();
    const hasExistingAuth = availableModels.some((m) => m.provider === PROVIDER_ZEN);

    if (hasExistingAuth) {
      return;
    }

    // User doesn't have existing auth — use our extension
    process.env[ZEN_KEY_VAR] = token;

    let models: ProviderModelConfig[] = [];
    let freeCount = 0;
    let useStaticFallback = false;

    try {
      const result = await fetchZenModels(token);
      models = hasKey && SHOW_PAID ? result.all : result.free;
      freeCount = result.free.length;
      useStaticFallback = result.useStaticFallback;

      // Store for command toggle
      stored.free = result.free;
      stored.all = result.all;
    } catch (error) {
      logWarning("zen", "Failed to fetch models", error);
    }

    // If API failed, don't register our provider - let Pi use its built-in
    if (useStaticFallback || models.length === 0) {
      return;
    }

    // Set up the re-registration closure with this ctx
    ctx_modelRegistry_register = (m: ProviderModelConfig[]) => {
      ctx.modelRegistry.registerProvider(PROVIDER_ZEN, {
        baseUrl: BASE_URL_ZEN,
        apiKey: ZEN_KEY_VAR,
        api: "openai-completions" as const,
        headers: {
          "X-Title": "Pi",
          "HTTP-Referer": "https://opencode.ai/",
          "User-Agent": "pi-free-providers",
        },
        models: m,
      });
    };

    // Register our filtered provider
    ctx_modelRegistry_register(models);

    const theme = ctx.ui.theme;
    const label = hasKey
      ? `✦ Zen (${models.length} models)`
      : `✦ Zen (${freeCount} free)`;
    ctx.ui.setStatus("zen-status", theme.fg("accent", label));
  });
}
