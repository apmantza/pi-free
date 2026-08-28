/**
 * PKCE (Proof Key for Code Exchange, RFC 7636) helpers for the Kiro Web
 * Portal auth flow.
 *
 * The Kiro Web Portal's `InitiateLogin` operation expects a PKCE pair:
 *   - `code_verifier`: 43-128 char base64url-encoded random string
 *   - `code_challenge`: base64url(SHA256(code_verifier))
 *   - `state`: random UUID v4 for CSRF protection
 *
 * The `state` is sent to the server in `InitiateLogin` and echoed back in
 * the browser-redirected `code` query parameter. The `login` function
 * (Phase D's kiro-auth.ts) verifies the returned `state` matches what
 * it stored before exchanging the code for a token.
 *
 * Per design doc Phase C: this is the only file in the kiro module that
 * uses Node's `crypto` module. Higher-level modules (Phase C/D) call
 * `generatePkce()` and never touch crypto directly.
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";

/**
 * PKCE pair + state, ready to send to `InitiateLogin` and to verify on
 * the browser redirect.
 */
export interface PkcePair {
 /**
  * Random 43-128 char base64url-encoded string. Stored by the caller
  * for the duration of the login flow; sent to `ExchangeToken` as
  * `code_verifier`. Never log this.
  */
 codeVerifier: string;

 /**
  * base64url(SHA256(codeVerifier)). Sent to `InitiateLogin` as
  * `code_challenge`. Safe to log (it's a public value).
  */
 codeChallenge: string;

 /**
  * Random UUID v4. Sent to `InitiateLogin` and expected back in the
  * browser redirect's `state` query parameter. The caller MUST
  * verify the returned `state` matches this before calling
  * `ExchangeToken`.
  */
 state: string;
}

/**
 * Generate a 64-byte random string (88 chars base64url) for use as the
 * PKCE `code_verifier`. The 64 bytes give 512 bits of entropy, well
 * above the RFC 7636 minimum of 256 bits.
 *
 * @internal Exported for testing only.
 */
export function generateCodeVerifier(): string {
 // 64 bytes → 64*4/3 = 85.3 chars, ceil to 86 base64url chars.
 // The base64url alphabet is RFC 4648 §5 — no `+`, `/`, or `=`.
 return randomBytes(64).toString("base64url");
}

/**
 * Compute the PKCE `code_challenge` from a `code_verifier` per
 * RFC 7636 §4.2 (S256 method).
 *
 * @param codeVerifier A 43-128 char base64url-encoded random string.
 * @returns base64url(SHA256(codeVerifier)), 43 chars.
 *
 * @internal Exported for testing only.
 */
export function computeCodeChallenge(codeVerifier: string): string {
 return createHash("sha256").update(codeVerifier, "utf8").digest("base64url");
}

/**
 * Generate a complete PKCE pair for one login flow. The caller should
 * store `codeVerifier` and `state` for the duration of the flow
 * (typically 1-5 minutes, until the user completes the browser
 * redirect) and pass them to `ExchangeToken`.
 */
export function generatePkce(): PkcePair {
 const codeVerifier = generateCodeVerifier();
 return {
  codeVerifier,
  codeChallenge: computeCodeChallenge(codeVerifier),
  state: randomUUID(),
 };
}
