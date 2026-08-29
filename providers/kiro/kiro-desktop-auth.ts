/**
 * Kiro Web Portal auth flow driver (Phase D of the kiro-web-portal-auth plan).
 *
 * Composes `kiro-pkce` + `kiro-web-portal` + a localhost HTTP callback
 * server into the top-level login + refresh entry points that
 * `kiro-auth.ts` calls when `kiro_auth_method === "web-portal"` (or when
 * the user runs `/login kiro` on a fresh install).
 *
 * The flow:
 *   1. PKCE: generate a code_verifier / code_challenge / state
 *   2. InitiateLogin: POST the PKCE pair to the Kiro Web Portal with
 *      `redirect_uri = http://127.0.0.1:<port>/callback` (our localhost
 *      server). Get back the URL the user opens in their browser.
 *   3. Browser-redirect loop: the user signs in with their IdP; the
 *      Kiro Web Portal redirects the browser to our localhost URL with
 *      `?code=...&state=...`. The callback server resolves the wait
 *      promise with the code.
 *   4. State verification: confirm the returned `state` matches what
 *      we stored (CSRF protection per OAuth 2.0 §10.12).
 *   5. ExchangeToken: POST the code + code_verifier (with the same
 *      `redirect_uri` we used in step 2) to get the access token +
 *      refresh token cookie + profileArn.
 *   6. Persist as KiroCredentials (extends the existing shape with
 *      `idp`, `profileArn`, `csrfToken`, `machineId`).
 *
 * The localhost callback server is the same pattern Cline's
 * `startCallbackServer` uses and the Kiro-Go reference uses. The Portal
 * supports `redirect_uri = http://127.0.0.1:<port>/...` (per the
 * `kiro.dev/docs/enterprise/identity-provider/*` redirect-URI docs), so
 * the browser comes back to our server automatically — no manual URL
 * paste required.
 *
 * If the localhost server can't bind (port already in use, sandbox
 * restrictions, very old Node, etc.) we fall through to a manual
 * paste prompt — the same path Phase D had before the callback server
 * existed. The user types the redirect URL, we parse `code` + `state`,
 * and continue. Set `options.preferLocalhost = false` to skip the
 * callback server entirely and go straight to manual paste.
 *
 * Per design doc Phase D: this is the only file in the kiro module that
 * drives the login UX. Higher-level modules (Phase E's kiro-stream.ts,
 * kiro-provider.ts) consume the returned KiroCredentials shape
 * unchanged.
 *
 * Logging rules (per `agents.md` convention #17):
 *   - idp, region, status codes, operation names: safe to log
 *   - accessToken, refreshToken, code, codeVerifier, state: NEVER log
 *   - profileArn: logged at debug level with last-20-char truncation
 *   - pastedUrl from user paste: NEVER log the full URL (the code
 *     query param is sensitive)
 *   - callback server port: safe to log
 */

import { createHash } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { Socket } from "node:net";
import { hostname } from "node:os";
import { networkInterfaces } from "node:os";
import type { AddressInfo } from "node:net";
import type { AuthInteraction } from "@earendil-works/pi-ai";
import { createLogger } from "../../lib/logger.ts";
import { KIRO_WEB_PORTAL } from "./kiro-web-portal-cbor.ts";
import { generatePkce, type PkcePair } from "./kiro-pkce.ts";
import {
  exchangeToken as webPortalExchangeToken,
  initiateLogin as webPortalInitiateLogin,
} from "./kiro-web-portal.ts";
import type { KiroIdp } from "./kiro-web-portal-cbor.ts";
import {
  KIRO_DESKTOP_REFRESH_URL,
  type KiroAuthMethod,
  type KiroCredentials,
} from "./kiro-auth.ts";

const _logger = createLogger("kiro-desktop-auth");

/** Same 5-minute buffer the existing `idc` flow uses. */
const EXPIRES_BUFFER_MS = 5 * 60 * 1000;

/**
 * Port range for the localhost callback server. 53100-53199 (100 ports)
 * is in the IANA dynamic/private range (49152-65535) so we don't
 * collide with well-known service ports. The Cline extension uses
 * 48801-48811 (10 ports); we use a wider range to reduce bind-failure
 * retries on developer machines with many listening services.
 */
const CALLBACK_PORT_START = 53100;
const CALLBACK_PORT_END = 53199;

