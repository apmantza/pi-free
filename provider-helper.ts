/**
 * Shared provider helpers for pi-free.
 * Native providers use lib/native-provider.ts; this module keeps the shared
 * model-store types, CI name enhancement, and the legacy cache-first fetcher.
 */

import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { STARTUP_FETCH_DEADLINE_MS } from "./constants.ts";
import {
	DEFAULT_PROVIDER_CACHE_TTL_MS,
	isProviderCacheFresh,
	loadProviderCache,
	saveProviderCacheGuarded,
} from "./lib/provider-cache.ts";
import { createLogger } from "./lib/logger.ts";
import type { ModelsDevEnrichedMetadata } from "./lib/types.ts";
import { withFetchDeadline } from "./lib/util.ts";
import { recordNetworkFetch } from "./lib/startup-timing.ts";
import { enhanceModelNameWithCodingIndex } from "./provider-failover/benchmark-lookup.ts";

const _logger = createLogger("provider-helper");

/** Tracks consecutive persistence failures per provider for escalation logging. */
const _persistFailCount = new Map<string, number>();

interface ContextWithOAuthStatus {
	model?: unknown;
	modelRegistry?: {
		isUsingOAuth?: (model: unknown) => boolean;
	};
}

/**
 * Check OAuth status through Pi's ModelRegistry compatibility facade.
 * Newer Pi versions no longer expose authStorage on the context.
 */
export function isCurrentModelOAuth(ctx: unknown): boolean {
	if (!ctx || typeof ctx !== "object") return false;
	const context = ctx as ContextWithOAuthStatus;
	return Boolean(
		context.model && context.modelRegistry?.isUsingOAuth?.(context.model),
	);
}

export function isOAuthCredential(
	credential: unknown,
): credential is { type: "oauth"; access: string } {
	if (!credential || typeof credential !== "object") return false;
	const candidate = credential as { type?: unknown; access?: unknown };
	return candidate.type === "oauth" && typeof candidate.access === "string";
}

// =============================================================================
// Types
// =============================================================================

export interface StoredModels {
	free: ProviderModelConfig[];
	all: ProviderModelConfig[];
}

// =============================================================================
// Provider Registration Helpers
// =============================================================================

export interface OpenAICompatibleConfig {
	/** Provider identifier (e.g., "nvidia", "modal") */
	providerId: string;
	/** Base URL for the API */
	baseUrl: string;
	/** Environment variable name for the API key */
	apiKey: string;
	/**
	 * Wire API to use. Defaults to `"openai-completions"` for backward
	 * compatibility with the 17 existing providers that pass through
	 * this helper without setting it. Set to `"anthropic-messages"`
	 * for Anthropic-protocol gateways (e.g. OpenModel). The pi-ai
	 * runtime dispatches to the right client based on this value.
	 */
	api?: "openai-completions" | "anthropic-messages";
	/** Additional headers to include */
	headers?: Record<string, string>;
	/** OAuth configuration (optional) */
	oauth?: {
		name: string;
		login: (callbacks: unknown) => Promise<unknown>;
		refreshToken?: (cred: unknown) => Promise<unknown>;
		getApiKey?: (cred: unknown) => string;
	};
}

/**
 * Enhance all model names with Coding Index scores
 * Use this for direct provider registration (not through setupProvider)
 */
export function enhanceWithCI(
	models: Array<ProviderModelConfig & ModelsDevEnrichedMetadata>,
	providerId?: string,
): ProviderModelConfig[] {
	return models.map((m) => ({
		...m,
		name: enhanceModelNameWithCodingIndex(m.name, m.id, providerId, m.modelsDev),
	}));
}

/**
 * Cache-first model loader for network-fetching providers.
 *
 * - If a fresh, non-empty disk cache exists, return it immediately (no network).
 * - Otherwise fetch; persist the result unless it looks like a degenerate /
 *   transiently-shrunk response (poisoning guard), so a flaky API can't wipe a
 *   good cached list for the TTL window.
 * - On fetch error, fall back to a stale cache entry if one exists.
 */
export async function loadCachedOrFetchModels(
	providerId: string,
	fetcher: () => Promise<ProviderModelConfig[]>,
	options?: { ttlMs?: number; fetchTimeoutMs?: number },
): Promise<ProviderModelConfig[]> {
	const ttlMs = options?.ttlMs ?? DEFAULT_PROVIDER_CACHE_TTL_MS;
	const cached = loadProviderCache(providerId);

	if (cached && cached.length > 0 && isProviderCacheFresh(providerId, ttlMs)) {
		return cached;
	}

	// Bound the network wait so an unresponsive provider API cannot stall Pi
	// session start (the factory awaits this). On timeout the rejection flows
	// into the same fallback as a fetch error: serve the stale cache, or an
	// empty list on a true cold start, and refresh on a later session_start.
	const deadlineMs = options?.fetchTimeoutMs ?? STARTUP_FETCH_DEADLINE_MS;

	let fetched: ProviderModelConfig[] = [];
	const fetchStarted = performance.now();
	try {
		fetched = await withFetchDeadline(fetcher(), deadlineMs, providerId);
		recordNetworkFetch(providerId, performance.now() - fetchStarted, true);
	} catch (err) {
		// Record the attempted wait even when the deadline or provider rejects.
		recordNetworkFetch(providerId, performance.now() - fetchStarted, false);
		// Network/discovery failure: keep serving whatever cache we have so the
		// provider still registers models instead of going empty.
		if (cached && cached.length > 0) {
			_logger.info(
				`[${providerId}] fetch failed; serving ${cached.length} cached models`,
				{ error: err instanceof Error ? err.message : String(err) },
			);
			return cached;
		}
		_logger.warn(
			`[${providerId}] registered with 0 models — fetch failed and no cache available`,
			{ error: err instanceof Error ? err.message : String(err) },
		);
		return [];
	}

	// Persist the fresh list unless it looks like a degenerate /
	// transiently-shrunk response (poisoning guard, centralized in provider-cache),
	// so a flaky API can't wipe a good cached list for the TTL window.
	if (fetched.length > 0) {
		saveProviderCacheGuarded(providerId, fetched)
			.then(() => {
				_persistFailCount.delete(providerId);
			})
			.catch((err) => {
				const count = (_persistFailCount.get(providerId) ?? 0) + 1;
				_persistFailCount.set(providerId, count);
				const logData = {
					error: err instanceof Error ? err.message : String(err),
					consecutiveFailures: count,
				};
				if (count >= 3) {
					_logger.error(
						`[${providerId}] failed to persist provider cache (${count} consecutive failures)`,
						logData,
					);
				} else {
					_logger.warn(`[${providerId}] failed to persist provider cache`, logData);
				}
			});
	} else if (cached && cached.length > 0) {
		// Empty fetch but we have a cache: keep serving cache.
		return cached;
	}

	return fetched;
}
