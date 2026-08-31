/**
 * Kiro login flow driver — top-level login + refresh entry points that
 * `kiro-auth.ts` calls when `kiro_auth_method === "web-portal"` (or when
 * the user runs `/login kiro` on a fresh install).
 *
 * Two capture paths, selected by IdP (see `loginKiroDesktop`):
 *
 *   - Social relay (Google, Github — `kiro-signin-flow.ts`): automatic.
 *     A localhost relay binds the fixed port 3128 (the loopback URL
 *     registered with Kiro's Cognito app), `InitiateLogin` runs with that
 *     loopback redirect URI, and the browser comes back by itself after
 *     the user signs in. The code is exchanged at the IDE's social token
 *     endpoint (`/oauth/token`, JSON).
 *   - Manual paste (BuilderId, and the fallback for everything):
 *     `InitiateLogin` runs against the Portal's own redirect URI
 *     (`app.kiro.dev/signin/oauth` — the only value the AWS SSO leg
 *     accepts; every loopback redirect URI 401s at InitiateLogin time,
 *     which was the reported "Authentication required or access denied."
 *     error). The user pastes the final `?code=...&state=...` URL back
 *     and the CBOR `ExchangeToken` completes the flow.
 *
 * Both paths verify the returned `state` (CSRF protection per OAuth 2.0
 * §10.12), persist `profileArn` (the field that makes streaming work,
 * PR #485), and produce the same KiroCredentials shape (`idp`,
 * `profileArn`, `csrfToken`, `machineId`).
 *
 * Per the kiro-web-portal-auth design doc: this is the only file in the
 * kiro module that drives the login UX. Higher-level modules
 * (kiro-stream.ts, kiro-provider.ts) consume the returned
 * KiroCredentials shape unchanged.
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
import { hostname } from "node:os";
import type { AuthInteraction } from "@earendil-works/pi-ai";
import { createLogger } from "../../lib/logger.ts";
import { KIRO_WEB_PORTAL } from "./kiro-web-portal-cbor.ts";
import { generatePkce } from "./kiro-pkce.ts";
import {
  exchangeToken as webPortalExchangeToken,
  initiateLogin as webPortalInitiateLogin,
  KiroWebPortalHttpError,
} from "./kiro-web-portal.ts";
import type { KiroIdp } from "./kiro-web-portal-cbor.ts";
import {
  KIRO_SOCIAL_IDPS,
  KiroSigninFlowError,
  exchangeKiroSocialCode,
  startKiroSocialLoginAttempt,
} from "./kiro-signin-flow.ts";
import {
  KIRO_DESKTOP_REFRESH_URL,
  type KiroAuthMethod,
  type KiroCredentials,
} from "./kiro-auth.ts";

const _logger = createLogger("kiro-desktop-auth");

/** Same 5-minute buffer the existing `idc` flow uses. */
const EXPIRES_BUFFER_MS = 5 * 60 * 1000;

/**
 * How the browser redirect is captured.
 *
 *   - Social relay (automatic) — a localhost relay on the fixed port
 *     3128 (the loopback URL registered with Kiro's Cognito app) captures
 *     the portal redirect for the Cognito-backed social IdPs (Google,
 *     Github). Implemented in `kiro-signin-flow.ts`.
 *   - Manual paste — the user pastes the
 *     `app.kiro.dev/signin/oauth?code=...&state=...` URL back into Pi.
 *     The only option for BuilderId: the portal's AWS SSO leg rejects every
 *     loopback redirect URI at InitiateLogin time (verified live — that
 *     was the reported "Authentication required or access denied." error),
 *     so the flow must use the Portal's own redirect URI.
 */

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
// Manual-paste redirect parser
// =============================================================================

/**
 * Parse a `app.kiro.dev/signin/oauth?code=...&state=...` redirect URL into
 * its `code` and `state` query parameters. Tolerates surrounding whitespace
 * (the user might paste with a stray Enter).
 *
 * Used as the fallback when the social relay can't bind or when
 * `options.preferLocalhost === false`. Also the only capture path for
 * BuilderId, whose AWS SSO leg rejects every loopback redirect URI at
 * `InitiateLogin` time.
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
   * When true (default), social IdPs (Google, Github) try the automatic
   * localhost relay on the fixed port 3128 first. BuilderId always uses
   * the manual-paste path — its AWS SSO leg rejects every loopback
   * redirect URI at InitiateLogin time. When false, all IdPs go straight
   * to the manual-paste prompt.
   */
  preferLocalhost?: boolean;
}

