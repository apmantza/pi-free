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
			recordModelCall("p", "m", usage, 0, opts),
			recordModelCall("p", "m", usage, 0, opts),
			recordModelCall("p", "m", usage, 0, opts),
		]);
		const t = getModelTelemetry("p", "m");
		expect(t?.totalCalls).toBe(3);
	});
});
