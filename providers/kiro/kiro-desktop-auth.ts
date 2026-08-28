/**
 * Kiro Web Portal auth flow driver (Phase D of the kiro-web-portal-auth plan).
 *
 * Composes `kiro-pkce` + `kiro-web-portal` + a browser-redirect loop into the
 * top-level login + refresh entry points that `kiro-auth.ts` calls when
 * `kiro_auth_method === "web-portal"` (or when the user runs `/login kiro`
 * on a fresh install).
 *
 * The flow:
 *   1. PKCE: generate a code_verifier / code_challenge / state
 *   2. InitiateLogin: POST the PKCE pair to the Kiro Web Portal, get a
 *      redirect URL the user opens in their browser
 *   3. Browser-redirect loop: the user signs in with their IdP, the
 *      browser lands on `app.kiro.dev/signin/oauth?code=...&state=...`
 *   4. State verification: confirm the returned `state` matches what
 *      we stored (CSRF protection per OAuth 2.0 §10.12)
 *   5. ExchangeToken: POST the code + code_verifier, get the access
 *      token + refresh token cookie + profileArn
 *   6. Persist as KiroCredentials (extends the existing shape with
 *      `idp`, `profileArn`, `csrfToken`, `machineId`)
 *
 * The browser-redirect loop uses Pi's `interaction.prompt({ type:
 * "manual_code", ... })` to ask the user to paste the redirect URL.
 * The Cline `startCallbackServer` pattern (a local HTTP server) is
 * possible too but not portable: the AWS SSO authorize URL hardcodes
 * the `callback_url` to Cognito's `authentication_result` endpoint,
 * not a localhost port, so the browser never comes back to a local
 * server. The kiro-cli's own CLI drives a real browser (Selenium) to
 * intercept the URL change. Pi's extension surface doesn't have a
 * browser, so manual paste is the only path. This is documented in
 * `docs/kiro-web-portal-auth.md`.
 *
 * Per design doc Phase D: this is the only file in the kiro module that
 * calls `interaction.prompt` for the Kiro Web Portal flow. Higher-level
 * modules (Phase E's kiro-stream.ts, kiro-provider.ts) consume the
 * returned KiroCredentials shape unchanged.
 *
 * Logging rules (per `agents.md` convention #17):
 *   - idp, region, status codes, operation names: safe to log
 *   - accessToken, refreshToken, code, codeVerifier, state: NEVER log
 *   - profileArn: logged at debug level with last-20-char truncation
 *   - pastedUrl from user paste: NEVER log the full URL (the code
 *     query param is sensitive)
 */

import { createHash } from "node:crypto";
import { hostname } from "node:os";
import type { AuthInteraction } from "@earendil-works/pi-ai";
import { createLogger } from "../../lib/logger.ts";
import { KIRO_WEB_PORTAL } from "./kiro-web-portal-cbor.ts";
import { generatePkce, type PkcePair } from "./kiro-pkce.ts";
import {
  exchangeToken as webPortalExchangeToken,
  initiateLogin as webPortalInitiateLogin,
} from "./kiro-web-portal.ts";
import type { KiroIdp } from "./kiro-web-portal-cbor.ts";
import { KIRO_DESKTOP_REFRESH_URL, type KiroCredentials } from "./kiro-auth.ts";

const _logger = createLogger("kiro-desktop-auth");

/** Same 5-minute buffer the existing `idc` flow uses. */
const EXPIRES_BUFFER_MS = 5 * 60 * 1000;

// =============================================================================
// Errors
// =============================================================================

/** Thrown when the user pastes an invalid redirect URL or the state doesn't match. */
export class KiroDesktopLoginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KiroDesktopLoginError";
  }
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Parse a `app.kiro.dev/signin/oauth?code=...&state=...` redirect URL into
 * its `code` and `state` query parameters. Tolerates trailing whitespace and
 * a leading/trailing newline (the user might paste with a stray Enter).
 */
