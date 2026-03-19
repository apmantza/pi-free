/**
 * Kilo model fetching and mapping (OpenRouter-compatible format).
 */

import type { ProviderModelConfig } from "./types.ts";
import { getCached, setCached } from "./cache.ts";
import { applyHidden, PROVIDER_KILO } from "./config.ts";
import { isUsableModel, mapOpenRouterModel, fetchWithRetry, parsePrice } from "./util.ts";
import { BASE_URL_KILO, DEFAULT_FETCH_TIMEOUT_MS } from "./constants.ts";

const KILO_API_BASE = process.env.KILO_API_URL || "https://api.kilo.ai";
export const KILO_GATEWAY_BASE = `${KILO_API_BASE}/api/gateway`;

// =============================================================================
// Fetch
// =============================================================================

export async function fetchKiloModels(options?: {
  token?: string;
  freeOnly?: boolean;
}): Promise<ProviderModelConfig[]> {
  const cacheKey = options?.freeOnly ? "kilo-free" : "kilo-all";
  const cached = getCached<ProviderModelConfig>(cacheKey);
  if (cached) return cached;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "pi-free-providers",
  };
  if (options?.token) headers.Authorization = `Bearer ${options.token}`;

  const response = await fetchWithRetry(`${KILO_GATEWAY_BASE}/models`, {
    headers,
    signal: AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch models: ${response.status} ${response.statusText}`);
  }

  const json = (await response.json()) as { data?: { id: string; name: string; context_length: number; max_completion_tokens?: number | null; pricing?: { prompt?: string | null; completion?: string | null; input_cache_read?: string | null; input_cache_write?: string | null }; architecture?: { input_modalities?: string[] | null; output_modalities?: string[] | null }; top_provider?: { max_completion_tokens?: number | null }; supported_parameters?: string[] }[] };
  if (!json.data || !Array.isArray(json.data)) {
    throw new Error("Invalid models response: missing data array");
  }

  const result = json.data
    .filter((m) => {
      const outputMods = m.architecture?.output_modalities ?? [];
      if (outputMods.includes("image")) return false;
      if (options?.freeOnly) {
        const prompt = parseFloat(m.pricing?.prompt ?? "1");
        const completion = parseFloat(m.pricing?.completion ?? "1");
        if (prompt !== 0 || completion !== 0) return false;
      }
      if (!isUsableModel(m.id)) return false;
      return true;
    })
    .map(mapOpenRouterModel);

  setCached(cacheKey, result);
  return applyHidden(result);
}
