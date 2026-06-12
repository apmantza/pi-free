/**
 * Cross-platform browser opener
 *
 * Opens a URL in the user's default browser. Avoids shell metacharacter
 * injection by passing the URL as a discrete argument (never interpolated
 * into a command string).
 *
 * - Windows: uses `cmd /c start "" <url>` — the first quoted arg is the
 *   window title (always empty), the second is the URL/file to open.
 *   Because the URL is a single arg to `start`, cmd's own argument parser
 *   treats it as a literal path, not as a shell command.
 * - macOS: uses `open`
 * - Linux/BSD: uses `xdg-open`
 */

import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createLogger } from "./logger.ts";

const _logger = createLogger("open-browser");

/**
 * Resolve an executable path, preferring the known absolute path if it exists,
 * falling back to PATH lookup. This avoids relying on an untrusted PATH variable.
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
 * The URL is always passed as a single argument to the underlying
 * launcher — never interpolated into a command string. This prevents
 * shell-metacharacter injection (e.g. `; calc.exe` or `$(...)`).
 */
export function openBrowser(url: string): void {
	try {
		if (process.platform === "win32") {
			const cmd = resolveExe("cmd.exe", "C:\\Windows\\System32\\cmd.exe");
			// `start "" <url>` — the empty quoted string is the window title
			// (mandatory when the URL is also quoted). cmd passes <url> to
			// ShellExecute, which treats it as a literal path/URL.
			spawn(cmd, ["/c", "start", "", url], {
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
	} catch (err) {
		// Best-effort — browser opening is non-critical
		_logger.warn("Failed to open browser", {
			error: err instanceof Error ? err.message : String(err),
		});
	}
}
