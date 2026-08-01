import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDir = mkdtempSync(join(tmpdir(), "pi-free-telemetry-test-"));

describe("telemetry", () => {
	beforeEach(() => {
		if (existsSync(join(tempDir, "free-telemetry.json"))) {
			unlinkSync(join(tempDir, "free-telemetry.json"));
		}
		// Point HOME at the temp dir so PI_DATA_DIR resolves inside it,
		// then leave PI_FREE_TELEMETRY_FILE unset (default basename is used).
		process.env.HOME = tempDir;
		process.env.USERPROFILE = tempDir;
		delete process.env.PI_FREE_TELEMETRY_FILE;
		vi.resetModules();
	});

	afterEach(() => {
		delete process.env.HOME;
		delete process.env.USERPROFILE;
	});

	it("records concurrent model calls without losing entries", async () => {
		const { recordModelCall, getModelTelemetry } = await import(
			"../lib/telemetry.ts"
		);
		const usage = { input: 1, output: 2, totalTokens: 3 };
		const opts = { success: true };
		await Promise.all([
			recordModelCall(undefined, "p", "m", usage, 0, opts),
			recordModelCall(undefined, "p", "m", usage, 0, opts),
			recordModelCall(undefined, "p", "m", usage, 0, opts),
		]);
		const t = getModelTelemetry("p", "m");
		expect(t?.totalCalls).toBe(3);
	});

	it("pairs start and record via call id with correct latency", async () => {
		const { startModelCall, recordModelCall, getModelTelemetry } = await import(
			"../lib/telemetry.ts"
		);

		const callId = startModelCall("prov", "mdl");
		expect(typeof callId).toBe("string");

		const usage = { input: 10, output: 20, totalTokens: 30 };
		await recordModelCall(callId, "prov", "mdl", usage, 0, {
			success: true,
		});

		const t = getModelTelemetry("prov", "mdl");
		expect(t?.totalCalls).toBe(1);
		// Latency should be >= 0 (near-instant in test)
		expect(t?.recentCalls[0]?.latencyMs).toBeGreaterThanOrEqual(0);
	});

	it("records 0 latency when no matching startModelCall exists", async () => {
		const { recordModelCall, getModelTelemetry } = await import(
			"../lib/telemetry.ts"
		);
		const usage = { input: 5, output: 5, totalTokens: 10 };
		await recordModelCall(undefined, "x", "y", usage, 0, {
			success: true,
		});

		const t = getModelTelemetry("x", "y");
		expect(t?.recentCalls[0]?.latencyMs).toBe(0);
	});

	it("discards implausibly long latency samples", async () => {
		const { startModelCall, recordModelCall, getModelTelemetry } = await import(
			"../lib/telemetry.ts"
		);

		// Latency is measured with the monotonic performance.now() clock, so
		// simulate a 15-min gap by mocking performance.now for the record call.
		const startPerf = performance.now();
		const callId = startModelCall("slow", "model"); // captures real start
		vi.spyOn(performance, "now").mockReturnValue(
			startPerf + 15 * 60 * 1000, // 15 min later > MAX_SANE_LATENCY_MS
		);

		const usage = { input: 1, output: 1, totalTokens: 2 };
		await recordModelCall(callId, "slow", "model", usage, 0, {
			success: true,
		});

		vi.restoreAllMocks();

		const t = getModelTelemetry("slow", "model");
		// Latency should be clamped to 0 (discarded as implausible)
		expect(t?.recentCalls[0]?.latencyMs).toBe(0);
		expect(t?.recentCalls[0]?.tokensPerSecond).toBe(0);
	});
});
