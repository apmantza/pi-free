/**
 * Shared utilities for pi-free-providers.
 */

import type { ProviderModelConfig } from "./types.ts";
import { DEFAULT_FETCH_TIMEOUT_MS } from "./constants.ts";

// =============================================================================
// Price parsing (OpenRouter format: per-token, convert to per-million-token)
// =============================================================================

/**
 * Parse price string to Pi's per-million-token format.
 * OpenRouter prices are per-token; Pi expects per-million-token.
 */
export function parsePrice(price: string | null | undefined): number {
  if (!price) return 0;
  const parsed = parseFloat(price);
  if (isNaN(parsed)) return 0;
  return parsed * 1_000_000;
}

// =============================================================================
// Error handling
// =============================================================================

/**
 * Format error for consistent logging across all providers.
 */
export function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Log a warning with consistent prefix and error formatting.
 */
export function logWarning(prefix: string, message: string, error?: unknown): void {
  const fullMessage = error ? `${message}: ${formatError(error)}` : message;
  console.warn(`[${prefix}] ${fullMessage}`);
}

// =============================================================================
// Model mapping helpers
// =============================================================================

/**
 * Common model mapping logic shared across providers.
 */
export function mapOpenRouterModel(m: {
  id: string;
  name: string;
  context_length: number;
  max_completion_tokens?: number | null;
  pricing?: { prompt?: string | null; completion?: string | null; input_cache_read?: string | null; input_cache_write?: string | null };
  architecture?: { input_modalities?: string[] | null; output_modalities?: string[] | null };
  top_provider?: { max_completion_tokens?: number | null };
  supported_parameters?: string[];
}): ProviderModelConfig {
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

/**
 * Check if a model is free (price = 0).
 */
export function isFreeModel(m: { pricing?: { prompt?: string | null; completion?: string | null } }): boolean {
  const prompt = parseFloat(m.pricing?.prompt ?? "1");
  const completion = parseFloat(m.pricing?.completion ?? "1");
  return prompt === 0 && completion === 0;
}

// =============================================================================
// Fetch with retry
// =============================================================================

/**
 * Fetch with simple exponential backoff retry.
 * Only retries on network errors or 5xx responses — not 4xx.
 */
export async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 2,
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  let lastError: Error = new Error("fetch failed");

  const fetchOptions: RequestInit = {
    ...options,
    signal: AbortSignal.timeout(timeoutMs),
  };

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, fetchOptions);
      if (response.ok || response.status < 500) return response;
      lastError = new Error(`HTTP ${response.status} ${response.statusText}`);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }

    if (attempt < maxRetries) {
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }

  throw lastError;
}

// =============================================================================
// Model filtering helpers
// =============================================================================

const SKIP_PATTERNS = [
  /gemma-3n/i,
  /-mini:/i,
  /-a\d+b$/i,
  /embed/i,
  /whisper/i,
  /\bocr\b/i,
  /flux/i,
  /parakeet/i,
  /retriev/i,
  /cosmos/i,
  /\/phi-/i,
];

/**
 * Returns true if the model is worth showing.
 * @param id Model ID string
 * @param minSizeB Minimum parameter count in billions (default 30)
 */
export function isUsableModel(id: string, minSizeB = 30): boolean {
  if (SKIP_PATTERNS.some((p) => p.test(id))) return false;
  const m = id.match(/[_-](?:e)?(\d+(?:\.\d+)?)b[_:-]/i);
  if (m && parseFloat(m[1]) <= minSizeB) return false;
  return true;
}
