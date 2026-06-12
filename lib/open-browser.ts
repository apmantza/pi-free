/**
 * Cross-platform browser opener
 *
 * Opens a URL in the user's default browser.
 *
 * SECURITY:
 * - On Windows, uses `rundll32 url.dll,FileProtocolHandler <url>` — this
 *   bypasses cmd.exe's command parser entirely. cmd's `start` builtin
 *   interprets shell metacharacters (`&`, `|`, `^`, etc.) BEFORE the URL
 *   reaches its target, so `cmd /c start "" <url>` is exploitable even
 *   with `shell: false` and discrete args (CodeQL js/uncontrolled-command-line).
 *   rundll32 doesn't parse the command line, so the URL is handed to
 *   ShellExecute as a literal.
 * - On all platforms, URLs are strictly validated: only http/https, no
 *   control characters. This is defense-in-depth.
 * - The URL is always passed as a single argument to the underlying
 *   launcher — never interpolated into a command string.
 *
 * Platforms:
 * - Windows: `rundll32 url.dll,FileProtocolHandler` → ShellExecute
 * - macOS:   `/usr/bin/open`
 * - Linux:   `/usr/bin/xdg-open`
 */

import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createLogger } from "./logger.ts";

const _logger = createLogger("open-browser");

/**
 * Validate that a URL is safe to open.
 * Only http/https protocols are allowed. URLs with control characters
 * are rejected.
 */
function isSafeUrl(url: string): boolean {
	if (typeof url !== "string" || url.length === 0 || url.length > 2048) {
		return false;
	}
	// Reject any control characters (NUL, CR, LF, etc.) — they have no
	// place in a URL and can confuse shell parsers.
	// eslint-disable-next-line no-control-regex
	if (/[\x00-\x1f\x7f]/.test(url)) return false;
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return false;
	}
	return parsed.protocol === "http:" || parsed.protocol === "https:";
}

/**
 * Resolve an executable path, preferring the known absolute path if it
 * exists, falling back to PATH lookup. This avoids relying on an
 * untrusted PATH variable.
 */
function resolveExe(name: string, absolutePath: string): string {
	if (absolutePath && existsSync(absolutePath)) {
		return absolutePath;
	}
	// Fallback: try to resolve via PATH (may still be manipulated)
	try {
		const which = process.platform === "win32" ? "where" : "which";
		// Use execFileSync with separate args — no shell injection vector
		return execFileSync(which, [name], { encoding: "utf8" })
			.trim()
			.split("\n")[0];
	} catch {
		return name; // Last-resort fallback
	}
}

/**
 * Open a URL in the user's default browser.
 *
 * Returns true if the URL was accepted and the launcher was spawned,
 * false if the URL was rejected by validation.
 */
export function openBrowser(url: string): boolean {
	if (!isSafeUrl(url)) {
		_logger.warn("openBrowser: rejected URL", { url });
		return false;
	}

	try {
		if (process.platform === "win32") {
			// rundll32 url.dll,FileProtocolHandler invokes ShellExecute
			// with the URL, which opens it in the user's default browser.
			// Unlike `cmd /c start "" <url>`, rundll32 does NOT parse the
			// command line — the URL is handed to ShellExecute as a
			// literal argument. This is the canonical safe pattern and
			// addresses the CodeQL "Uncontrolled command line" finding.
			const rundll32 = resolveExe(
				"rundll32.exe",
				"C:\\Windows\\System32\\rundll32.exe",
			);
			spawn(rundll32, ["url.dll,FileProtocolHandler", url], {
				detached: true,
				shell: false,
				windowsHide: true,
			}).unref();
		} else if (process.platform === "darwin") {
			const open = resolveExe("open", "/usr/bin/open");
			spawn(open, [url], { detached: true }).unref();
		} else {
			const xdgOpen = resolveExe("xdg-open", "/usr/bin/xdg-open");
			spawn(xdgOpen, [url], { detached: true }).unref();
		}
		return true;
	} catch (err) {
		// Best-effort — browser opening is non-critical
		_logger.warn("Failed to open browser", {
			error: err instanceof Error ? err.message : String(err),
		});
		return false;
	}
}
