/**
 * Kiro social sign-in relay flow (Google / GitHub) — automatic browser
 * capture for IdPs whose authorization leg is backed by Kiro's Cognito app.
 *
 * Live-verified protocol map (probed 2026-09-01 against the real endpoints):
 *
 *   - The CBOR Web Portal `InitiateLogin` operation rejects any
 *     `redirect_uri` except allowlisted values. The AWS SSO leg (BuilderId)
 *     returns `401 UnauthorizedException "Authentication required or access
 *     denied."` for every loopback redirect URI (any host, port, or path) —
 *     that was the reported "Failed to login to Kiro:
 *     Kiro Web Portal InitiateLogin failed: Authentication required or
 *     access denied." error. Only the Portal's own
 *     `https://app.kiro.dev/signin/oauth` works there, which forces the
 *     manual-paste flow (see `kiro-desktop-auth.ts`).
 *   - The Cognito leg (Google/Github) accepts `InitiateLogin` with the
 *     loopback redirect `http://localhost:3128/oauth/callback` (bare path,
 *     no query) and echoes it into the Cognito authorize URL together with
 *     our `state` and `code_challenge`. Cognito itself validates the
 *     redirect URI against its allowlist: the bare
 *     `http://localhost:3128/oauth/callback` passes (302 → the IdP), while
 *     the portal's web bundle's suffixed form
 *     (`.../oauth/callback?login_option=Google`) and any other loopback
 *     host/port/path fail with `redirect_mismatch`.
 *   - The authorization code is exchanged at
 *     `prod.us-east-1.auth.desktop.kiro.dev/oauth/token` with JSON
 *     `{ code, code_verifier, redirect_uri }` (the endpoint the Kiro IDE
 *     uses for the social leg — deliberately a different path from the
 *     `/refreshToken` refresh endpoint) and responds with
 *     `{ accessToken, refreshToken, profileArn, expiresIn }`.
 *
 * The fixed port: `3128` is the port embedded in Cognito's allowlist entry,
 * so it cannot be randomized the way Cline's callback server does. If the
 * port is taken (another Kiro client, or a stuck previous login), the bind
 * fails with a `KiroSigninFlowError` whose `isBindFailure` is true and the
 * caller falls back to the manual-paste flow.
 *
 * Logging rules (per `agents.md` convention #17):
 *   - idp, status codes, operation names: safe to log
 *   - accessToken, refreshToken, code, code_verifier, state: NEVER log
 */

import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { createLogger } from "../../lib/logger.ts";
import { generatePkce, type PkcePair } from "./kiro-pkce.ts";
import { initiateLogin as webPortalInitiateLogin } from "./kiro-web-portal.ts";
import type { KiroIdp } from "./kiro-web-portal-cbor.ts";

const _logger = createLogger("kiro-signin-flow");

// =============================================================================
// Endpoints and constants
// =============================================================================

/** The fixed loopback port embedded in Cognito's allowlist entry. */
export const KIRO_SOCIAL_RELAY_PORT = 3128;

/**
 * The loopback redirect URI used for the social (Google/Github) legs:
 * the only loopback value both the Portal's `InitiateLogin` and Kiro's
 * Cognito app accept. Host is the `localhost` literal (the value the
 * allowlist holds) while the relay binds the 127.0.0.1 / [::1] literals;
 * the browser resolving `localhost` to either loopback bridges the two.
 */
export const KIRO_SOCIAL_REDIRECT_URI = `http://localhost:${KIRO_SOCIAL_RELAY_PORT}/oauth/callback`;

/**
 * The Cognito-backed social code-exchange endpoint. NOTE: deliberately a
 * different path from the refresh endpoint (`/refreshToken`, used by
 * `refreshKiroDesktopCredential`) — the IDE exchanges the login code at
 * `/oauth/token` and refreshes at `/refreshToken`.
 */
export const KIRO_SOCIAL_TOKEN_URL =
  "https://prod.us-east-1.auth.desktop.kiro.dev/oauth/token";

/** IdPs the automatic relay flow supports (Cognito-backed social legs). */
export const KIRO_SOCIAL_IDPS: readonly KiroIdp[] = ["Google", "Github"];

/** How long the relay waits for the browser redirect before giving up. */
const RELAY_TIMEOUT_MS = 5 * 60 * 1000;

