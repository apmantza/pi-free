import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { PiAiResolutionSnapshot } from "../lib/pi-ai-loader.ts";

const tempDir = mkdtempSync(join(tmpdir(), "pi-free-telemetry-test-"));

/** Where telemetry actually lands: PI_DATA_DIR is `<home>/.pi`. */
const telemetryFile = () => join(tempDir, ".pi", "free-telemetry.json");

function removeTelemetryFile(): void {
	if (existsSync(telemetryFile())) unlinkSync(telemetryFile());
}

/**
 * A #581-shaped snapshot: the bare-specifier copy resolves but cannot serve
 * `./compat`, and the load recovered from another copy on disk. A plain typed
 * value is deliberate — the subject under test here is persistence, not
 * resolution (the loader's own tests run the real probes).
 */
function shadowedSnapshot(): PiAiResolutionSnapshot {
	return {
		fastPath: {
			root: "/home/u/node_modules/@earendil-works/pi-ai",
			version: "0.84.2",
			defines: { compat: false, "providers/all": false },
		},
		entries: {
			compat: {
				root: "/usr/lib/node_modules/@earendil-works/pi-ai",
				version: "0.87.1",
				file: "/usr/lib/node_modules/@earendil-works/pi-ai/dist/compat.js",
				source: "on-disk",
				via: "host-entry/direct",
				probes: [],
			},
			"providers/all": {
				root: "/usr/lib/node_modules/@earendil-works/pi-ai",
				version: "0.87.1",
				file: "/usr/lib/node_modules/@earendil-works/pi-ai/dist/providers/all.js",
				source: "on-disk",
				via: "host-entry/direct",
				probes: [],
			},
		},
		events: [
			{
				at: "2026-09-26T00:00:00.000Z",
				entry: "compat",
				code: "ERR_PACKAGE_PATH_NOT_EXPORTED",
				fastPathRoot: "/home/u/node_modules/@earendil-works/pi-ai",
				recovered: "on-disk",
				resolvedRoot: "/usr/lib/node_modules/@earendil-works/pi-ai",
				resolvedFile:
					"/usr/lib/node_modules/@earendil-works/pi-ai/dist/compat.js",
			},
		],
		vendored: false,
		shadowed: true,
	};
}

describe("telemetry", () => {
	beforeEach(() => {
		removeTelemetryFile();
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
		const { recordModelCall, getModelTelemetry } =
			await import("../lib/telemetry.ts");
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
		const { startModelCall, recordModelCall, getModelTelemetry } =
			await import("../lib/telemetry.ts");

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
		const { recordModelCall, getModelTelemetry } =
			await import("../lib/telemetry.ts");
		const usage = { input: 5, output: 5, totalTokens: 10 };
		await recordModelCall(undefined, "x", "y", usage, 0, {
			success: true,
		});

		const t = getModelTelemetry("x", "y");
		expect(t?.recentCalls[0]?.latencyMs).toBe(0);
	});

	it("discards implausibly long latency samples", async () => {
		const { startModelCall, recordModelCall, getModelTelemetry } =
			await import("../lib/telemetry.ts");

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
		const { recordModelCall, getModelTelemetry } =
			await import("../lib/telemetry.ts");
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
		const { recordModelCall, getProviderErrorCounts } =
			await import("../lib/telemetry.ts");
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

	describe("pi-ai diagnostics (#585)", () => {
		it("persists one record and reads it back", async () => {
			const { recordPiAiDiagnostics, getPiAiDiagnostics } =
				await import("../lib/telemetry.ts");
			await recordPiAiDiagnostics(shadowedSnapshot());

			const record = getPiAiDiagnostics();
			expect(record?.shadowed).toBe(true);
			expect(record?.fastPathVersion).toBe("0.84.2");
			expect(record?.entries.compat?.source).toBe("on-disk");
			expect(record?.entries.compat?.via).toBe("host-entry/direct");
			expect(record?.events).toHaveLength(1);
			expect(record?.events[0]?.code).toBe("ERR_PACKAGE_PATH_NOT_EXPORTED");

			// Durability, not just the in-memory cache: the point of the record is
			// that it survives the process that hit the problem.
			const onDisk = JSON.parse(readFileSync(telemetryFile(), "utf-8"));
			expect(onDisk.diagnostics.piAi.shadowed).toBe(true);
		});

		it("overwrites rather than appends (one record per session)", async () => {
			const { recordPiAiDiagnostics, getPiAiDiagnostics } =
				await import("../lib/telemetry.ts");
			const first = shadowedSnapshot();
			await recordPiAiDiagnostics(first);
			const second = { ...shadowedSnapshot(), shadowed: false, events: [] };
			await recordPiAiDiagnostics(second);

			const record = getPiAiDiagnostics();
			expect(record?.shadowed).toBe(false);
			expect(record?.events).toEqual([]);
			// Still one record: a reload storm must not grow the file.
			const onDisk = JSON.parse(readFileSync(telemetryFile(), "utf-8"));
			expect(Object.keys(onDisk.diagnostics)).toEqual(["piAi"]);
		});

		it("keeps model data for a file written before diagnostics existed", async () => {
			// The old-record parse proof: a v2.8.3 file has no `diagnostics` key,
			// so the added field must be invisible to it in both directions — the
			// reader must not crash and must not lose the model data it does have.
			mkdirSync(join(tempDir, ".pi"), { recursive: true });
			writeFileSync(
				telemetryFile(),
				JSON.stringify({
					models: {
						"legacy-prov/legacy-model": {
							totalCalls: 2,
							successCalls: 1,
							errorCalls: 1,
							totalTokens: 30,
							totalPromptTokens: 10,
							totalCompletionTokens: 20,
							totalLatencyMs: 200,
							totalCost: 0,
							avgLatencyMs: 200,
							avgTokensPerSecond: 150,
							successRate: 50,
							recentCalls: [],
						},
					},
					lastUpdated: 1,
				}),
			);
			const { getAllTelemetry, getPiAiDiagnostics, recordPiAiDiagnostics } =
				await import("../lib/telemetry.ts");

			expect(getPiAiDiagnostics()).toBeUndefined();
			expect(getAllTelemetry()["legacy-prov/legacy-model"]?.totalCalls).toBe(2);

			// And recording into an old file keeps its model data.
			await recordPiAiDiagnostics(shadowedSnapshot());
			expect(getAllTelemetry()["legacy-prov/legacy-model"]?.totalCalls).toBe(2);
			expect(getPiAiDiagnostics()?.shadowed).toBe(true);
		});
	});
});
