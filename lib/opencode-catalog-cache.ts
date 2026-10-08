/**
 * Persisted opencode catalog backing synchronous registration at load.
 * Captures/refreshes write it; the next process registers from it before
 * model resolution. A miss is a no-op; the async path self-heals the cache.
 */

import type { Api } from "@earendil-works/pi-ai/compat";
import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { createJSONStore } from "./json-persistence.ts";
import { resolveSafeDataFile } from "./paths.ts";

export interface SyncCacheProviderEntry {
	baseUrl: string;
	api: Api;
	allModels: ProviderModelConfig[];
}

interface SyncCacheFile {
	savedAt: string;
	providers: Record<string, SyncCacheProviderEntry>;
}

function store() {
	return createJSONStore<SyncCacheFile>(
		resolveSafeDataFile(
			process.env.PI_FREE_OPENCODE_CACHE_FILE,
			"opencode-catalog-cache.json",
		),
		{ savedAt: "", providers: {} },
	);
}

/** Load one provider's cached catalog, or undefined on miss/corruption. */
export function loadSyncCacheEntry(
	providerId: string,
): SyncCacheProviderEntry | undefined {
	try {
		const entry = store().load().providers?.[providerId];
		if (
			!entry ||
			!Array.isArray(entry.allModels) ||
			entry.allModels.length === 0
		) {
			return undefined;
		}
		return entry;
	} catch {
		return undefined;
	}
}

/** Persist one provider's catalog. Never throws; caching must not break startup. */
export function persistSyncCacheEntry(
	providerId: string,
	baseUrl: string,
	api: Api,
	allModels: ProviderModelConfig[],
): void {
	try {
		const backing = store();
		const prev = backing.load();
		backing.save({
			savedAt: new Date().toISOString(),
			providers: {
				...prev.providers,
				[providerId]: { baseUrl, api, allModels },
			},
		});
	} catch {
		// Disk failures stay silent; the async capture path still works.
	}
}
