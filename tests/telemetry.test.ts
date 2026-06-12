import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDir = mkdtempSync(join(tmpdir(), "pi-free-telemetry-test-"));
const telemetryFile = join(tempDir, "free-telemetry.json");

describe("telemetry", () => {
	beforeEach(() => {
		process.env.PI_FREE_TELEMETRY_FILE = telemetryFile;
		if (existsSync(telemetryFile)) unlinkSync(telemetryFile);
		vi.resetModules();
	});

	afterEach(() => {
		delete process.env.PI_FREE_TELEMETRY_FILE;
	});

	it("records concurrent model calls without losing entries", async () => {
		const { recordModelCall, getModelTelemetry } = await import(
			"../lib/telemetry.ts"
		);
		const usage = { input: 1, output: 2, totalTokens: 3 };
		const opts = { success: true };
		await Promise.all([
			recordModelCall("p", "m", usage, 0, opts),
			recordModelCall("p", "m", usage, 0, opts),
			recordModelCall("p", "m", usage, 0, opts),
		]);
		const t = getModelTelemetry("p", "m");
		expect(t?.totalCalls).toBe(3);
	});
});