/** Timeout for the token exchange fetch. */
const TOKEN_TIMEOUT_MS = 30_000;

/** Fallback `expiresIn` (1h) when the exchange response omits the field. */
const DEFAULT_EXPIRES_IN_S = 3600;

// =============================================================================
// Errors
// =============================================================================

/**
 * Thrown when the social relay flow fails: bind failure, state mismatch,
 * timeout, or exchange error. `isBindFailure` marks the fixed-port bind
 * failure so the caller can fall back to the manual-paste flow.
 */
export class KiroSigninFlowError extends Error {
  constructor(
    message: string,
    readonly isBindFailure = false,
  ) {
    super(message);
    this.name = "KiroSigninFlowError";
  }
}

// =============================================================================
// Loopback relay (fixed port, dual-stack best effort)
// =============================================================================

/** A relay that resolves when the portal forwards the sign-in result to the loopback redirect. */
export interface KiroSigninRelay {
  /** Resolves with the relayed `code` + `state`, or rejects on relay error/timeout/abort. */
  waitForRelay: Promise<{ code: string; state: string }>;
  /** Stops the server(s). Idempotent; safe to call after `waitForRelay` settles. */
  close: () => void;
}

const RELAY_SUCCESS_HTML = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Kiro login complete</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
font-family:system-ui,sans-serif;background:#fff;color:#333}
.box{text-align:center;padding:24px;border:1px solid #e1e1e1;border-radius:8px;background:#f8f8f8}
.ok{color:#2f855a;font-size:20px;margin-bottom:8px}</style></head>
<body><div class="box"><div class="ok">✓ Kiro login complete</div>
<p>You can close this window and return to your terminal.</p></div></body></html>`;

function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Start the loopback relay on the fixed port 3128: 127.0.0.1 (mandatory)
 * plus [::1] (best-effort — a browser resolving `localhost` may pick
 * either loopback). Only the same host can reach the transient relay.
 *
 * Throws a `KiroSigninFlowError` with `isBindFailure: true` when the
 * mandatory 127.0.0.1 bind fails (port already in use).
 */
/** Mutable state shared by the relay's request handler and lifecycle hooks. */
interface RelayState {
  servers: Server[];
  timeout?: ReturnType<typeof setTimeout>;
  abortListener?: () => void;
  settled: boolean;
}

/**
 * Create the settle/close controller for the relay: rejects the
 * caller-facing wait promise on timeout/abort and tears the servers down.
 * (Resolution happens in the request handler, not here.)
 */
function createRelayController(
  state: RelayState,
  rejectWait: (e: Error) => void,
  signal?: AbortSignal,
) {
  const close = () => {
    if (state.timeout) {
      clearTimeout(state.timeout);
      state.timeout = undefined;
    }
    if (signal && state.abortListener) {
      signal.removeEventListener("abort", state.abortListener);
      state.abortListener = undefined;
    }
    while (state.servers.length > 0) {
      const server = state.servers.pop();
      if (!server) continue;
      server.close();
      // `close()` only stops new connections; keep-alive sockets from the
      // browser would hold the fixed port open and make the NEXT login
      // fail with EADDRINUSE. Force-terminate them (Node 18.2+).
      server.closeIdleConnections();
      server.closeAllConnections();
    }
  };

  const settleWait = (fn: () => void) => {
    if (state.settled) return;
    state.settled = true;
    close();
    fn();
  };

  const armTimeoutAndAbort = () => {
    state.timeout = setTimeout(() => {
      settleWait(() =>
        rejectWait(
          new KiroSigninFlowError(
            "Kiro login timed out: the browser did not relay back to the callback server within 5 minutes. Try again.",
          ),
        ),
      );
    }, RELAY_TIMEOUT_MS);
    if (signal) {
      state.abortListener = () => {
        settleWait(() => rejectWait(new Error("Login cancelled")));
      };
      signal.addEventListener("abort", state.abortListener, { once: true });
    }
  };

  return { close, settleWait, armTimeoutAndAbort };
}

/** Build the handler that inspects the relayed browser request. */
function createRelayRequestHandler(
  settleWait: (fn: () => void) => void,
  resolveWait: (r: { code: string; state: string }) => void,
  rejectWait: (e: Error) => void,
) {
  return (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = new URL(req.url ?? "/", KIRO_SOCIAL_REDIRECT_URI);
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const error = url.searchParams.get("error");
      if (error) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(
          `<!DOCTYPE html><html><body>Kiro sign-in failed (error: ${escapeHtml(error)}). Return to your terminal and try again.</body></html>`,
        );
        settleWait(() =>
          rejectWait(
            new KiroSigninFlowError(
              `Kiro sign-in was rejected (error: ${error}). Please try again.`,
            ),
          ),
        );
        return;
      }
      if (req.method !== "GET" || !code || !state) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(
          `<!DOCTYPE html><html><body>Kiro callback: missing or invalid request (expected ?code=...&amp;state=... in the URL).</body></html>`,
        );
        // Don't settle — the user can retry from the sign-in tab.
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(RELAY_SUCCESS_HTML);
      settleWait(() => resolveWait({ code, state }));
    } catch (err) {
      settleWait(() =>
        rejectWait(
          new KiroSigninFlowError(
            `Kiro relay handler error: ${err instanceof Error ? err.message : String(err)}`,
          ),
        ),
      );
    }
  };
}

export function startKiroSigninRelay(
  signal?: AbortSignal,
): Promise<KiroSigninRelay> {
  return new Promise((resolveRelay, rejectRelay) => {
    const state: RelayState = { servers: [], settled: false };

    let resolveWait!: (r: { code: string; state: string }) => void;
    let rejectWait!: (e: Error) => void;
    const waitForRelay = new Promise<{ code: string; state: string }>(
      (res, rej) => {
        resolveWait = res;
        rejectWait = rej;
      },
    );
    // The caller may not await `waitForRelay` on every branch; keep
    // unhandled-rejection noise off the event loop.
    void waitForRelay.catch(() => {});

    const controller = createRelayController(state, rejectWait, signal);
    const handleRequest = createRelayRequestHandler(
      controller.settleWait,
      resolveWait,
      rejectWait,
    );

    // Mandatory IPv4 loopback bind.
    const primary = createServer(handleRequest);
    primary.once("error", (err: Error) => {
      primary.close();
      rejectRelay(
        new KiroSigninFlowError(
          `Could not bind the Kiro callback server on 127.0.0.1:${KIRO_SOCIAL_RELAY_PORT} (${err.message}). The social sign-in flow needs this fixed port — it is the redirect URI registered with Kiro's auth backend. If another Kiro client or a previous login is holding the port, close it and retry.`,
          true,
        ),
      );
    });
    primary.listen(KIRO_SOCIAL_RELAY_PORT, "127.0.0.1", () => {
      state.servers.push(primary);
      const addr = primary.address() as AddressInfo | null;
      _logger.info(
        `[relay] listening on 127.0.0.1:${addr?.port ?? KIRO_SOCIAL_RELAY_PORT} (5 min timeout)`,
      );
      controller.armTimeoutAndAbort();
      // Best-effort IPv6 loopback bind (browsers may resolve localhost to ::1).
      // The server is registered synchronously at listen() time (and
      // unregistered by the error handler) so a close() landing between
      // listen() and the async listening callback cannot leak it — a
      // leaked v6 relay would silently swallow a later login's browser
      // callback (its handler is a no-op on the already-settled state).
      const v6 = createServer(handleRequest);
      state.servers.push(v6);
      v6.once("error", () => {
        const idx = state.servers.indexOf(v6);
        if (idx >= 0) state.servers.splice(idx, 1);
        v6.close();
        _logger.debug("[relay] [::1] bind unavailable (IPv6 loopback skipped)");
      });
      v6.listen(KIRO_SOCIAL_RELAY_PORT, "::1", () => {
        _logger.debug("[relay] [::1] listening (IPv6 loopback)");
      });
      resolveRelay({ waitForRelay, close: controller.close });
    });
  });
}

