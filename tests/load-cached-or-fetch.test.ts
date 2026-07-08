import { beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted mock handles so individual tests can configure return values.
const mocks = vi.hoisted(() => ({
	loadProviderCache: vi.fn(),
	isProviderCacheFresh: vi.fn(),
	saveProviderCacheGuarded: vi.fn(),
}));

vi.mock("../lib/provider-cache.ts", () => ({
	DEFAULT_PROVIDER_CACHE_TTL_MS: 3_600_000,
	isProviderCacheFresh: mocks.isProviderCacheFresh,
	loadProviderCache: mocks.loadProviderCache,
	saveProviderCacheGuarded: mocks.saveProviderCacheGuarded,
	saveProviderCache: vi.fn(),
}));

const cachedModels = [
	{ id: "c1", name: "Cached 1", reasoning: false, input: ["text"] },
] as any;
const fetchedModels = [
	{ id: "f1", name: "Fetched 1", reasoning: false, input: ["text"] },
	{ id: "f2", name: "Fetched 2", reasoning: false, input: ["text"] },
] as any;

describe("loadCachedOrFetchModels", () => {
	beforeEach(() => {
		mocks.loadProviderCache.mockReset();
		mocks.isProviderCacheFresh.mockReset();
		mocks.saveProviderCacheGuarded.mockReset();
	});

	it("returns a fresh cache without calling the fetcher", async () => {
		mocks.loadProviderCache.mockReturnValue(cachedModels);
		mocks.isProviderCacheFresh.mockReturnValue(true);
		const fetcher = vi.fn();
		const { loadCachedOrFetchModels } = await import("../provider-helper.ts");

		const result = await loadCachedOrFetchModels("test", fetcher);

		expect(fetcher).not.toHaveBeenCalled();
		expect(result).toBe(cachedModels);
		expect(mocks.saveProviderCacheGuarded).not.toHaveBeenCalled();
	});

	it("fetches, returns the result, and persists when there is no cache", async () => {
		mocks.loadProviderCache.mockReturnValue(undefined);
		mocks.isProviderCacheFresh.mockReturnValue(false);
		mocks.saveProviderCacheGuarded.mockResolvedValue(true);
		const fetcher = vi.fn().mockResolvedValue(fetchedModels);
		const { loadCachedOrFetchModels } = await import("../provider-helper.ts");

		const result = await loadCachedOrFetchModels("test", fetcher);

		expect(fetcher).toHaveBeenCalledTimes(1);
		expect(result).toBe(fetchedModels);
		expect(mocks.saveProviderCacheGuarded).toHaveBeenCalledWith(
			"test",
			fetchedModels,
		);
	});

	it("falls back to the stale cache when the fetcher throws", async () => {
		mocks.loadProviderCache.mockReturnValue(cachedModels);
		mocks.isProviderCacheFresh.mockReturnValue(false);
		const fetcher = vi.fn().mockRejectedValue(new Error("network down"));
		const { loadCachedOrFetchModels } = await import("../provider-helper.ts");

		const result = await loadCachedOrFetchModels("test", fetcher);

		expect(result).toBe(cachedModels);
		// A failed fetch must not poison the cache.
		expect(mocks.saveProviderCacheGuarded).not.toHaveBeenCalled();
	});

	it("returns an empty list when the fetcher throws and no cache exists", async () => {
		mocks.loadProviderCache.mockReturnValue(undefined);
		mocks.isProviderCacheFresh.mockReturnValue(false);
		const fetcher = vi.fn().mockRejectedValue(new Error("network down"));
		const { loadCachedOrFetchModels } = await import("../provider-helper.ts");

		const result = await loadCachedOrFetchModels("test", fetcher);

		expect(result).toEqual([]);
		expect(mocks.saveProviderCacheGuarded).not.toHaveBeenCalled();
	});

	it("serves the stale cache when a fetch returns an empty list", async () => {
		mocks.loadProviderCache.mockReturnValue(cachedModels);
		mocks.isProviderCacheFresh.mockReturnValue(false);
		const fetcher = vi.fn().mockResolvedValue([]);
		const { loadCachedOrFetchModels } = await import("../provider-helper.ts");

		const result = await loadCachedOrFetchModels("test", fetcher);

		expect(result).toBe(cachedModels);
		// An empty fetch must not be persisted (would wipe the cache).
		expect(mocks.saveProviderCacheGuarded).not.toHaveBeenCalled();
	});
});
