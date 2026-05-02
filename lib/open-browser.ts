/**
 * Cross-platform browser opener
 *
 * Opens a URL in the user's default browser. Handles URL-unsafe characters
 * on Windows by using PowerShell's Start-Process instead of cmd.exe.
 */

import { spawn } from "node:child_process";

function getSafeEnv(): NodeJS.ProcessEnv {
	if (process.platform === "win32") return process.env;
	return {
		...process.env,
		PATH: "/usr/local/bin:/usr/bin:/bin",
	};
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
		const env = getSafeEnv();
		if (process.platform === "win32") {
			// PowerShell's Start-Process treats the URL as a literal string,
			// unlike cmd.exe which interprets & as a command separator.
			spawn(
				"powershell.exe",
				[
					"-NoProfile",
					"-NonInteractive",
					"-Command",
					`Start-Process "${url.replace(/[\\"]/g, "\\$&")}"`,
				],
				{ detached: true, shell: false, windowsHide: true, env },
			).unref();
		} else if (process.platform === "darwin") {
			spawn("open", [url], { detached: true, env }).unref();
		} else {
			spawn("xdg-open", [url], { detached: true, env }).unref();
		}
	} catch (err) {
		// Best-effort — browser opening is non-critical
		console.debug("Failed to open browser:", err);
	}
}
