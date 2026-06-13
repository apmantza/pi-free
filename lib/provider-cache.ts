/**
 * Provider Model Cache
 *
 * Caches provider model lists to disk for faster startup and offline use.
 *
 * Flow:
 * 1. On session_start: fetch fresh models from API, save to cache
 * 2. On extension load: register cached models immediately (shows in --list-models)
 * 3. If API fails: use cached models as fallback
 */

import { createJSONStore } from "./json-persistence.ts";
import { createLogger } from "./logger.ts";
import { resolveSafeDataFile } from "./paths.ts";
import type { ProviderModelConfig } from "./types.ts";

const _logger = createLogger("provider-cache");

// =============================================================================
// Types
// =============================================================================

export interface CachedProviderModels {
	/** Provider ID */
	provider: string;
	/** Cached model list */
	models: ProviderModelConfig[];
	/** When these models were fetched */
	fetchedAt: string; // ISO timestamp
}

interface CacheData {
	providers: Record<string, CachedProviderModels>;
}

// =============================================================================
// Cache Store
// =============================================================================

const CACHE_FILE = resolveSafeDataFile(
	process.env.PI_FREE_PROVIDER_CACHE,
	"provider-cache.json",
);

const _cache = createJSONStore<CacheData>(CACHE_FILE, { providers: {} });

export const DEFAULT_PROVIDER_CACHE_TTL_MS = 60 * 60 * 1000;

function getProviderCacheEntry(
	providerId: string,
): CachedProviderModels | undefined {
	try {
		const data = _cache.load();
		const cached = data?.providers?.[providerId];
		if (!cached || !Array.isArray(cached.models)) return undefined;
		return cached;
	} catch (error) {
		_logger.warn(`Failed to load provider cache for ${providerId}`, {
			error: error instanceof Error ? error.message : String(error),
		});
		return undefined;
	}
}

/**
 * Load cached models for a provider.
 * Returns undefined if no cache exists.
 */
export function loadProviderCache(
	providerId: string,
): ProviderModelConfig[] | undefined {
	const cached = getProviderCacheEntry(providerId);

	if (!cached) {
		return undefined;
	}

	_logger.debug(`Loaded cached models for ${providerId}`, {
		count: cached.models.length,
		fetchedAt: cached.fetchedAt,
	});

	return structuredClone(cached.models);
}

/**
 * Return the age of a provider cache entry in milliseconds.
 * Returns undefined if no cache exists or the timestamp is invalid.
 */
function getProviderCacheAgeMs(providerId: string): number | undefined {
	const cached = getProviderCacheEntry(providerId);
	if (!cached) return undefined;

	const fetchedAt = new Date(cached.fetchedAt).getTime();
	if (Number.isNaN(fetchedAt)) return undefined;
	const age = Date.now() - fetchedAt;
	if (age < -5000) return undefined;
	return Math.max(0, age);
}

/**
 * Check whether a provider cache entry is fresh enough to skip network refresh.
 */
export function isProviderCacheFresh(
	providerId: string,
	maxAgeMs: number,
): boolean {
	const age = getProviderCacheAgeMs(providerId);
	return age !== undefined && age <= maxAgeMs;
}

/**
 * Save models to cache for a provider.
 */
export async function saveProviderCache(
	providerId: string,
	models: ProviderModelConfig[],
): Promise<void> {
	await _cache.update((data) => {
		data.providers[providerId] = {
			provider: providerId,
			models: structuredClone(models),
			fetchedAt: new Date().toISOString(),
		};
		return data;
	});

	_logger.debug(`Saved ${models.length} models to cache for ${providerId}`);
}

/**
 * Clear cached models for a provider.
 */
export async function clearProviderCache(providerId: string): Promise<void> {
	await _cache.update((data) => {
		if (data.providers[providerId]) {
			delete data.providers[providerId];
			_logger.debug(`Cleared cache for ${providerId}`);
		}
		return data;
	});
}

/**
 * Clear all provider caches.
 */
export async function clearAllProviderCaches(): Promise<void> {
	await _cache.update(() => {
		_logger.debug("Cleared all provider caches");
		return { providers: {} };
	});
}