/**
 * Manual-paste login: InitiateLogin against the Portal's own redirect URI
 * (`app.kiro.dev/signin/oauth` — the only redirect the AWS SSO leg
 * accepts, and the reliable fallback for every IdP), then the user pastes
 * the `?code=...&state=...` URL back and we run the CBOR ExchangeToken.
 * This is the v2.3.0 flow, restored as the BuilderId path and the
 * universal fallback.
 */
async function loginViaManualPaste(
  interaction: AuthInteraction,
  args: { idp: KiroIdp; region: string },
): Promise<KiroCredentials> {
  const { idp, region } = args;
  const pkce = generatePkce();

  // 1. InitiateLogin against the Portal's own redirect URI (the default —
  // no redirectUri override). The returned URL is what the user opens.
  const init = await webPortalInitiateLogin({
    idp,
    codeChallenge: pkce.codeChallenge,
    state: pkce.state,
    signal: interaction.signal,
  });

  if (interaction.signal?.aborted) {
    throw new Error("Login cancelled");
  }

  // 2. Show the URL and ask the user to paste the final redirect back.
  const instructions = [
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

  const pastedUrl = await interaction.prompt({
    type: "manual_code",
    message: "Paste the full redirect URL from your browser",
  });
  if (interaction.signal?.aborted) throw new Error("Login cancelled");
  const { code, state: returnedState } = parseKiroRedirectUrl(pastedUrl);

  // 3. CSRF check
  if (returnedState !== pkce.state) {
    // SECURITY: log a truncated state (first 8 chars) for debug, never
    // the full state value or the full pasted URL.
    _logger.error(
      `[loginViaManualPaste] state mismatch (returned first 8: ${returnedState.slice(0, 8)}...)`,
    );
    throw new KiroDesktopLoginError(
      "Kiro login failed: the returned URL's `state` parameter does not match what we generated. This usually means the URL was captured from a stale tab or a different login attempt. Please try again.",
    );
  }

  // 4. ExchangeToken (CBOR) — the redirect_uri must match InitiateLogin's
  // (the Portal's own, which is what the no-override default resolves to).
  const result = await webPortalExchangeToken({
    idp,
    code,
    codeVerifier: pkce.codeVerifier,
    state: pkce.state,
    signal: interaction.signal,
  });

  return buildKiroCredentials(result.body, result.cookies.refreshToken, {
    idp,
    region,
    clientId: init.applicationArn ?? "",
    csrfToken: result.body.csrfToken,
    expiresInSeconds: result.body.expiresIn,
  });
}

/**
 * Automatic relay login for the Cognito-backed social IdPs (Google,
 * Github): bind the loopback relay on the fixed port 3128, InitiateLogin
 * with the loopback redirect URI (which both the Portal and Cognito
 * accept), and capture the browser redirect automatically. The code is
 * exchanged at the IDE's social token endpoint (JSON) — no paste needed.
 */
async function loginViaSocialRelay(
  interaction: AuthInteraction,
  args: { idp: KiroIdp; region: string },
): Promise<KiroCredentials> {
  const { idp, region } = args;
  const attempt = await startKiroSocialLoginAttempt({
    idp,
    signal: interaction.signal,
  });

  try {
    const instructions = [
      `Open the URL above in your browser and sign in with ${idp}.`,
      `After signing in, the browser will come back automatically and Kiro will continue.`,
    ].join("\n");
    interaction.notify({
      type: "auth_url",
      url: attempt.authorizeUrl,
      instructions,
    });

    const { code, state } = await attempt.relay.waitForRelay;
    if (interaction.signal?.aborted) throw new Error("Login cancelled");

    // CSRF check (the relay verified nothing; the state match is ours).
    if (state !== attempt.pkce.state) {
      _logger.error(
        `[loginViaSocialRelay] state mismatch (returned first 8: ${state.slice(0, 8)}...)`,
      );
      throw new KiroDesktopLoginError(
        "Kiro login failed: the relayed `state` parameter does not match what we generated. This usually means the redirect came from a stale tab or a different login attempt. Please try again.",
      );
    }

    const tokens = await exchangeKiroSocialCode({
      code,
      codeVerifier: attempt.pkce.codeVerifier,
      signal: interaction.signal,
    });

    return buildKiroCredentials(tokens, tokens.refreshToken, {
      idp,
      region,
      // The social JSON exchange returns no applicationArn (that field is
      // specific to the Portal's SSO leg); the refresh path does not use it.
      clientId: "",
      csrfToken: undefined,
      expiresInSeconds: tokens.expiresIn,
    });
  } finally {
    attempt.relay.close();
  }
}

/**
 * Assemble the persisted credential from either flow's token outcome.
 * The "refresh" field carries the refresh token: the CBOR ExchangeToken
 * path returns it as a Set-Cookie (the body never carries it per the
 * Kiro Web Portal protocol), the social JSON path returns it in the body.
 * It MUST be present; otherwise the portal changed its contract.
 */
function buildKiroCredentials(
  tokens: { accessToken: string; profileArn?: string },
  refreshToken: string | undefined,
  args: {
    idp: KiroIdp;
    region: string;
    clientId: string;
    csrfToken?: string;
    expiresInSeconds: number;
  },
): KiroCredentials {
  if (!refreshToken) {
    // SECURITY: don't log the cookies or the accessToken.
    throw new KiroDesktopLoginError(
      "Kiro login succeeded but no refresh token was returned. The Kiro Web Portal may have changed its contract; try a different IdP or re-login.",
    );
  }

  const machineId = deriveMachineId();
  const credentials: KiroCredentials = {
    type: "oauth",
    access: tokens.accessToken,
    refresh: refreshToken,
    expires: Date.now() + args.expiresInSeconds * 1000 - EXPIRES_BUFFER_MS,
    clientId: args.clientId,
    clientSecret: "", // public-client flow, no clientSecret
    region: args.region,
    authMethod: "web-portal",
    ...(tokens.profileArn ? { profileArn: tokens.profileArn } : {}),
    ...(args.csrfToken ? { csrfToken: args.csrfToken } : {}),
    machineId,
    idp: args.idp,
  };

  _logger.info(
    `[loginKiroDesktop] ${args.idp} login complete (expires in ${args.expiresInSeconds}s, machineId ${machineId.slice(0, 8)}..., profileArn ${tokens.profileArn ? "set (last 20: ...'" + tokens.profileArn.slice(-20) + "')" : "absent"})`,
  );
  return credentials;
}

/**
 * Drive the full Kiro login flow. Returns a `KiroCredentials`
 * shape that includes `profileArn` (the field that fixes the
 * 400 'Improperly formed request' streaming error from PR #485).
 *
 * Path selection:
 *   - Social IdPs (Google, Github) with `preferLocalhost` (default):
 *     automatic loopback relay capture, with a fall back to the
 *     manual-paste flow when the fixed relay port cannot bind (the port
 *     is part of Kiro's registered redirect URI and cannot be randomized)
 *     or when InitiateLogin for the loopback redirect fails.
 *   - BuilderId (and everything with `preferLocalhost: false`):
 *     manual paste — the Portal's AWS SSO leg rejects every loopback
 *     redirect URI at InitiateLogin time (verified live; that was the
 *     reported "Authentication required or access denied." error).
 *
 * Throws `KiroDesktopLoginError` if the user cancels, the pasted URL
 * is invalid, the state doesn't match (CSRF), or the relay times out.
 */
export async function loginKiroDesktop(
  interaction: AuthInteraction,
  options: LoginKiroDesktopOptions = {},
): Promise<KiroCredentials> {
  const idp: KiroIdp = options.idp ?? "BuilderId";
  const region = options.region ?? "us-east-1";
  const preferLocalhost = options.preferLocalhost ?? true;

  _logger.info(`[loginKiroDesktop] starting ${idp} login flow`);

  if (preferLocalhost && KIRO_SOCIAL_IDPS.includes(idp)) {
    try {
      return await loginViaSocialRelay(interaction, { idp, region });
    } catch (err) {
      if (interaction.signal?.aborted) throw new Error("Login cancelled");
      // Fall back to manual paste only for recoverable setup failures:
      // the fixed relay port is taken (bind failure) or the Portal
      // rejected the loopback InitiateLogin. Everything else (state
      // mismatch, exchange failure, timeout) surfaces to the user.
      const recoverable =
        (err instanceof KiroSigninFlowError && err.isBindFailure) ||
        err instanceof KiroWebPortalHttpError;
      if (!recoverable) throw err;
      _logger.warn(
        `[loginKiroDesktop] social relay unavailable (${err instanceof Error ? err.message : String(err)}) — falling back to manual paste`,
      );
    }
  }

  return loginViaManualPaste(interaction, { idp, region });
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
