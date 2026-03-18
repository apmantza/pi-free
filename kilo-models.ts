/**
 * Kilo model fetching and mapping (OpenRouter-compatible format).
 */

import type { ProviderModelConfig } from "@mariozechner/pi-coding-agent";
import { getCached, setCached } from "./cache.ts";
import { applyHidden } from "./config.ts";

const KILO_API_BASE = process.env.KILO_API_URL || "https://api.kilo.ai";
export const KILO_GATEWAY_BASE = `${KILO_API_BASE}/api/gateway`;
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
  const parsed = parseFloat(price);
  if (isNaN(parsed)) return 0;
  // OpenRouter prices are per-token; Pi expects per-million-token
  return parsed * 1_000_000;
}

function isFreeModel(m: OpenRouterModel): boolean {
  const prompt = parseFloat(m.pricing?.prompt ?? "1");
  const completion = parseFloat(m.pricing?.completion ?? "1");
  if (prompt !== 0 || completion !== 0) return false;
  if (m.id.includes(":free")) return true;
  if (!m.id.includes("/")) return true;
  if (m.id.startsWith("kilo/") || m.id.startsWith("openrouter/")) return true;
  return false;
}

function mapOpenRouterModel(m: OpenRouterModel): ProviderModelConfig {
  const inputModalities = m.architecture?.input_modalities ?? ["text"];
  const supportsImages = inputModalities.includes("image");
  const supportsReasoning = m.supported_parameters?.includes("reasoning") ?? false;
  const maxTokens =
    m.top_provider?.max_completion_tokens ??
    m.max_completion_tokens ??
    Math.ceil(m.context_length * 0.2);

  return {
    id: m.id,
    name: m.name,
    reasoning: supportsReasoning,
    input: supportsImages ? ["text", "image"] : ["text"],
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

  const response = await fetch(`${KILO_GATEWAY_BASE}/models`, {
    headers,
    signal: AbortSignal.timeout(MODELS_FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch models: ${response.status} ${response.statusText}`);
  }

  const json = (await response.json()) as { data?: OpenRouterModel[] };
  if (!json.data || !Array.isArray(json.data)) {
    throw new Error("Invalid models response: missing data array");
  }

  const result = json.data
    .filter((m) => {
      const outputMods = m.architecture?.output_modalities ?? [];
      if (outputMods.includes("image")) return false;
      if (options?.freeOnly && !isFreeModel(m)) return false;
      return true;
    })
    .map(mapOpenRouterModel);

  setCached(cacheKey, result);
  return applyHidden(result);
}
