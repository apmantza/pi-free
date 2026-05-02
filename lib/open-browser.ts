/**
 * Cross-platform browser opener
 *
 * Opens a URL in the user's default browser. Handles URL-unsafe characters
 * on Windows by using PowerShell's Start-Process instead of cmd.exe.
 */

import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";

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
 * - Windows: uses PowerShell Start-Process (cmd.exe interprets & as command separator)
 * - macOS: uses `open`
 * - Linux/BSD: uses `xdg-open`
 */
export function openBrowser(url: string): void {
	try {
		if (process.platform === "win32") {
			// PowerShell's Start-Process treats the URL as a literal string,
			// unlike cmd.exe which interprets & as a command separator.
			const powershell = resolveExe(
				"powershell.exe",
				"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
			);
			spawn(
				powershell,
				[
					"-NoProfile",
					"-NonInteractive",
					"-Command",
					`Start-Process "${url.replace(/[\\"]/g, "\\$&")}"`,
				],
				{ detached: true, shell: false, windowsHide: true },
			).unref();
		} else if (process.platform === "darwin") {
			const open = resolveExe("open", "/usr/bin/open");
			spawn(open, [url], { detached: true }).unref();
		} else {
			const xdgOpen = resolveExe("xdg-open", "/usr/bin/xdg-open");
			spawn(xdgOpen, [url], { detached: true }).unref();
		}
	} catch (err) {
		// Best-effort — browser opening is non-critical
		console.debug("Failed to open browser:", err);
	}
}
