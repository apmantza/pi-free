/**
 * Persistent machine ID for Qoder API authentication.
 *
 * The rest of the COSY cryptographic signing scheme (RSA-encrypted AES keys,
 * AES-CBC user info, MD5 payload signing) was removed as dead code — Qoder's
 * auth flow in `auth.ts` implements the headers it needs directly. This module
 * retains only the machine identity helper, which the auth flow still uses.
 */

import crypto from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Get or create a persistent machine ID.
 * Checks ~/.qoder/.auth/machine_id first, then falls back to ~/.pi/agent/qoder-machine-id.
 */
export function getMachineId(): string {
	const paths = [
		join(homedir(), ".qoder", ".auth", "machine_id"),
		join(homedir(), ".pi", "agent", "qoder-machine-id"),
	];
	for (const p of paths) {
		if (existsSync(p)) {
			try {
				const val = readFileSync(p, "utf8").trim();
				if (val) return val;
			} catch {
				// Ignore read errors
			}
		}
	}
	const newId = crypto.randomUUID();
	try {
		const savePath = paths[1];
		mkdirSync(dirname(savePath), { recursive: true });
		writeFileSync(savePath, newId, "utf8");
	} catch {
		// Best-effort
	}
	return newId;
}