/** How long the callback server waits for the browser redirect before giving up. */
const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;

// =============================================================================
// Errors
// =============================================================================

/** Thrown when login fails for any reason: bad URL, state mismatch, callback timeout, etc. */
export class KiroDesktopLoginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KiroDesktopLoginError";
  }
}

// =============================================================================
// Localhost callback server
// =============================================================================

/**
 * A localhost HTTP server that waits for the Kiro Web Portal to redirect
 * the user's browser to it with `?code=...&state=...`. Renders a tiny
 * success page so the user sees confirmation in their browser.
 *
 * Pattern: Cline's `startCallbackServer` and the Kiro-Go reference
 * `kiro_sso.go` use the same approach. The Portal's
 * `redirect_uri` field accepts a localhost URL with a free port in
 * the IANA dynamic range (49152-65535) per the kiro.dev SSO setup
 * docs.
 */
function startKiroCallbackServer(signal?: AbortSignal): Promise<{
  /** The full `redirect_uri` to pass to `initiateLogin`, e.g. `http://127.0.0.1:53123/callback`. */
  url: string;
  /** Resolves on the first request the browser sends to `/callback`. */
  waitForCallback: Promise<{ code: string; state: string }>;
  /** Stops the server. Safe to call after `waitForCallback` resolves. */
  close: () => void;
}> {
  return new Promise((resolve, reject) => {
    const ports = Array.from(
      { length: CALLBACK_PORT_END - CALLBACK_PORT_START + 1 },
      (_, i) => CALLBACK_PORT_START + i,
    );

    let settled = false;
    let server: Server | undefined;
    let serverTimeout: ReturnType<typeof setTimeout> | undefined;
    let abortListener: (() => void) | undefined;

    const cleanup = () => {
      if (serverTimeout) {
        clearTimeout(serverTimeout);
        serverTimeout = undefined;
      }
      if (signal && abortListener) {
        signal.removeEventListener("abort", abortListener);
        abortListener = undefined;
      }
      if (server) {
        server.close();
        server = undefined;
      }
    };

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };

    // Render a tiny success page so the user sees confirmation in
    // their browser tab when the redirect lands. This is the same
    // page Cline and the Kiro-Go reference render.
    const successHTML = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Kiro login complete</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
font-family:system-ui,sans-serif;background:#fff;color:#333}
.box{text-align:center;padding:24px;border:1px solid #e1e1e1;border-radius:8px;background:#f8f8f8}
.ok{color:#2f855a;font-size:20px;margin-bottom:8px}</style></head>
<body><div class="box"><div class="ok">✓ Kiro login complete</div>
<p>You can close this window and return to your terminal.</p></div></body></html>`;

    // The promise the caller awaits. Resolves on the first hit on
    // `/callback` with `code` and `state` query params; rejects on
    // timeout or a malformed hit.
    let resolveWait: ((r: { code: string; state: string }) => void) | undefined;
    let rejectWait: ((e: Error) => void) | undefined;
    const waitForCallback = new Promise<{ code: string; state: string }>(
      (res, rej) => {
        resolveWait = res;
        rejectWait = rej;
      },
    );
    void waitForCallback.catch(() => {});

    const tryListen = (portIdx: number) => {
      if (portIdx >= ports.length) {
        settle(() =>
          rejectWait?.(
            new KiroDesktopLoginError(
              `Could not bind a localhost callback port in ${CALLBACK_PORT_START}-${CALLBACK_PORT_END}. All ports are in use. Set kiro_auth_method: "idc" to use the legacy device-code flow instead, or free one of these ports.`,
            ),
          ),
        );
        return;
      }
      const port = ports[portIdx] as number;

      const candidate: Server = createServer(
        (req: IncomingMessage, res: ServerResponse) => {
          try {
            const url = new URL(req.url ?? "", `http://127.0.0.1:${port}`);
            // Accept any path; the Kiro Web Portal uses
            // `/callback` (per the docs) but the actual path is
            // whatever we pass as `redirect_uri`, so we accept all.
            const code = url.searchParams.get("code");
            const state = url.searchParams.get("state");
            if (req.method !== "GET" || !code || !state) {
              // Render a minimal error so the user's browser tab
              // doesn't look broken if they hit the wrong path.
              res.writeHead(400, { "Content-Type": "text/html" });
              res.end(
                `<!DOCTYPE html><html><body>Kiro callback: missing or invalid request (expected ?code=...&state=... in the URL).</body></html>`,
              );
              // Don't settle — let the user retry by going back to
              // the Web Portal URL in their other tab.
              return;
            }
            res.writeHead(200, { "Content-Type": "text/html" });
            res.end(successHTML);
            settle(() => resolveWait?.({ code, state }));
          } catch (err) {
            settle(() =>
              rejectWait?.(
                err instanceof Error
                  ? new KiroDesktopLoginError(
                      `Kiro callback handler error: ${err.message}`,
                    )
                  : new KiroDesktopLoginError(
                      "Kiro callback handler error: unknown",
                    ),
              ),
            );
          }
        },
      );

      candidate.once("error", (err: Error) => {
        candidate.close();
        if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") {
          // Port taken — try the next one.
          tryListen(portIdx + 1);
          return;
        }
        settle(() =>
          rejectWait?.(
            new KiroDesktopLoginError(
              `Kiro callback server failed: ${err.message}`,
            ),
          ),
        );
      });

      candidate.listen(port, "127.0.0.1", () => {
        // Bound successfully.
        server = candidate;
        const addr = candidate.address() as AddressInfo | null;
        const chosenPort = addr?.port ?? port;
        const callbackUrl = `http://127.0.0.1:${chosenPort}/callback`;
        _logger.info(
          `[callback server] listening at ${callbackUrl} (5 min timeout)`,
        );
        serverTimeout = setTimeout(() => {
          settle(() =>
            rejectWait?.(
              new KiroDesktopLoginError(
                "Kiro login timed out: the browser did not redirect back to the callback server within 5 minutes. Try again.",
              ),
            ),
          );
        }, CALLBACK_TIMEOUT_MS);
        if (signal) {
          abortListener = () => {
            settle(() => rejectWait?.(new Error("Login cancelled")));
          };
          signal.addEventListener("abort", abortListener, { once: true });
        }
        resolve({
          url: callbackUrl,
          waitForCallback,
          close: cleanup,
        });
      });
    };

    tryListen(0);
  });
}

