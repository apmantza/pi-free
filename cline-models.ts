/**
 * Cline free model fetching.
 *
 * Reads the list of free model IDs from Cline's GitHub source
 * (OpenRouterModelPicker.tsx) and enriches them with OpenRouter metadata.
 */

import type { ProviderModelConfig } from "./types.ts";
import { getCached, setCached } from "./cache.ts";
import { applyHidden } from "./config.ts";
import { isUsableModel, fetchWithRetry } from "./util.ts";
import { BASE_URL_OPENROUTER, DEFAULT_FETCH_TIMEOUT_MS, CACHE_KEY_CLINE } from "./constants.ts";

const CLINE_FREE_MODELS_SOURCE =
  "https://raw.githubusercontent.com/cline/cline/main/webview-ui/src/components/settings/OpenRouterModelPicker.tsx";

// =============================================================================
// Parse free model IDs from Cline's GitHub source
// =============================================================================

async function fetchClineFreeModelIds(): Promise<string[]> {
  const response = await fetchWithRetry(CLINE_FREE_MODELS_SOURCE, {
    timeoutMs: DEFAULT_FETCH_TIMEOUT_MS,
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch Cline free models list: ${response.status}`);
  }

  const text = await response.text();

  // Extract the freeModels array: export const freeModels = [ ... ]
  const match = text.match(/export\s+const\s+freeModels\s*=\s*\[([\s\S]*?)\]\s*\n/);
  if (!match) throw new Error("Could not find freeModels array in Cline source");

  const ids: string[] = [];
  for (const m of match[1].matchAll(/id:\s*["']([^"']+)["']/g)) {
    ids.push(m[1]);
  }
  return ids;
}

// =============================================================================
// Enrich with OpenRouter metadata
// =============================================================================

interface OpenRouterRaw {
  id: string;
  name: string;
  context_length?: number;
  supported_parameters?: string[];
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  top_provider?: { max_completion_tokens?: number | null };
}

async function fetchOpenRouterIndex(): Promise<Map<string, OpenRouterRaw>> {
  const response = await fetchWithRetry(`${BASE_URL_OPENROUTER}/models`, {
    timeoutMs: DEFAULT_FETCH_TIMEOUT_MS,
  });
  if (!response.ok) return new Map();

  const json = (await response.json()) as { data?: OpenRouterRaw[] };
  const map = new Map<string, OpenRouterRaw>();
  for (const m of json.data ?? []) map.set(m.id, m);
  return map;
}

function extractNameFromId(id: string): string {
  const part = id.split("/")[1] ?? id;
  return part.split(/[-_]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

// =============================================================================
// Public API
// =============================================================================

export async function fetchClineModels(): Promise<ProviderModelConfig[]> {
  const cached = getCached<ProviderModelConfig>(CACHE_KEY_CLINE);
  if (cached) return cached;

  const [ids, orIndex] = await Promise.all([
    fetchClineFreeModelIds(),
    fetchOpenRouterIndex().catch(() => new Map<string, OpenRouterRaw>()),
  ]);

  const models: ProviderModelConfig[] = [];

  for (const id of ids) {
    if (!isUsableModel(id)) continue;
    const info = orIndex.get(id);

    const isReasoning = !!(
      info?.supported_parameters?.includes("include_reasoning") ||
      info?.supported_parameters?.includes("reasoning")
    );

    const hasImage = info?.architecture?.input_modalities?.includes("image") ?? false;

    models.push({
      id,
      name: info ? `${info.name} (Cline)` : `${extractNameFromId(id)} (Cline)`,
      reasoning: isReasoning,
      input: hasImage ? ["text", "image"] : ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: info?.context_length ?? 128_000,
      maxTokens: info?.top_provider?.max_completion_tokens ?? 8_192,
    });
  }

  const result = applyHidden(models);
  setCached(CACHE_KEY_CLINE, result);
  return result;
}
