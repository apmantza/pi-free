/**
 * Sync opencode registration from the persisted catalog cache.
 * Hermetic: HOME points at a temp dir (telemetry.test.ts pattern), so the
 * real ~/.pi cache can never leak in; modules are re-imported per test.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let home: string;

const seedModels = [
	{
		id: "muse-spark-1.3-contributor-free",
		name: "Muse Spark 1.3 Free",
		api: "openai-responses",
		baseUrl: "https://opencode.ai/zen/v1",
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1048576,
		maxTokens: 131072,
	},
];

beforeEach(() => {
	home = mkdtempSync(join(tmpdir(), "pi-free-sync-cache-"));
	process.env.HOME = home;
	process.env.USERPROFILE = home;
	vi.resetModules();
});

afterEach(() => {
	delete process.env.HOME;
	delete process.env.USERPROFILE;
	rmSync(home, { recursive: true, force: true });
});

function mockPi() {
	return {
		registerCommand: vi.fn(),
		registerProvider: vi.fn(),
		on: vi.fn(),
	} as unknown as ExtensionAPI;
}

describe("opencode catalog cache", () => {
	it("persists and reloads one provider catalog", async () => {
		const cache = await import("../lib/opencode-catalog-cache.ts");
		expect(cache.loadSyncCacheEntry("opencode-free")).toBeUndefined();
		cache.persistSyncCacheEntry(
			"opencode-free",
			"https://opencode.ai/zen/v1",
			"opencode-dynamic",
			seedModels as never,
		);
		const entry = cache.loadSyncCacheEntry("opencode-free");
		expect(entry?.allModels.map((m) => m.id)).toEqual([
			"muse-spark-1.3-contributor-free",
		]);
		expect(entry?.baseUrl).toBe("https://opencode.ai/zen/v1");
	});

	it("registers opencode-free synchronously at setup without session_start", async () => {
		const cache = await import("../lib/opencode-catalog-cache.ts");
		cache.persistSyncCacheEntry(
			"opencode-free",
			"https://opencode.ai/zen/v1",
			"opencode-dynamic",
			seedModels as never,
		);
		const { setupBuiltInProviderToggles } =
			await import("../lib/built-in-toggle.ts");
		// Mirror extension load order: setup() stages state, the filter pass registers.
		const { applyGlobalFilter } = await import("../lib/registry.ts");
		const pi = mockPi();
		setupBuiltInProviderToggles(pi);
		applyGlobalFilter(true);
		const calls = (pi.registerProvider as ReturnType<typeof vi.fn>).mock
			.calls as Array<[string, { models: Array<{ id: string }> }]>;
		const free = calls.find(([id]) => id === "opencode-free");
		expect(free).toBeDefined();
		expect(free?.[1].models.map((m) => m.id)).toContain(
			"muse-spark-1.3-contributor-free",
		);
		// The session_start handler is registered but never invoked; registration came from sync.
		const onCalls = (pi.on as ReturnType<typeof vi.fn>).mock.calls as Array<
			[string]
		>;
		expect(onCalls.map(([event]) => event)).toContain("session_start");
	});

	// Pre-fix polluted disk caches (classifier entries persisted before the
	// chat filter) heal at load: non-chat entries are filtered, and a cache
	// holding ONLY non-chat entries is treated like a miss (#604).
	it("filters non-chat entries out of a polluted sync cache", async () => {
		const cache = await import("../lib/opencode-catalog-cache.ts");
		cache.persistSyncCacheEntry(
			"opencode-free",
			"https://opencode.ai/zen/v1",
			"opencode-dynamic",
			[
				...seedModels,
				{
					id: "typesafe-cls",
					name: "Typesafe Classifier",
					type: "classifier",
				},
			] as never,
		);
		const { setupBuiltInProviderToggles } =
			await import("../lib/built-in-toggle.ts");
		const { applyGlobalFilter } = await import("../lib/registry.ts");
		const pi = mockPi();
		setupBuiltInProviderToggles(pi);
		// All-view: the free-only filter would mask pollution (both entries
		// are zero-cost), so assert on the unfiltered catalog.
		applyGlobalFilter(false);
		const calls = (pi.registerProvider as ReturnType<typeof vi.fn>).mock
			.calls as Array<[string, { models: Array<{ id: string }> }]>;
		const free = calls.find(([id]) => id === "opencode-free");
		expect(free).toBeDefined();
		expect(free?.[1].models.map((m) => m.id)).toEqual([
			"muse-spark-1.3-contributor-free",
		]);
	});

	it("treats a non-chat-only sync cache like a miss", async () => {
		const cache = await import("../lib/opencode-catalog-cache.ts");
		cache.persistSyncCacheEntry(
			"opencode-free",
			"https://opencode.ai/zen/v1",
			"opencode-dynamic",
			[
				{
					id: "typesafe-cls",
					name: "Typesafe Classifier",
					type: "classifier",
				},
			] as never,
		);
		const { setupBuiltInProviderToggles } =
			await import("../lib/built-in-toggle.ts");
		const { applyGlobalFilter } = await import("../lib/registry.ts");
		const pi = mockPi();
		setupBuiltInProviderToggles(pi);
		applyGlobalFilter(true);
		const ids = (
			(pi.registerProvider as ReturnType<typeof vi.fn>).mock.calls as Array<
				[string]
			>
		).map(([id]) => id);
		expect(ids).not.toContain("opencode-free");
	});

	it("skips sync registration on a cache miss (async path preserved)", async () => {
		const { setupBuiltInProviderToggles } =
			await import("../lib/built-in-toggle.ts");
		const { applyGlobalFilter } = await import("../lib/registry.ts");
		const pi = mockPi();
		setupBuiltInProviderToggles(pi);
		applyGlobalFilter(true);
		const ids = (
			(pi.registerProvider as ReturnType<typeof vi.fn>).mock.calls as Array<
				[string]
			>
		).map(([id]) => id);
		expect(ids).not.toContain("opencode-free");
		expect(ids).not.toContain("opencode-go");
	});
});
