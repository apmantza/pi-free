import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Exercise scripts/check-tlc.mjs through its real CLI surface (argv +
// exit codes), the same way pr-conventions.test.ts drives its scripts.
// The full TLC runs need a java toolchain (too heavy for the unit suite)
// and run in .github/workflows/tlc.yml instead; here we pin the CLI
// contract: plan listing, usage errors, and the no-download error path.
function runScript(args: string[] = [], env = {}) {
	const result = spawnSync(
		process.execPath,
		[
			fileURLToPath(new URL("../scripts/check-tlc.mjs", import.meta.url)),
			...args,
		],
		{
			encoding: "utf8",
			env: { ...process.env, ...env },
		},
	);
	return {
		status: result.status,
		stdout: result.stdout,
		stderr: result.stderr,
	};
}

describe("check-tlc CLI", () => {
	it("lists every planned check without needing a toolchain", () => {
		const result = runScript(["--list"]);
		expect(result.status).toBe(0);
		for (const cfg of [
			"RefreshB",
			"RefreshR-B",
			"RefreshR-C",
			"ToggleA",
			"ToggleC",
			"RefreshA",
			"RefreshA-starve",
			"RefreshR-A",
			"RefreshR-A-starve",
			"RefreshR-F",
			"ToggleB",
			"FallbackA",
			"FallbackB",
			"SessionA",
			"SessionB",
		]) {
			expect(result.stdout).toContain(cfg);
		}
		expect(result.stdout).toContain("must violate NoSubsetAsAll");
	});

	it("rejects unknown flags with usage and exit 2", () => {
		const result = runScript(["--bogus"]);
		expect(result.status).toBe(2);
		expect(result.stderr).toContain("Usage");
	});

	it("fails cleanly instead of downloading with TLC_NO_DOWNLOAD=1", () => {
		const emptyCache = mkdtempSync(join(tmpdir(), "tlc-empty-"));
		const result = runScript([], {
			TLC_NO_DOWNLOAD: "1",
			TLC_CACHE_DIR: join(emptyCache, "nested", "cache"),
			TLC_JAVA: "",
			TLC_JAR: "",
		});
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("TLC_NO_DOWNLOAD=1");
	});
});
