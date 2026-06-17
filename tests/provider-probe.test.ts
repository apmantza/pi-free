/**
 * Tests for `createProviderProbe` and the `autoProbeHandler` cache-skip
 * behaviour.
 *
 * The fix for issue #258: auto-probe was firing on every `session_start`,
 * and only then discovering the cache was fresh inside `run()`. Now the
 * handler checks the cache first and short-circuits when every model is
 * already fresh within the TTL window.
 */

import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { existsSync, mkdtempSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";

const tempDir = mkdtempSync(
	join(tmpdir(), "pi-free-provider-probe-test-"),
);

function makeModel(id: string): ProviderModelConfig {
	return {
		id,
		name: `Test ${id}`,
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 8000,
		maxTokens: 1024,
	};
}

describe("createProviderProbe", () => {
	beforeEach(() => {
		// Point HOME at the temp dir so the probe cache lives in a clean
		// location for each test.
		process.env.HOME = tempDir;
		process.env.USERPROFILE = tempDir;
		vi.resetModules();
	});

	afterEach(() => {
		vi.useRealTimers();
		delete process.env.HOME;
		delete process.env.USERPROFILE;
	});

	it("autoProbeHandler does not invoke probeModel when cache is fresh", async () => {
		const { createProviderProbe } = await import(
			"../lib/provider-probe.ts"
		);
		const { recordModelProbeResults } = await import(
			"../lib/probe-cache.ts"
		);

		// Pre-populate the cache so every model is already fresh.
		await recordModelProbeResults("test-provider", [
			{ modelId: "a", status: "ok" },
			{ modelId: "b", status: "ok" },
		]);

		const probeModel = vi.fn(async () => "ok" as const);
		const probe = createProviderProbe({
			providerId: "test-provider",
			probeModel,
		});

		const trigger = probe.autoProbeHandler("test-key", [
			makeModel("a"),
			makeModel("b"),
		]);

		// Fire the handler — should short-circuit.
		trigger();

		// Give any stray async work a chance to run.
		await new Promise((r) => setTimeout(r, 10));

		expect(probeModel).not.toHaveBeenCalled();
	});

	it("autoProbeHandler invokes probeModel when cache is missing", async () => {
		const { createProviderProbe } = await import(
			"../lib/provider-probe.ts"
		);

		const probeModel = vi.fn(async () => "ok" as const);
		const probe = createProviderProbe({
			providerId: "test-provider-empty",
			probeModel,
		});

		const trigger = probe.autoProbeHandler("test-key", [
			makeModel("a"),
			makeModel("b"),
		]);

		trigger();

		// Wait for the async run() to complete.
		await vi.waitFor(() => {
			expect(probeModel).toHaveBeenCalled();
		});

		expect(probeModel).toHaveBeenCalledTimes(2);
	});

	it("autoProbeHandler invokes probeModel when some models are stale", async () => {
		const { createProviderProbe } = await import(
			"../lib/provider-probe.ts"
		);
		const { recordModelProbeResults } = await import(
			"../lib/probe-cache.ts"
		);

		// Mark "a" fresh, leave "b" uncached.
		await recordModelProbeResults("test-provider-stale", [
			{ modelId: "a", status: "ok" },
		]);

		const probeModel = vi.fn(async () => "ok" as const);
		const probe = createProviderProbe({
			providerId: "test-provider-stale",
			probeModel,
		});

		const trigger = probe.autoProbeHandler("test-key", [
			makeModel("a"),
			makeModel("b"),
		]);

		trigger();

		await vi.waitFor(() => {
			expect(probeModel).toHaveBeenCalled();
		});

		// Only the stale model is probed.
		expect(probeModel).toHaveBeenCalledTimes(1);
		expect(probeModel).toHaveBeenCalledWith("test-key", "b");
	});

	it("autoProbeHandler only fires once per process (idempotent)", async () => {
		const { createProviderProbe } = await import(
			"../lib/provider-probe.ts"
		);

		const probeModel = vi.fn(async () => "ok" as const);
		const probe = createProviderProbe({
			providerId: "test-provider-once",
			probeModel,
		});

		const trigger = probe.autoProbeHandler("test-key", [makeModel("a")]);

		trigger();
		trigger();
		trigger();

		await vi.waitFor(() => {
			expect(probeModel).toHaveBeenCalled();
		});

		// Multiple fires of the same trigger collapse to one run().
		expect(probeModel).toHaveBeenCalledTimes(1);
	});

	it("run() respects useCache=false even when cache is fresh", async () => {
		const { createProviderProbe } = await import(
			"../lib/provider-probe.ts"
		);
		const { recordModelProbeResults } = await import(
			"../lib/probe-cache.ts"
		);

		await recordModelProbeResults("test-provider-force", [
			{ modelId: "a", status: "ok" },
		]);

		const probeModel = vi.fn(async () => "ok" as const);
		const probe = createProviderProbe({
			providerId: "test-provider-force",
			probeModel,
		});

		// Direct call with useCache: false should probe anyway
		// (e.g. when invoked by the /probe-{provider} command).
		await probe.run("test-key", [makeModel("a")], { useCache: false });

		expect(probeModel).toHaveBeenCalledTimes(1);
	});
});

describe("areAllModelsFresh", () => {
	beforeEach(() => {
		process.env.HOME = tempDir;
		process.env.USERPROFILE = tempDir;
		vi.resetModules();
	});

	afterEach(() => {
		delete process.env.HOME;
		delete process.env.USERPROFILE;
	});

	it("returns true when all models are fresh in cache", async () => {
		const { areAllModelsFresh, recordModelProbeResults } = await import(
			"../lib/probe-cache.ts"
		);

		await recordModelProbeResults("test-fresh", [
			{ modelId: "a", status: "ok" },
			{ modelId: "b", status: "ok" },
		]);

		expect(areAllModelsFresh("test-fresh", ["a", "b"])).toBe(true);
	});

	it("returns false when a model is missing from cache", async () => {
		const { areAllModelsFresh } = await import(
			"../lib/probe-cache.ts"
		);

		expect(areAllModelsFresh("test-empty-provider", ["a"])).toBe(false);
	});

	it("returns false when a model is cached as broken", async () => {
		const { areAllModelsFresh, recordModelProbeResults } = await import(
			"../lib/probe-cache.ts"
		);

		await recordModelProbeResults("test-broken", [
			{ modelId: "a", status: "broken" },
		]);

		expect(areAllModelsFresh("test-broken", ["a"])).toBe(false);
	});
});
