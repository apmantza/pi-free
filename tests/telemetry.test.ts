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

	it("classifyError derives classes from status codes and messages (M2)", async () => {
		const { classifyError } = await import("../lib/telemetry.ts");

		expect(classifyError(undefined, 401)).toBe("401");
		expect(classifyError(undefined, 403)).toBe("403");
		expect(classifyError(undefined, 429)).toBe("429");
		expect(classifyError(undefined, 503)).toBe("5xx");
		expect(classifyError(undefined, 599)).toBe("5xx");
		// Non-failure status with no message carries no class.
		expect(classifyError(undefined, 200)).toBeUndefined();
		// Embedded numeric statuses in gateway error messages.
		expect(classifyError("Request failed with 403 Forbidden", 200)).toBe("403");
		expect(classifyError("invalid workos token: 401 Unauthorized")).toBe("401");
		expect(classifyError("too many requests: 429")).toBe("429");
		expect(classifyError("gateway 502 bad gateway")).toBe("5xx");
		// Network fingerprints.
		expect(classifyError("fetch failed")).toBe("network");
		expect(classifyError("TypeError: Failed to fetch")).toBe("network");
		expect(classifyError("connect ECONNREFUSED 1.2.3.4:443")).toBe("network");
		// Anything else.
		expect(classifyError("model exploded")).toBe("other");
		expect(classifyError(undefined, undefined)).toBeUndefined();
	});

	it("stores statusCode and errorClass on failed entries (M2)", async () => {
		const { recordModelCall, getModelTelemetry } = await import(
			"../lib/telemetry.ts"
		);
		const usage = { input: 1, output: 1, totalTokens: 2 };

		await recordModelCall(undefined, "p", "m", usage, 0, {
			success: false,
			errorMessage: "gateway returned 401",
		});
		await recordModelCall(undefined, "p", "m", usage, 0, {
			success: false,
			errorMessage: "rate limited",
			statusCode: 429,
		});
		await recordModelCall(undefined, "p", "m", usage, 0, {
			success: true,
		});

		const t = getModelTelemetry("p", "m");
		expect(t?.recentCalls[0]?.errorClass).toBe("401");
		expect(t?.recentCalls[0]?.statusCode).toBeUndefined();
		expect(t?.recentCalls[1]?.errorClass).toBe("429");
		expect(t?.recentCalls[1]?.statusCode).toBe(429);
		// Successful calls carry no error class.
		expect(t?.recentCalls[2]?.errorClass).toBeUndefined();
		// The free-form message is preserved for existing consumers.
		expect(t?.recentCalls[0]?.error).toBe("gateway returned 401");
	});

	it("aggregates provider error counts for health/telemetry output (M2)", async () => {
		const { recordModelCall, getProviderErrorCounts } = await import(
			"../lib/telemetry.ts"
		);
		const usage = { input: 1, output: 1, totalTokens: 2 };

		await recordModelCall(undefined, "auth-prov", "m", usage, 0, {
			success: false,
			errorMessage: "401 unauthorized",
		});
		await recordModelCall(undefined, "auth-prov", "m", usage, 0, {
			success: false,
			errorMessage: "403 forbidden",
		});
		await recordModelCall(undefined, "auth-prov", "m", usage, 0, {
			success: false,
			errorMessage: "too many 429",
		});
		await recordModelCall(undefined, "net-prov", "m", usage, 0, {
			success: false,
			errorMessage: "fetch failed",
		});

		const counts = getProviderErrorCounts();
		expect(counts.get("auth-prov")).toMatchObject({
			"401": 1,
			"403": 1,
			"429": 1,
			authFailures: 2,
		});
		expect(counts.get("net-prov")?.network).toBe(1);
	});
});
