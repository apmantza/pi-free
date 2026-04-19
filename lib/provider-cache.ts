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

import { homedir } from "node:os";
import { join } from "node:path";
import { createJSONStore } from "./json-persistence.ts";
import { createLogger } from "./logger.ts";
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

const CACHE_FILE = join(homedir(), ".pi", "provider-cache.json");

const _cache = createJSONStore<CacheData>(CACHE_FILE, { providers: {} });

/**
 * Load cached models for a provider.
 * Returns undefined if no cache exists.
 */
export function loadProviderCache(
	providerId: string,
): ProviderModelConfig[] | undefined {
	const data = _cache.load();
	const cached = data.providers[providerId];

	if (!cached) {
		return undefined;
	}

	_logger.debug(`Loaded cached models for ${providerId}`, {
		count: cached.models.length,
		fetchedAt: cached.fetchedAt,
	});

	return cached.models;
}

/**
 * Save models to cache for a provider.
 */
export function saveProviderCache(
	providerId: string,
	models: ProviderModelConfig[],
): void {
	const data = _cache.load();

	data.providers[providerId] = {
		provider: providerId,
		models,
		fetchedAt: new Date().toISOString(),
	};

	_cache.save(data);

	_logger.debug(`Saved ${models.length} models to cache for ${providerId}`);
}

/**
 * Clear cached models for a provider.
 */
export function clearProviderCache(providerId: string): void {
	const data = _cache.load();

	if (data.providers[providerId]) {
		delete data.providers[providerId];
		_cache.save(data);
		_logger.debug(`Cleared cache for ${providerId}`);
	}
}

/**
 * Clear all provider caches.
 */
export function clearAllProviderCaches(): void {
	_cache.save({ providers: {} });
	_logger.debug("Cleared all provider caches");
}