// =============================================================================
// Social login attempt
// =============================================================================

/** One social sign-in attempt: the authorize URL to open plus the relay capturing the result. */
export interface KiroSocialLoginAttempt {
  /** The IdP authorize URL to show to the user. */
  authorizeUrl: string;
  /** The PKCE pair behind the URL (state verification + exchange). */
  pkce: PkcePair;
  /** The relay capturing the portal's redirect. */
  relay: KiroSigninRelay;
}

/**
 * Start a social (Google/Github) sign-in attempt: generate the PKCE pair,
 * bind the loopback relay, and call `InitiateLogin` with the loopback
 * redirect URI to get the authorize URL. The relay is bound *before*
 * `InitiateLogin` so the browser can never hit a closed port even on a
 * fast redirect.
 *
 * Throws `KiroSigninFlowError` (with `isBindFailure: true`) when the relay
 * port cannot bind, and propagates `KiroWebPortalHttpError`/
 * `KiroWebPortalServiceError` from `InitiateLogin` — the caller decides
 * whether to fall back to the manual-paste flow.
 */
export async function startKiroSocialLoginAttempt(args: {
  idp: KiroIdp;
  signal?: AbortSignal;
}): Promise<KiroSocialLoginAttempt> {
  if (!KIRO_SOCIAL_IDPS.includes(args.idp)) {
    throw new KiroSigninFlowError(
      `The automatic relay flow supports only ${KIRO_SOCIAL_IDPS.join(" and ")}; ${args.idp} uses the manual-paste flow.`,
    );
  }
  const pkce = generatePkce();
  const relay = await startKiroSigninRelay(args.signal);
  try {
    const init = await webPortalInitiateLogin({
      idp: args.idp,
      codeChallenge: pkce.codeChallenge,
      state: pkce.state,
      redirectUri: KIRO_SOCIAL_REDIRECT_URI,
      signal: args.signal,
    });
    _logger.info(`[signin] ${args.idp} authorize URL issued (relay bound)`);
    return { authorizeUrl: init.redirectUrl, pkce, relay };
  } catch (err) {
    relay.close();
    throw err;
  }
}

