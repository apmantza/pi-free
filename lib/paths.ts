/**
 * Centralized path resolution for ~/.pi/ data files.
 *
 * These helpers constrain file paths to the user's pi data directory
 * to prevent arbitrary-file-write vulnerabilities from attacker-controlled
 * environment variables. All env-var file overrides must resolve to a
 * path inside ~/.pi/ or be rejected.
 */

import { existsSync, mkdirSync } from "node:fs";
import { homedir as _nodeHomedir } from "node:os";
import { basename, join, resolve, sep } from "node:path";

/**
 * The user's home directory.
 *
 * On POSIX, `node:os.homedir()` already respects the `HOME` env var.
 * On Windows, it uses `USERPROFILE` and ignores `HOME`. We prefer `HOME`
 * (set by tests and various cross-platform tooling) and fall back to
 * `USERPROFILE` and then to `node:os.homedir()`.
 */
function resolveHomeDir(): string {
	if (process.env.HOME) return process.env.HOME;
	if (process.env.USERPROFILE) return process.env.USERPROFILE;
	return _nodeHomedir();
}

/** The user's pi data directory (~/.pi). */
export const PI_DATA_DIR = join(resolveHomeDir(), ".pi");

/** Maximum basename length for override env vars. */
const MAX_BASENAME_LENGTH = 128;

/** Characters that are not allowed in a basename. */
const FORBIDDEN_CHARS_RE = /[/\\\0]/;

/**
 * Ensure a directory exists, creating it (and parents) if missing.
 * Idempotent — safe to call repeatedly.
 */
export function ensureDir(dir: string): void {
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
}

/**
 * Resolve a file path from an env-var override, constrained to ~/.pi/.
 *
 * The env var may override only the *filename* (not the directory).
 * If the env var is unset or empty, returns the default path.
 * If the env var contains a path separator or null byte, the override
 * is rejected and the default path is used.
 *
 * @param envValue - Raw env var value (may be undefined/empty)
 * @param defaultFilename - Default filename inside ~/.pi/
 * @returns A path string that is guaranteed to be inside ~/.pi/
 */
export function resolveSafeDataFile(
	envValue: string | undefined,
	defaultFilename: string,
): string {
	if (!envValue) {
		return join(PI_DATA_DIR, defaultFilename);
	}

	// Reject any path separator — only allow bare filenames
	if (FORBIDDEN_CHARS_RE.test(envValue)) {
		return join(PI_DATA_DIR, defaultFilename);
	}

	// Reject empty after trim, overly long, or suspicious filenames
	const trimmed = envValue.trim();
	if (
		!trimmed ||
		trimmed === "." ||
		trimmed === ".." ||
		trimmed.length > MAX_BASENAME_LENGTH
	) {
		return join(PI_DATA_DIR, defaultFilename);
	}

	// Final safety check: resolve and verify the result is still inside PI_DATA_DIR
	const candidate = resolve(join(PI_DATA_DIR, basename(trimmed)));
	if (candidate !== PI_DATA_DIR && !candidate.startsWith(PI_DATA_DIR + sep)) {
		return join(PI_DATA_DIR, defaultFilename);
	}

	return candidate;
}