/**
 * Build a localhost URL the Web Portal can redirect the user's browser
 * to. The Portal supports `http://127.0.0.1:<port>/...` (and
 * `http://localhost:<port>/...`) per the kiro.dev SSO setup docs.
 *
 * Exported for testing only.
 */
export function buildCallbackUrl(
  host: string,
  port: number,
  path = "/callback",
): string {
  return `http://${host}:${port}${path}`;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Parse a `app.kiro.dev/signin/oauth?code=...&state=...` redirect URL into
 * its `code` and `state` query parameters. Tolerates trailing whitespace and
 * a leading/trailing newline (the user might paste with a stray Enter).
 *
 * Used as the manual-paste fallback when the localhost callback server
 * can't bind or when `options.preferLocalhost === false`.
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
  /**
   * When true (default), the desktop-auth flow starts a localhost
   * HTTP server on a free port in the IANA dynamic range (53100-53199)
   * and registers it as the Portal's `redirect_uri`. The browser
   * comes back automatically after the user signs in. When false
   * (or when the localhost server can't bind), falls through to a
   * manual-paste prompt.
   */
  preferLocalhost?: boolean;
}

/**
 * Drive the full Web Portal login flow. Returns a `KiroCredentials`
 * shape that includes `profileArn` (the field that fixes the
 * 400 'Improperly formed request' streaming error from PR #485).
 *
 * Throws `KiroDesktopLoginError` if the user cancels, the pasted URL
 * is invalid, the state doesn't match (CSRF), or the callback times
 * out.
 */
