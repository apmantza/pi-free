/**
 * Groq Provider Extension
 *
 * Provides access to fast inference models via api.groq.com.
 * Free tier with generous rate limits — requires GROQ_API_KEY.
 * Get a free key at: https://console.groq.com/keys
 */

import type { ExtensionAPI, ProviderModelConfig } from "@mariozechner/pi-coding-agent";
import { GROQ_API_KEY as CONFIG_API_KEY, applyHidden, PROVIDER_GROQ } from "./config.ts";
import { getCached, setCached } from "./cache.ts";
import { fetchWithRetry, logWarning } from "./util.ts";
import { BASE_URL_GROQ, DEFAULT_FETCH_TIMEOUT_MS } from "./constants.ts";
import { setupProvider, type StoredModels } from "./provider-helper.ts";

// =============================================================================

// Fetch
// =============================================================================

interface GroqModel {
  id: string;
  active: boolean;
  context_window: number;
}

async function fetchGroqModels(apiKey: string): Promise<ProviderModelConfig[]> {
  const cached = getCached<ProviderModelConfig>(PROVIDER_GROQ);
  if (cached) return cached;

  const response = await fetchWithRetry(`${BASE_URL_GROQ}/models`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "User-Agent": "pi-free-providers",
    },
    timeoutMs: DEFAULT_FETCH_TIMEOUT_MS,
  });

  if (!response.ok) {
    throw new Error(`Groq /models returned ${response.status} ${response.statusText}`);
  }

  const json = (await response.json()) as { data?: GroqModel[] };
  const models = json.data ?? [];

  // Filter out non-chat models (embed, guard, tts, stt, etc.)
  const SKIP = [/embed/i, /guard/i, /prompt-guard/i, /whisper/i, /tts/i, /playai/i, /distil/i, /llama-3\.1-8b/i];

  const result = applyHidden(
    models
      .filter((m) => m.active)
      .filter((m) => !SKIP.some((p) => p.test(m.id)))
      .map(
        (m): ProviderModelConfig => ({
          id: m.id,
          name: m.id.split("/").pop() ?? m.id,
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0 },
          contextWindow: m.context_window ?? 128_000,
          maxTokens: Math.min(m.context_window ?? 16_384, 16_384),
        }),
      ),
  );

  setCached(PROVIDER_GROQ, result);
  return result;
}

// =============================================================================

// Extension Entry Point
// =============================================================================

export default async function (pi: ExtensionAPI) {
  const apiKey = CONFIG_API_KEY;
  if (apiKey) process.env.GROQ_API_KEY = apiKey;

  if (!apiKey) {
    logWarning("groq", "No API key found — set GROQ_API_KEY or add groq_api_key to ~/.pi/free.json. Free key at https://console.groq.com/keys");
    return;
  }

  let models: ProviderModelConfig[] = [];
  try {
    models = await fetchGroqModels(apiKey);
  } catch (error) {
    logWarning("groq", "Failed to fetch models", error);
  }

  if (models.length === 0) return;

  const stored: StoredModels = { free: models, all: models };

  pi.registerProvider(PROVIDER_GROQ, {
    baseUrl: BASE_URL_GROQ,
    apiKey: "GROQ_API_KEY",
    api: "openai-completions" as const,
    headers: {
      "User-Agent": "pi-free-providers",
    },
    models,
  });

  setupProvider(pi, {
    providerId: PROVIDER_GROQ,
    reRegister: (m) => {
      stored.free = m;
      stored.all = m;
      pi.registerProvider(PROVIDER_GROQ, {
        baseUrl: BASE_URL_GROQ,
        apiKey: "GROQ_API_KEY",
        api: "openai-completions" as const,
        headers: { "User-Agent": "pi-free-providers" },
        models: m,
      });
    },
  }, stored);

  pi.on("session_start", async (_event, ctx) => {
    const theme = ctx.ui.theme;
    ctx.ui.setStatus("groq-status", theme.fg("accent", `⚡ Groq (${models.length} models)`));
  });
}
