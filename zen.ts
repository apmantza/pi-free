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
import { SHOW_PAID, OPENCODE_API_KEY as CONFIG_API_KEY, applyHidden } from "./config.ts";
import { getCached, setCached } from "./cache.ts";
import { fetchWithRetry } from "./fetch-util.ts";

const ZEN_GATEWAY_BASE = "https://opencode.ai/zen/v1";
const MODELS_DEV_URL = "https://models.dev/api.json";
const ZEN_TOS_URL = "https://opencode.ai/terms";
const FETCH_TIMEOUT_MS = 10_000;

// Module-level so it persists across sessions within the same process.
let noticeShown = false;

// =============================================================================
// Types
// =============================================================================

interface GatewayModel {
  id: string;
  object?: string;
}

interface ModelsDevModel {
  id: string;
  name: string;
  reasoning: boolean;
  cost?: { input: number; output: number; cache_read?: number; cache_write?: number };
  limit: { context: number; output: number };
  modalities?: { input?: string[]; output?: string[] };
}

// =============================================================================
// Fetch helpers
// =============================================================================

/** Fetch the model list from the Zen gateway — authoritative for what's deployed. */
async function fetchGatewayModels(token: string): Promise<string[]> {
  const response = await fetchWithRetry(`${ZEN_GATEWAY_BASE}/models`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "pi-free-providers",
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Zen /models returned ${response.status} ${response.statusText}`);
  }

  const json = (await response.json()) as { data?: GatewayModel[] };
  return (json.data ?? []).map((m) => m.id);
}

/** Fetch metadata for the opencode provider from models.dev. */
async function fetchModelsMeta(): Promise<Record<string, ModelsDevModel>> {
  const response = await fetchWithRetry(MODELS_DEV_URL, {
    headers: { "User-Agent": "pi-free-providers" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
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
}> {
  const cachedAll = getCached<ProviderModelConfig>("zen");
  if (cachedAll) {
    return { all: cachedAll, free: cachedAll.filter((m) => (m.cost.input ?? 0) === 0) };
  }

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

  const result = { all: applyHidden(all), free: applyHidden(free) };
  setCached("zen", result.all);
  return result;
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
  process.env[ZEN_KEY_VAR] = token;

  let models: ProviderModelConfig[] = [];
  let freeCount = 0;

  try {
    const result = await fetchZenModels(token);
    models = hasKey && SHOW_PAID ? result.all : result.free;
    freeCount = result.free.length;
  } catch (error) {
    console.warn("[zen] Failed to fetch models:", error instanceof Error ? error.message : error);
  }

  if (models.length === 0) return;

  pi.registerProvider("zen", {
    baseUrl: ZEN_GATEWAY_BASE,
    apiKey: ZEN_KEY_VAR,
    api: "openai-completions" as const,
    headers: {
      "X-Title": "Pi",
      "HTTP-Referer": "https://opencode.ai/",
      "User-Agent": "pi-free-providers",
    },
    models,
  });

  pi.on("session_start", async (_event, ctx) => {
    const theme = ctx.ui.theme;
    const label = hasKey
      ? `✦ Zen (${models.length} models)`
      : `✦ Zen (${freeCount} free)`;
    ctx.ui.setStatus("zen-status", theme.fg("accent", label));
  });

  pi.on("model_select", (_event, ctx) => {
    if (_event.model?.provider !== "zen") ctx.ui.setStatus("zen-status", undefined);
  });

  pi.on("before_agent_start", async (_event, ctx) => {
    if (noticeShown || hasKey || ctx.model?.provider !== "zen") return;
    noticeShown = true;
    return {
      message: {
        customType: "zen",
        content: `Using OpenCode Zen free models. Set OPENCODE_API_KEY for paid access.\nTerms: ${ZEN_TOS_URL}`,
        display: "inline",
      },
    };
  });
}
