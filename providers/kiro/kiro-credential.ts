/**
 * Helper for reading the persisted Kiro credential from Pi's
 * `~/.pi/agent/auth.json` store.
 *
 * Used by `kiro-stream.ts` to look up the `profileArn` that the
 * `kiro-desktop-auth` login flow persisted alongside the access
 * token. Without this, the stream function would only have the
 * access token (Pi's auth surface hands streams `apiKey` but not
 * the full credential), and we'd have to require the user to set
 * `kiro_profile_arn` in `~/.pi/free.json` even after the new flow
 * persisted one.
 *
 * Per design doc Phase E: this read is a best-effort lookup, never
 * throws. If `auth.json` is missing or malformed, the helper
 * returns `undefined` and the stream falls through to the next
 * profileArn resolution step (`getKiroProfileArn()`).
 *
 * Per `agents.md` convention #17: this file never logs the access
 * token or the refresh token. It only reads the typed fields.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PI_DATA_DIR } from "../../lib/paths.ts";

/** The shape of the Kiro entry in `~/.pi/agent/auth.json`. */
interface KiroAuthJsonEntry {
 type: "oauth";
 access: string;
 refresh: string;
 expires: number;
 profileArn?: string;
 clientId?: string;
 clientSecret?: string;
 region?: string;
 authMethod?: string;
 csrfToken?: string;
 machineId?: string;
 idp?: string;
 [key: string]: unknown;
}

interface AuthJsonShape {
 kiro?: KiroAuthJsonEntry;
 [key: string]: unknown;
}

/**
 * Read the persisted Kiro credential's `profileArn` from
 * `~/.pi/agent/auth.json`. Returns `undefined` if:
 *   - the file doesn't exist
 *   - the file is malformed JSON
 *   - the `kiro` key is missing or has no `profileArn` field
 *   - any fs error occurs (the helper is best-effort by design)
 *
 * The function is synchronous to match the existing
 * `kiro-stream.ts` profileArn resolution shape, which runs inside
 * an async loop but is called sequentially before the first HTTP
 * call. A sync read of a small JSON file (~1-5KB) is on the order
 * of microseconds and not worth the latency overhead of an async
 * call.
 */
export function readPersistedKiroProfileArn(): string | undefined {
 const authPath = join(PI_DATA_DIR, "auth.json");
 if (!existsSync(authPath)) return undefined;
 try {
  const raw = readFileSync(authPath, "utf-8");
  const parsed = JSON.parse(raw) as AuthJsonShape;
  const kiro = parsed.kiro;
  if (!kiro || typeof kiro.profileArn !== "string") return undefined;
  return kiro.profileArn;
 } catch {
  // Best-effort: swallow any read/parse error and let the caller
  // fall through to the next resolution step.
  return undefined;
 }
}
