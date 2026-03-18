/**
 * OpenCode Zen Provider Extension
 *
 * Provides access to curated AI models via the OpenCode Zen gateway.
 * Free models (cost = $0) are available immediately with no account needed.
 * Set OPENCODE_API_KEY for access to paid models.
 *
 * Models sourced from https://models.dev/api.json (opencode provider).
 * Gateway: https://opencode.ai/zen/v1 (OpenAI-compatible)
 *
 * Usage:
 *   pi install git:github.com/your-username/pi-free-providers
 *   # Free models work immediately.
 *   # For paid models: set OPENCODE_API_KEY=<your key>
 */

import type { ExtensionAPI, ProviderModelConfig } from "@mariozechner/pi-coding-agent";
import { SHOW_PAID, OPENCODE_API_KEY as CONFIG_API_KEY, applyHidden } from "./config.ts";
import { getCached, setCached } from "./cache.ts";
import { fetchWithRetry } from "./fetch-util.ts";

// =============================================================================
// Constants
// =============================================================================

const ZEN_GATEWAY_BASE = "https://opencode.ai/zen/v1";
const MODELS_DEV_URL = "https://models.dev/api.json";
const ZEN_TOS_URL = "https://opencode.ai/terms";
const MODELS_FETCH_TIMEOUT_MS = 10_000;

// =============================================================================
// Types (models.dev schema)
// =============================================================================

interface ModelsDevModel {
  id: string;
  name: string;
  reasoning: boolean;
  attachment: boolean;
  tool_call: boolean;
  temperature: boolean;
  cost?: {
    input: number;
    output: number;
    cache_read?: number;
    cache_write?: number;
  };
  limit: {
    context: number;
    output: number;
    input?: number;
  };
  modalities?: {
    input?: string[];
    output?: string[];
  };
}

interface ModelsDevProvider {
  id: string;
  api: string;
  models: Record<string, ModelsDevModel>;
}

// =============================================================================
// Model fetching
// =============================================================================

async function fetchZenModels(): Promise<{
  all: ProviderModelConfig[];
  free: ProviderModelConfig[];
}> {
  const cachedAll = getCached<ProviderModelConfig>("zen");
  if (cachedAll) return { all: cachedAll, free: cachedAll.filter((m) => (m.cost?.input ?? 0) === 0) };

  const response = await fetchWithRetry(MODELS_DEV_URL, {
    headers: { "User-Agent": "pi-free-providers" },
    signal: AbortSignal.timeout(MODELS_FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch models.dev: ${response.status} ${response.statusText}`);
  }

  const json = (await response.json()) as Record<string, ModelsDevProvider>;

  // Find the opencode provider entry
  const provider = Object.values(json).find((p) => p?.id === "opencode");
  if (!provider?.models) {
    throw new Error("opencode provider not found in models.dev response");
  }

  const all: ProviderModelConfig[] = [];
  const free: ProviderModelConfig[] = [];

  for (const m of Object.values(provider.models)) {
    // Skip image-output models
    if (m.modalities?.output?.includes("image")) continue;

    const config = mapZenModel(m);
    all.push(config);
    if ((m.cost?.input ?? 1) === 0) free.push(config);
  }

  const result = { all: applyHidden(all), free: applyHidden(free) };
  setCached("zen", result.all);
  return result;
}

function mapZenModel(m: ModelsDevModel): ProviderModelConfig {
  const supportsImages = m.modalities?.input?.includes("image") ?? false;
  // models.dev costs are already in $/million-token (same unit Pi uses)
  return {
    id: m.id,
    name: m.name,
    reasoning: m.reasoning,
    input: supportsImages ? ["text", "image"] : ["text"],
    cost: {
      input: m.cost?.input ?? 0,
      output: m.cost?.output ?? 0,
      cacheRead: m.cost?.cache_read,
      cacheWrite: m.cost?.cache_write,
    },
    contextWindow: m.limit.context,
    maxTokens: m.limit.output,
  };
}

// =============================================================================
// Extension Entry Point
// =============================================================================

export default async function (pi: ExtensionAPI) {
  const hasKey = !!CONFIG_API_KEY;

  // Pi resolves apiKey as an env var name. Ensure OPENCODE_API_KEY is always
  // set — Zen accepts the literal string "public" as a bearer token for
  // free (zero-cost) models when no real key is provided.
  if (!process.env.OPENCODE_API_KEY) {
    process.env.OPENCODE_API_KEY = CONFIG_API_KEY ?? "public";
  }

  let models: ProviderModelConfig[] = [];
  let freeCount = 0;

  try {
    const result = await fetchZenModels();
    // With a key: show all if SHOW_PAID, otherwise just free models
    models = hasKey && SHOW_PAID ? result.all : result.free;
    freeCount = result.free.length;
  } catch (error) {
    console.warn("[zen] Failed to fetch models at startup:", error instanceof Error ? error.message : error);
  }

  if (models.length === 0) return;

  pi.registerProvider("zen", {
    baseUrl: ZEN_GATEWAY_BASE,
    // When no key is set, send "public" as bearer token — Zen accepts this for
    // zero-cost models. When a key is present, Pi reads OPENCODE_API_KEY from env
    // (config file keys are pre-loaded into the env by config.ts).
    apiKey: "OPENCODE_API_KEY",
    api: "openai-completions" as const,
    headers: {
      "X-Title": "Pi",
      "HTTP-Referer": "https://opencode.ai/",
      "User-Agent": "pi-free-providers",
    },
    models,
  });

  // ── Status display ────────────────────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    const theme = ctx.ui.theme;
    if (hasKey) {
      ctx.ui.setStatus("zen-status", theme.fg("accent", `✦ Zen (${models.length} models)`));
    } else {
      ctx.ui.setStatus("zen-status", theme.fg("dim", `✦ Zen (${freeCount} free)`));
    }
  });

  pi.on("model_select", (_event, ctx) => {
    if (_event.model?.provider !== "zen") {
      ctx.ui.setStatus("zen-status", undefined);
    }
  });

  // ── ToS / info notice on first free use ──────────────────────────────────

  let noticeShown = false;
  pi.on("before_agent_start", async (_event, ctx) => {
    if (noticeShown || ctx.model?.provider !== "zen") return;
    noticeShown = true;
    if (hasKey) return;
    return {
      message: {
        customType: "zen",
        content: `Using OpenCode Zen free models. Set OPENCODE_API_KEY for paid access.\nTerms: ${ZEN_TOS_URL}`,
        display: "inline",
      },
    };
  });
}