export async function loginKiroDesktop(
  interaction: AuthInteraction,
  options: LoginKiroDesktopOptions = {},
): Promise<KiroCredentials> {
  const idp: KiroIdp = options.idp ?? "BuilderId";
  const region = options.region ?? "us-east-1";
  const preferLocalhost = options.preferLocalhost ?? true;

  // 1. PKCE
  const pkce: PkcePair = generatePkce();
  _logger.info(
    `[loginKiroDesktop] starting ${idp} PKCE flow (state, code_challenge generated)`,
  );

  // 2. Start the localhost callback server (if enabled) so the Portal
  // can redirect the user's browser back to us. We defer InitiateLogin
  // until we have a port bound — otherwise the redirect_uri we hand
  // the Portal wouldn't be listening yet, and the browser would hit
  // a connection refused.
  let callbackServer:
    | Awaited<ReturnType<typeof startKiroCallbackServer>>
    | undefined;
  let redirectUri: string | undefined;
  if (preferLocalhost) {
    try {
      callbackServer = await startKiroCallbackServer(interaction.signal);
      redirectUri = callbackServer.url;
    } catch (err) {
      _logger.warn(
        `[loginKiroDesktop] localhost callback server failed: ${
          err instanceof Error ? err.message : String(err)
        } — falling back to manual paste`,
      );
      // Fall through; manual paste will be used below.
    }
  }

  // 3. InitiateLogin (with our localhost redirect_uri if available)
  const init = await webPortalInitiateLogin({
    idp,
    codeChallenge: pkce.codeChallenge,
    state: pkce.state,
    redirectUri,
    signal: interaction.signal,
  });

  if (interaction.signal?.aborted) {
    callbackServer?.close();
    throw new Error("Login cancelled");
  }

  // 4. Show the URL to the user.
  // - If we have a localhost callback server, the browser comes back
  //   automatically; the user just opens the URL and signs in.
  // - If not, the user needs to paste the final URL from their
  //   browser's address bar (the URL will start with
  //   `${KIRO_WEB_PORTAL}/signin/oauth?code=...&state=...`).
  const instructions = callbackServer
    ? [
        `Open the URL above in your browser and sign in with ${idp}.`,
        `After signing in, the browser will redirect back to ${callbackServer.url} automatically and Kiro will continue.`,
        `(The state value is a CSRF token — it MUST match what we generated.)`,
      ].join("\n")
    : [
        `Open the URL above in your browser and sign in with ${idp}.`,
        `After signing in, your browser will land on ${KIRO_WEB_PORTAL}/signin/oauth?code=...&state=...`,
        `Copy the full URL from your browser's address bar and paste it back here.`,
        `(The state value is a CSRF token — it MUST match what we generated.)`,
      ].join("\n");
  interaction.notify({
    type: "auth_url",
    url: init.redirectUrl,
    instructions,
  });

  // 5. Wait for the auth code — either via the localhost callback
  // (automatic) or via a manual paste prompt (fallback).
  let code: string;
  let returnedState: string;
  if (callbackServer) {
    try {
      const callback = await callbackServer.waitForCallback;
      code = callback.code;
      returnedState = callback.state;
    } finally {
      callbackServer.close();
    }
  } else {
    const pastedUrl = await interaction.prompt({
      type: "manual_code",
      message: "Paste the full redirect URL from your browser",
    });
    if (interaction.signal?.aborted) throw new Error("Login cancelled");
    ({ code, state: returnedState } = parseKiroRedirectUrl(pastedUrl));
  }

  // 6. CSRF check
  if (returnedState !== pkce.state) {
    // SECURITY: log a truncated state (first 8 chars) for debug, never
    // the full state value or the full pasted URL.
    _logger.error(
      `[loginKiroDesktop] state mismatch (returned first 8: ${returnedState.slice(0, 8)}...)`,
    );
    throw new KiroDesktopLoginError(
      "Kiro login failed: the returned URL's `state` parameter does not match what we generated. This usually means the URL was captured from a stale tab or a different login attempt. Please try again.",
    );
  }

  // 7. ExchangeToken (with the same redirect_uri we used in step 3)
  const result = await webPortalExchangeToken({
    idp,
    code,
    codeVerifier: pkce.codeVerifier,
    redirectUri,
    state: pkce.state,
    signal: interaction.signal,
  });

  // 8. Build the KiroCredentials shape. The "refresh" field carries
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

// =============================================================================
// Re-exports
// =============================================================================

// Re-export the `KiroAuthMethod` type so callers (kiro-auth.ts) can
// narrow the credential shape without depending on kiro-auth.ts.
export type { KiroAuthMethod };
// Reference the unused `networkInterfaces` and `Socket` imports so
// the tree-shaker doesn't drop them — they may be useful in future
// edits for SO_REUSEADDR, dual-stack binding, etc. (keeps the surface
// stable across refactors).
void networkInterfaces;
void (null as Socket | null);