function parseKiroRedirectUrl(pasted: string): { code: string; state: string } {
  const trimmed = pasted.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new KiroDesktopLoginError(
      "Pasted URL is not a valid URL. Copy the full URL from your browser's address bar (starts with " +
        KIRO_WEB_PORTAL +
        "/signin/oauth?code=...).",
    );
  }
  if (!url.href.startsWith(`${KIRO_WEB_PORTAL}/signin/oauth`)) {
    throw new KiroDesktopLoginError(
      `Pasted URL is not a Kiro redirect URL. Expected it to start with ${KIRO_WEB_PORTAL}/signin/oauth but got ${url.origin}${url.pathname}.`,
    );
  }
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code) {
    throw new KiroDesktopLoginError(
      "Pasted URL is missing the `code` query parameter. Did you copy the full URL?",
    );
  }
  if (!state) {
    throw new KiroDesktopLoginError(
      "Pasted URL is missing the `state` query parameter. Did you copy the full URL?",
    );
  }
  return { code, state };
}

/**
 * Derive a stable `machineId` for the Kiro Desktop refresh `User-Agent`
 * header. The kiro-cli uses `KiroIDE-{version}-{machineId}` where
 * `machineId` is a SHA-256 of the host's MAC. We use a SHA-256 of the
 * hostname (or the first 32 hex chars of it) as a stable,
 * privacy-preserving alternative — the value is per-machine and stable
 * across reboots, and never leaves the local machine.
 *
 * @internal Exported for testability.
 */
export function deriveMachineId(): string {
  const h = hostname() || "unknown-host";
  return createHash("sha256").update(h, "utf8").digest("hex").slice(0, 32);
}

/** A `User-Agent: KiroIDE-0.6.18-{machineId}` shape, matching the kiro-cli. */
function kiroDesktopUserAgent(machineId: string): string {
  return `KiroIDE-0.6.18-${machineId}`;
}

// =============================================================================
// Login
// =============================================================================

export interface LoginKiroDesktopOptions {
  /** Defaults to "BuilderId". */
  idp?: KiroIdp;
  /** Defaults to "us-east-1". */
  region?: string;
}

/**
 * Drive the full Web Portal login flow. Returns a `KiroCredentials`
 * shape that includes `profileArn` (the field that fixes the
 * 400 'Improperly formed request' streaming error from PR #485).
 *
 * Throws `KiroDesktopLoginError` if the user cancels, pastes an
 * invalid URL, or the state doesn't match (CSRF).
 */
export async function loginKiroDesktop(
  interaction: AuthInteraction,
  options: LoginKiroDesktopOptions = {},
): Promise<KiroCredentials> {
  const idp: KiroIdp = options.idp ?? "BuilderId";
  const region = options.region ?? "us-east-1";

  // 1. PKCE
  const pkce: PkcePair = generatePkce();
  _logger.info(
    `[loginKiroDesktop] starting ${idp} PKCE flow (state, code_challenge generated)`,
  );

  // 2. InitiateLogin
  const init = await webPortalInitiateLogin({
    idp,
    codeChallenge: pkce.codeChallenge,
    state: pkce.state,
    signal: interaction.signal,
  });

  if (interaction.signal?.aborted) throw new Error("Login cancelled");

  // 3. Browser-redirect: show the URL + instructions, then ask the
  // user to paste back the full redirect URL from their browser.
  interaction.notify({
    type: "auth_url",
    url: init.redirectUrl,
    instructions: [
      `Open the URL above in your browser and sign in with ${idp}.`,
      `After signing in, your browser will land on ${KIRO_WEB_PORTAL}/signin/oauth?code=...&state=...`,
      `Copy the full URL from your browser's address bar and paste it back here.`,
      `(The state value is a CSRF token — it MUST match what we generated.)`,
    ].join("\n"),
  });

  const pastedUrl = await interaction.prompt({
    type: "manual_code",
    message: "Paste the full redirect URL from your browser",
  });

  if (interaction.signal?.aborted) throw new Error("Login cancelled");

  // 4. Parse and verify state
  const { code, state: returnedState } = parseKiroRedirectUrl(pastedUrl);
  if (returnedState !== pkce.state) {
    // SECURITY: log a truncated state (first 8 chars) for debug, never
    // the full state value or the full pasted URL.
    _logger.error(
      `[loginKiroDesktop] state mismatch (returned first 8: ${returnedState.slice(0, 8)}...)`,
    );
    throw new KiroDesktopLoginError(
      "Kiro login failed: the pasted URL's `state` parameter does not match what we generated. This usually means the URL was captured from a stale tab or a different login attempt. Please try again.",
    );
  }

  // 5. ExchangeToken
  const result = await webPortalExchangeToken({
    idp,
    code,
    codeVerifier: pkce.codeVerifier,
    state: pkce.state,
    signal: interaction.signal,
  });

  // 6. Build the KiroCredentials shape. The "refresh" field carries
  // the refresh token cookie (the body never carries it per the
  // Kiro Web Portal protocol; confirmed by the kiro-auto-register
  // Python ref and the kiro-account-manager changelog). The cookie
  // MUST be present; if it isn't, the Web Portal changed its contract.
  const refreshToken = result.cookies.refreshToken;
  if (!refreshToken) {
    // SECURITY: don't log the cookies or the accessToken.
    throw new KiroDesktopLoginError(
      "Kiro login succeeded but no refresh token was returned. The Kiro Web Portal may have changed its contract; try a different IdP or re-login.",
    );
  }

  const machineId = deriveMachineId();

  // The applicationArn returned by InitiateLogin IS the OAuth clientId
  // for the Kiro Web Portal flow (confirmed by the live probe — it's
  // embedded in the authorize URL's `client_id` query param).
  const clientId = init.applicationArn ?? "";

  const credentials: KiroCredentials = {
    type: "oauth",
    access: result.body.accessToken,
    refresh: refreshToken,
    expires: Date.now() + result.body.expiresIn * 1000 - EXPIRES_BUFFER_MS,
    clientId,
    clientSecret: "", // public-client flow, no clientSecret
    region,
    authMethod: "web-portal",
    ...(result.body.profileArn ? { profileArn: result.body.profileArn } : {}),
    ...(result.body.csrfToken ? { csrfToken: result.body.csrfToken } : {}),
    machineId,
    idp,
  };

  _logger.info(
    `[loginKiroDesktop] ${idp} login complete (expires in ${result.body.expiresIn}s, machineId ${machineId.slice(0, 8)}..., profileArn ${result.body.profileArn ? "set (last 20: ...'" + result.body.profileArn.slice(-20) + "')" : "absent"})`,
  );
  return credentials;
}

