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
});
