/**
 * Provider usage metrics - tracks rate limits and usage for each provider.
 */

import { OPENROUTER_API_KEY } from "./config.ts";
import { fetchWithRetry, formatError, logWarning } from "./util.ts";
import { BASE_URL_OPENROUTER, DEFAULT_FETCH_TIMEOUT_MS } from "./constants.ts";

// =============================================================================
// Types
// =============================================================================

export interface ProviderMetrics {
  provider: string;
  rateLimit?: {
    requestsPerMinute?: number;
    requestsPerDay?: number;
    remainingToday?: number;
  };
  balance?: number;
  credits?: number;
  lastUpdated: number;
}

// =============================================================================
// OpenRouter metrics
// =============================================================================

interface OpenRouterKeyResponse {
  usage?: {
    "24h": number;
    "7d": number;
    "total": number;
  };
  limit?: {
    "24h": number;
    "7d": number;
    "total": number;
  };
  soft_limit?: boolean;
}

export async function fetchOpenRouterMetrics(): Promise<ProviderMetrics | null> {
  if (!OPENROUTER_API_KEY) return null;

  try {
    const response = await fetchWithRetry(`${BASE_URL_OPENROUTER}/key`, {
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "User-Agent": "pi-free-providers",
      },
      timeoutMs: DEFAULT_FETCH_TIMEOUT_MS,
    });

    if (!response.ok) {
      // 404 or other error - key may be invalid, but not critical
      return null;
    }

    const data = (await response.json()) as OpenRouterKeyResponse;
    
    const limit24h = data.limit?.["24h"];
    const usage24h = data.usage?.["24h"];
    
    return {
      provider: "openrouter",
      rateLimit: {
        requestsPerMinute: 20, // Fixed for free models
        requestsPerDay: limit24h,
        remainingToday: limit24h && usage24h ? limit24h - usage24h : undefined,
      },
      lastUpdated: Date.now(),
    };
  } catch (error) {
    logWarning("openrouter", "Failed to fetch metrics", error);
    return null;
  }
}

// =============================================================================
// Cached metrics storage
// =============================================================================

const metricsCache: Map<string, { data: ProviderMetrics; timestamp: number }> = new Map();
const CACHE_TTL_MS = 60_000; // 1 minute cache

export function getCachedMetrics(provider: string): ProviderMetrics | null {
  const cached = metricsCache.get(provider);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }
  return null;
}

export function setCachedMetrics(provider: string, metrics: ProviderMetrics): void {
  metricsCache.set(provider, { data: metrics, timestamp: Date.now() });
}
