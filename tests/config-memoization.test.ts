/**
 * Config memoization tests
 *
 * loadConfigFile() memoizes the parsed config by file mtime: repeated calls
 * with an unchanged file return the same cached object (no re-read/re-parse),
 * and a mtime change invalidates the cache. These tests use a REAL temp HOME
 * with real files — not the node:fs mock in config.test.ts (which omits
 * statSync and so never exercises the memoization fast-path).
 *
 * Note: importing ../config.ts runs ensureConfigFile() at module top-level,
 * which creates/merges ~/.pi/free.json. Tests therefore import first, then
 * control the file's content + mtime explicitly before/after the calls.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempHome = mkdtempSync(join(tmpdir(), "pi-free-config-memo-test-"));
const tempPiDir = join(tempHome, ".pi");
const tempConfigPath = join(tempPiDir, "free.json");

beforeEach(() => {
	// Point HOME at the temp dir so PI_DATA_DIR (= ~/.pi) resolves inside it.
	process.env.HOME = tempHome;
	process.env.USERPROFILE = tempHome;
	if (!existsSync(tempPiDir)) mkdirSync(tempPiDir, { recursive: true });
	// Fresh module instance → resets the module-level cachedConfig cache.
	vi.resetModules();
});

afterEach(() => {
	delete process.env.HOME;
	delete process.env.USERPROFILE;
});

describe("loadConfigFile mtime memoization", () => {
	it("returns the same cached object when the file mtime is unchanged", async () => {
		// Import runs ensureConfigFile() which creates the template config.
		const { loadConfigFile } = await import("../config.ts");
		const first = loadConfigFile();
		const second = loadConfigFile();

		// Memoized hit: identical object reference (no re-read/re-parse).
		expect(second).toBe(first);
		// Template default preserved through the ensureConfigFile merge.
		expect(first.kilo_show_paid).toBe(false);
	});

	it("re-reads and reflects new content when the file mtime changes", async () => {
		const { loadConfigFile } = await import("../config.ts");
		const first = loadConfigFile();

		// Rewrite with different content and force a distinct (earlier) mtime
		// so it cannot match the mtime cached during the first read.
		writeFileSync(
			tempConfigPath,
			`${JSON.stringify({
				kilo_show_paid: true,
				kilo_api_key: "second",
			})}\n`,
		);
		utimesSync(tempConfigPath, 1_000, 1_000);

		const second = loadConfigFile();

		// Cache invalidated: new parse (new reference) with the new content.
		expect(second).not.toBe(first);
		expect(second.kilo_api_key).toBe("second");
		expect(second.kilo_show_paid).toBe(true);
	});

	it("falls through safely (returns {}) when the file is missing", async () => {
		// Import creates the file via ensureConfigFile(); then remove it.
		const { loadConfigFile } = await import("../config.ts");
		if (existsSync(tempConfigPath)) rmSync(tempConfigPath);

		// statSync throws (no file) → cache reset → readFileSync throws → {} .
		expect(() => loadConfigFile()).not.toThrow();
		expect(loadConfigFile()).toEqual({});
	});
});
