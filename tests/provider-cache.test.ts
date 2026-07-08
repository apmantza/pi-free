import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDir = mkdtempSync(join(tmpdir(), "pi-free-provider-cache-test-"));

describe("provider cache", () => {
	beforeEach(() => {
		if (existsSync(join(tempDir, "provider-cache.json"))) {
			unlinkSync(join(tempDir, "provider-cache.json"));
		}
		// Point HOME at the temp dir so PI_DATA_DIR resolves inside it.
		process.env.HOME = tempDir;
		process.env.USERPROFILE = tempDir;
		delete process.env.PI_FREE_PROVIDER_CACHE;
		vi.resetModules();
	});

	afterEach(() => {
		vi.useRealTimers();
		delete process.env.HOME;
		delete process.env.USERPROFILE;
	});

	it("returns a copy of cached models so callers cannot corrupt the cache", async () => {
		const { saveProviderCache, loadProviderCache } = await import(
			"../lib/provider-cache.ts"
		);
		const model = {
			id: "m1",
			name: "Model 1",
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 4096,
			maxTokens: 2048,
		};
		await saveProviderCache("test", [model as any]);
		const models = loadProviderCache("test")!;
		models.pop();
		const models2 = loadProviderCache("test")!;
		expect(models2).toHaveLength(1);
	});

	it("reports whether a provider cache entry is fresh", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
		const { isProviderCacheFresh, saveProviderCache } = await import(
			"../lib/provider-cache.ts"
		);
		const model = {
			id: "m1",
			name: "Model 1",
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 4096,
			maxTokens: 2048,
		};

		await saveProviderCache("test", [model as any]);
		expect(isProviderCacheFresh("test", 60_000)).toBe(true);

		vi.setSystemTime(new Date("2026-01-01T00:02:00.000Z"));
		expect(isProviderCacheFresh("test", 60_000)).toBe(false);
		expect(isProviderCacheFresh("missing", 60_000)).toBe(false);
	});

	it("treats invalid or future cache timestamps as stale", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
		writeFileSync(
			join(tempDir, "provider-cache.json"),
			JSON.stringify({
				providers: {
					invalid: {
						provider: "invalid",
						models: [],
						fetchedAt: "invalid-date",
					},
					future: {
						provider: "future",
						models: [],
						fetchedAt: "2026-01-01T00:01:00.000Z",
					},
				},
			}),
		);
		const { isProviderCacheFresh } = await import("../lib/provider-cache.ts");
		expect(isProviderCacheFresh("invalid", 60_000)).toBe(false);
		expect(isProviderCacheFresh("future", 60_000)).toBe(false);
	});

	it("saveProviderCacheGuarded refuses to overwrite a healthy cache with a drastic shrink", async () => {
		const { saveProviderCache, saveProviderCacheGuarded, loadProviderCache } =
			await import("../lib/provider-cache.ts");
		const makeModels = (n: number) =>
			Array.from({ length: n }, (_, i) => ({
				id: `m${i}`,
				name: `M${i}`,
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 4096,
				maxTokens: 2048,
			}));

		// Seed a healthy 100-model cache.
		await saveProviderCache("guarded", makeModels(100) as any);

		// A <50% shrink (10 models) must NOT overwrite the cache.
		const kept = await saveProviderCacheGuarded("guarded", makeModels(10) as any);
		expect(kept).toBe(false);
		expect(loadProviderCache("guarded")).toHaveLength(100);

		// A healthy result (80 models, >50%) DOES overwrite.
		const written = await saveProviderCacheGuarded(
			"guarded",
			makeModels(80) as any,
		);
		expect(written).toBe(true);
		expect(loadProviderCache("guarded")).toHaveLength(80);
	});

	it("saveProviderCacheGuarded never caches an empty list", async () => {
		const { saveProviderCache, saveProviderCacheGuarded, loadProviderCache } =
			await import("../lib/provider-cache.ts");
		await saveProviderCache("empty-guard", [
			{
				id: "m0",
				name: "M0",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 4096,
				maxTokens: 2048,
			},
		] as any);
		const written = await saveProviderCacheGuarded("empty-guard", [] as any);
		expect(written).toBe(false);
		expect(loadProviderCache("empty-guard")).toHaveLength(1);
	});
});