// =============================================================================
// Token exchange
// =============================================================================

/** The raw social token-exchange outcome, before credential assembly. */
export interface KiroSigninTokenResult {
  accessToken: string;
  /** The refresh token from the response body. */
  refreshToken?: string;
  /** Seconds until `accessToken` expires. */
  expiresIn: number;
  /** The Kiro profileArn — the field that makes streaming work (PR #485). */
  profileArn?: string;
}

/**
 * Exchange a relayed authorization code for Kiro tokens. Request shape
 * matches the Kiro IDE client: JSON
 * `{ code, code_verifier, redirect_uri }`; the response is JSON
 * `{ accessToken, refreshToken, profileArn, expiresIn }`.
 */
export async function exchangeKiroSocialCode(args: {
  code: string;
  codeVerifier: string;
  signal?: AbortSignal;
}): Promise<KiroSigninTokenResult> {
  let response: Response;
  try {
    response = await fetch(KIRO_SOCIAL_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        code: args.code,
        code_verifier: args.codeVerifier,
        redirect_uri: KIRO_SOCIAL_REDIRECT_URI,
      }),
      signal: args.signal
        ? AbortSignal.any([args.signal, AbortSignal.timeout(TOKEN_TIMEOUT_MS)])
        : AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    });
  } catch (error) {
    if (args.signal?.aborted) {
      throw new Error("Login cancelled");
    }
    throw new KiroSigninFlowError(
      `Kiro token exchange request failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const bodyText = await response.text().catch(() => "");
  let data: Partial<KiroSigninTokenResult> & { message?: string };
  try {
    data = bodyText ? (JSON.parse(bodyText) as typeof data) : {};
  } catch {
    data = {};
  }

  if (!response.ok || !data.accessToken) {
    const message = typeof data.message === "string" ? data.message : "";
    throw new KiroSigninFlowError(
      `Kiro token exchange failed: ${response.status} ${response.statusText}${
        message ? ` (${message})` : ""
      }`,
    );
  }

  const rawExpiresIn = data.expiresIn;
  const expiresIn =
    typeof rawExpiresIn === "number" && rawExpiresIn > 0
      ? rawExpiresIn
      : DEFAULT_EXPIRES_IN_S;
  if (typeof rawExpiresIn !== "number") {
    _logger.debug(
      `[exchange] response omitted expiresIn — defaulting to ${DEFAULT_EXPIRES_IN_S}s`,
    );
  }

  const result: KiroSigninTokenResult = {
    accessToken: data.accessToken,
    expiresIn,
  };
  if (data.refreshToken) result.refreshToken = data.refreshToken;
  if (data.profileArn) result.profileArn = data.profileArn;
  return result;
}
