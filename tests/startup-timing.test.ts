import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDir = mkdtempSync(join(tmpdir(), "pi-free-startup-timing-test-"));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("startup-timing", () => {
	beforeEach(() => {
		// Isolate any file logging inside a temp home.
		process.env.HOME = tempDir;
		process.env.USERPROFILE = tempDir;
	});

	afterEach(() => {
		delete process.env.HOME;
		delete process.env.USERPROFILE;
	});

	it("measurePhase records a phase with a non-negative duration", async () => {
		const { beginStartup, measurePhase, getStartupSummary } = await import(
			"../lib/startup-timing.ts"
		);
		beginStartup();

		const result = measurePhase("work", () => {
			let sum = 0;
			for (let i = 0; i < 1000; i++) sum += i;
			return sum;
		});

		expect(result).toBe(499500);
		const summary = getStartupSummary();
		const phase = summary.phases.find((p) => p.name === "work");
		expect(phase).toBeDefined();
		expect(phase?.durationMs).toBeGreaterThanOrEqual(0);
	});

	it("startPhase/endPhase record a named phase and ignore unstarted ends", async () => {
		const { beginStartup, startPhase, endPhase, getStartupSummary } =
			await import("../lib/startup-timing.ts");
		beginStartup();

		// Ending an unstarted phase is a no-op (should not throw).
		endPhase("never-started");

		startPhase("span");
		await sleep(5);
		endPhase("span");

		const summary = getStartupSummary();
		expect(summary.phases.some((p) => p.name === "never-started")).toBe(false);
		const span = summary.phases.find((p) => p.name === "span");
		expect(span).toBeDefined();
		expect(span?.durationMs).toBeGreaterThanOrEqual(0);
	});

	it("timeProvider records success and rethrows failures", async () => {
		const { beginStartup, timeProvider, getStartupSummary } = await import(
			"../lib/startup-timing.ts"
		);
		beginStartup();

		const ok = await timeProvider("good", async () => 42);
		expect(ok).toBe(42);

		await expect(
			timeProvider("bad", async () => {
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");

		const summary = getStartupSummary();
		const good = summary.providers.find((p) => p.provider === "good");
		const bad = summary.providers.find((p) => p.provider === "bad");
		expect(good?.success).toBe(true);
		expect(bad?.success).toBe(false);
		expect(bad?.error).toBe("boom");
		expect(summary.failures).toContain("bad");
	});

	it("sorts providers slowest-first in the summary", async () => {
		const { beginStartup, timeProvider, getStartupSummary } = await import(
			"../lib/startup-timing.ts"
		);
		beginStartup();

		// Use well-separated delays so ordering survives OS timer jitter.
		await Promise.all([
			timeProvider("fast", () => sleep(1)),
			timeProvider("slow", () => sleep(80)),
			timeProvider("medium", () => sleep(30)),
		]);

		const summary = getStartupSummary();
		const order = summary.providers.map((p) => p.provider);
		// The clearly-slowest provider must come first.
		expect(order[0]).toBe("slow");
		// Durations are monotonically non-increasing (slowest-first invariant).
		for (let i = 1; i < summary.providers.length; i++) {
			expect(summary.providers[i - 1].durationMs).toBeGreaterThanOrEqual(
				summary.providers[i].durationMs,
			);
		}
	});

	it("tracks cache hits and network fetch counts", async () => {
		const {
			beginStartup,
			recordCacheHit,
			recordNetworkFetch,
			getStartupSummary,
		} = await import("../lib/startup-timing.ts");
		beginStartup();

		recordCacheHit("a");
		recordCacheHit("b");
		recordNetworkFetch("c", 100);
		recordNetworkFetch("d"); // no duration

		const summary = getStartupSummary();
		expect(summary.cacheHits).toBe(2);
		expect(summary.networkFetches).toBe(2);
		expect(summary.networkMsTotal).toBe(100);
		expect(summary.cacheNetwork).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					provider: "c",
					cacheHits: 0,
					networkFetches: 1,
					networkSuccesses: 1,
					networkFailures: 0,
				}),
				expect.objectContaining({
					provider: "d",
					networkFetches: 1,
				}),
			]),
		);
	});

	it("records session handlers and detached completion after finalize", async () => {
		const {
			beginStartup,
			finalizeStartup,
			recordSessionStartHandler,
			recordDetachedSessionWork,
			getStartupSummary,
			formatStartupSummary,
		} = await import("../lib/startup-timing.ts");
		beginStartup();
		finalizeStartup();
		recordSessionStartHandler("native-refresh", 2, true);
		recordDetachedSessionWork("native-refresh-models", 7, false);

		const summary = getStartupSummary();
		expect(summary.sessionStartHandlers[0]).toMatchObject({
			label: "native-refresh",
			success: true,
		});
		expect(summary.detachedSessionWork[0]).toMatchObject({
			label: "native-refresh-models",
			success: false,
		});
		expect(summary.sessionStartFailures).toEqual(["native-refresh-models"]);
		const text = formatStartupSummary();
		expect(text).toContain("Session_start handlers");
		expect(text).toContain("Detached session_start work");
		expect(text).toContain("native-refresh-models");
	});

	it("finalizeStartup freezes totalMs and formatStartupSummary renders", async () => {
		const {
			beginStartup,
			timeProvider,
			finalizeStartup,
			getStartupSummary,
			formatStartupSummary,
		} = await import("../lib/startup-timing.ts");
		beginStartup();

		await timeProvider("prov", () => sleep(3));
		finalizeStartup();
		const frozen = getStartupSummary().totalMs;
		expect(frozen).toBeGreaterThanOrEqual(0);

		// Total stays stable after finalize even if time passes.
		await sleep(5);
		expect(getStartupSummary().totalMs).toBe(frozen);

		const text = formatStartupSummary();
		expect(text).toContain("Pi-Free Startup:");
		expect(text).toContain("prov");
		expect(text).toContain("Cache:");
	});

	it("beginStartup resets state for a fresh run", async () => {
		const { beginStartup, timeProvider, getStartupSummary } = await import(
			"../lib/startup-timing.ts"
		);
		beginStartup();
		await timeProvider("first", () => sleep(1));
		expect(getStartupSummary().providers).toHaveLength(1);

		beginStartup();
		expect(getStartupSummary().providers).toHaveLength(0);
		expect(getStartupSummary().cacheHits).toBe(0);
	});

	it("totalMs is measured from first module load, not beginStartup", async () => {
		const { beginStartup, getStartupSummary } = await import(
			"../lib/startup-timing.ts"
		);
		beginStartup();

		// The origin is the module-scope timestamp captured at import time,
		// so any elapsed time before beginStartup/finalize is included too.
		await sleep(20);
		const summary = getStartupSummary();
		expect(summary.totalMs).toBeGreaterThanOrEqual(20);
		expect(summary.moduleGraphMs).toBeGreaterThanOrEqual(0);
		expect(summary.moduleGraphMs).toBeLessThanOrEqual(summary.totalMs);
	});

	it("formatStartupSummary states the module-load origin", async () => {
		const { beginStartup, formatStartupSummary } = await import(
			"../lib/startup-timing.ts"
		);
		beginStartup();

		const text = formatStartupSummary();
		expect(text).toContain("first module load");
		expect(text).toContain("module graph");
	});

	it("beginSessionStart keeps startup data but replaces the previous session", async () => {
		const {
			beginStartup,
			beginSessionStart,
			recordSessionStartHandler,
			getStartupSummary,
		} = await import("../lib/startup-timing.ts");
		beginStartup();
		recordSessionStartHandler("old", 1, true);
		beginSessionStart();
		recordSessionStartHandler("new", 2, true);

		expect(getStartupSummary().sessionStartHandlers).toEqual([
			expect.objectContaining({ label: "new" }),
		]);
		expect(getStartupSummary().totalMs).toBeGreaterThanOrEqual(0);
	});

	it("records native refresh outcome counters per provider (M1)", async () => {
		const {
			beginStartup,
			recordNativeAbort,
			recordNativeEmptyRetain,
			recordNativeRefreshOk,
			recordNativeRestored,
			getStartupSummary,
		} = await import("../lib/startup-timing.ts");
		beginStartup();

		recordNativeAbort("prov-a");
		recordNativeAbort("prov-a");
		recordNativeEmptyRetain("prov-a");
		recordNativeRefreshOk("prov-a", 12);
		recordNativeRestored("prov-a", 3 * 60 * 60 * 1000);
		recordNativeRestored("prov-b", 2 * 24 * 60 * 60 * 1000);

		const summary = getStartupSummary();
		const entryA = summary.cacheNetwork.find(
			(entry) => entry.provider === "prov-a",
		);
		expect(entryA).toMatchObject({
			aborts: 2,
			emptyRetains: 1,
			refreshOks: 1,
			restoredCount: 1,
			lastRefreshModelCount: 12,
			storeAgeMs: 3 * 60 * 60 * 1000,
		});
		const entryB = summary.cacheNetwork.find(
			(entry) => entry.provider === "prov-b",
		);
		expect(entryB?.restoredCount).toBe(1);
		expect(entryB?.storeAgeMs).toBe(2 * 24 * 60 * 60 * 1000);
	});

	it("nativeRefreshFlags lists aborts, empty retains, and stale stores (M1)", async () => {
		const {
			beginStartup,
			recordNativeAbort,
			recordNativeEmptyRetain,
			recordNativeRestored,
			nativeRefreshFlags,
			getStartupSummary,
		} = await import("../lib/startup-timing.ts");
		beginStartup();

		recordNativeAbort("ab-prov");
		recordNativeAbort("ab-prov");
		recordNativeEmptyRetain("er-prov");
		recordNativeRestored("old-prov", 8 * 24 * 60 * 60 * 1000); // 8 days > 7d flag

		const flags = nativeRefreshFlags(getStartupSummary());
		expect(flags).toEqual(
			expect.arrayContaining([
				expect.stringContaining("ab-prov: 2 aborts"),
				expect.stringContaining("er-prov: 1 empty-retain"),
				expect.stringContaining("old-prov: store"),
			]),
		);

		// A recent restore does not flag a store age.
		const { beginStartup: reset, recordNativeRestored: record } = await import(
			"../lib/startup-timing.ts"
		);
		reset();
		record("fresh-prov", 60 * 60 * 1000); // 1h
		expect(nativeRefreshFlags(getStartupSummary())).toHaveLength(0);
	});

	it("formatStartupSummary surfaces native refresh outcomes (M1)", async () => {
		const {
			beginStartup,
			recordNativeAbort,
			recordNativeRefreshOk,
			recordNativeRestored,
			formatStartupSummary,
		} = await import("../lib/startup-timing.ts");
		beginStartup();

		recordNativeAbort("ab-prov");
		recordNativeRefreshOk("ok-prov", 7);
		recordNativeRestored("ok-prov", 2 * 60 * 60 * 1000);

		const text = formatStartupSummary();
		expect(text).toContain("Native refresh flags:");
		expect(text).toContain("ab-prov: 1 abort");
		expect(text).toContain("refresh ok 1 (7 models)");
		expect(text).toContain("store 2h old");
	});
});