// =============================================================================
// Refresh
// =============================================================================

/**
 * Refresh a `web-portal` credential via the Kiro Desktop refresh
 * endpoint. The endpoint is the same one the existing `desktop`
 * authMethod uses (`prod.{region}.auth.desktop.kiro.dev/refreshToken`),
 * but the response now also carries `profileArn` — extract and persist.
 *
 * Matches the kiro-cli's `User-Agent: KiroIDE-0.6.18-{machineId}` shape
 * so the refresh request is indistinguishable from a kiro-cli refresh.
 */
export async function refreshKiroDesktopCredential(
  credential: KiroCredentials,
  signal?: AbortSignal,
): Promise<KiroCredentials> {
  const region = credential.region || "us-east-1";
  const url = KIRO_DESKTOP_REFRESH_URL.replace("{region}", region);
  const machineId = credential.machineId ?? deriveMachineId();

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": kiroDesktopUserAgent(machineId),
      },
      body: JSON.stringify({ refreshToken: credential.refresh }),
      signal: signal ?? AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new Error(
      `Kiro desktop refresh failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `Kiro desktop refresh failed: ${response.status} ${response.statusText} ${errorText}`,
    );
  }

  const data = (await response.json()) as {
    accessToken: string;
    refreshToken?: string;
    expiresIn: number;
    profileArn?: string;
    csrfToken?: string;
  };

  if (!data.accessToken) {
    throw new Error("Kiro desktop refresh: missing accessToken in response");
  }

  // Detect profileArn changes (rare, but possible after subscription
  // upgrades). Truncated to last 20 chars per the design doc's
  // observability rules.
  const oldProfileArn = credential.profileArn;
  const newProfileArn = data.profileArn ?? oldProfileArn;
  if (oldProfileArn && newProfileArn && oldProfileArn !== newProfileArn) {
    _logger.info(
      `[refreshKiroDesktopCredential] profileArn updated: ...${oldProfileArn.slice(-20)} → ...${newProfileArn.slice(-20)}`,
    );
  }

  _logger.debug(
    `[refreshKiroDesktopCredential] access token refreshed (expires in ${data.expiresIn}s)`,
  );

  return {
    ...credential,
    access: data.accessToken,
    refresh: data.refreshToken ?? credential.refresh,
    expires: Date.now() + data.expiresIn * 1000 - EXPIRES_BUFFER_MS,
    ...(newProfileArn ? { profileArn: newProfileArn } : {}),
    ...(data.csrfToken ? { csrfToken: data.csrfToken } : {}),
  };
}
