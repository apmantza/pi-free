/**
 * HTTP client for the Kiro Web Portal (`app.kiro.dev`).
 *
 * Three operations are needed for the Phase D login flow:
 *   1. `InitiateLogin` — start the PKCE auth flow, get a redirect URL
 *   2. `ExchangeToken` — trade the auth code for a Kiro auth token
 *   3. `GetUserInfo`   — fetch the user's email/subscription info
 *
 * This module is the pure HTTP layer. The browser-redirect loop, the
 * local HTTP listener, and the cookie extraction for `refreshToken`
 * live in `providers/kiro/kiro-auth.ts` (Phase D), because those
 * concerns depend on Pi's `AuthInteraction` and the generic
 * `OAuthLoginCallbacks` surface.
 *
 * Per design doc Phase C: this is the only file in the kiro module that
 * makes HTTP calls to the Kiro Web Portal. Higher-level modules call
 * the three exported functions and never touch `fetch` directly for
 * these endpoints, so a future URL change or transport swap is a
 * one-file diff.
 *
 * Logging rules (per `agents.md` convention #17):
 *   - `idp`, `region`, HTTP status codes, operation names: safe to log
 *   - `accessToken`, `refreshToken`, `code_verifier`, `code`, full
 *     `profileArn`: NEVER log
 *   - `profileArn` last 20 chars at debug level only, for change
 *     tracking (per the design doc's "Errors and observability" section)
 */

import { createLogger } from "../../lib/logger.ts";
import {
  KIRO_WEB_PORTAL,
  KIRO_WEB_PORTAL_HEADERS,
  decodeError,
  decodeExchangeToken,
  decodeGetUserInfo,
  decodeInitiateLogin,
  encodeExchangeToken,
  encodeGetUserInfo,
  encodeInitiateLogin,
  type ExchangeTokenInput,
  type ExchangeTokenOutput,
  type GetUserInfoInput,
  type GetUserInfoOutput,
  type InitiateLoginInput,
  type InitiateLoginOutput,
  type KiroIdp,
} from "./kiro-web-portal-cbor.ts";

const _logger = createLogger("kiro-web-portal");

// =============================================================================
// Errors
// =============================================================================

/** Thrown when the Kiro Web Portal returns a 4xx with a parseable Coral error. */
export class KiroWebPortalHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly errorType: string,
    readonly operation: string,
  ) {
    super(message);
    this.name = "KiroWebPortalHttpError";
  }
}

/** Thrown on 5xx, network failure, or unparseable error body. */
export class KiroWebPortalServiceError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "KiroWebPortalServiceError";
  }
}

// =============================================================================
// Internal: low-level POST
// =============================================================================

/**
 * POST a CBOR body to a Kiro Web Portal operation and return the raw
 * response. Throws a typed error on non-2xx so the caller can decide
 * whether to surface the Coral `__type` to the user.
 *
 * @internal
 */
async function postWebPortal(
  operation: string,
  body: Uint8Array,
  extraHeaders: Record<string, string> = {},
  signal?: AbortSignal,
): Promise<{
  status: number;
  buffer: Uint8Array;
  contentType: string;
  setCookieHeaders: readonly string[];
}> {
  const url = `${KIRO_WEB_PORTAL}/service/KiroWebPortalService/operation/${operation}`;
  const headers: Record<string, string> = {
    ...KIRO_WEB_PORTAL_HEADERS,
    ...extraHeaders,
  };

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal,
    });
  } catch (error) {
    _logger.error(`[${operation}] network error:`, {
      error: error instanceof Error ? error.message : String(error),
    });
    throw new KiroWebPortalServiceError(
      `Kiro Web Portal ${operation} request failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const buffer = new Uint8Array(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") ?? "";
  // `headers.getSetCookie()` is the spec-compliant accessor for the
  // potentially multi-valued `Set-Cookie` header. Available in Node 20+.
  const setCookieHeaders =
    typeof (response.headers as Headers & { getSetCookie?: () => string[] })
      .getSetCookie === "function"
      ? (
          response.headers as Headers & { getSetCookie: () => string[] }
        ).getSetCookie()
      : [];

  if (!response.ok) {
    // The error body is also CBOR (the Coral service returns the same
    // protocol for errors). Try to decode it; if it doesn't look like
    // a Coral error, fall back to a generic message.
    const errorBody = decodeError(buffer);
    _logger.error(`[${operation}] HTTP ${response.status}:`, {
      errorType: errorBody.__type,
      message: errorBody.message,
    });
    throw new KiroWebPortalHttpError(
      errorBody.message
        ? `Kiro Web Portal ${operation} failed: ${errorBody.message}`
        : `Kiro Web Portal ${operation} failed with status ${response.status}`,
      response.status,
      errorBody.__type,
      operation,
    );
  }

  return { status: response.status, buffer, contentType, setCookieHeaders };
}

// =============================================================================
// InitiateLogin
// =============================================================================

export interface InitiateLoginArgs {
  idp: KiroIdp;
  codeChallenge: string;
  state: string;
  /**
   * Our `redirect_uri` — the Kiro Web Portal will redirect the browser
   * to this URL after the user signs in. Defaults to
   * `${KIRO_WEB_PORTAL}/signin/oauth` (the Portal's own callback,
   * which the caller would have to capture manually). Callers that
   * run a local HTTP server (e.g. the desktop-auth flow's localhost
   * callback) should pass their own URL here.
   */
  redirectUri?: string;
  signal?: AbortSignal;
}

/**
 * Start the PKCE auth flow. The returned `redirectUrl` is what the user
 * opens in their browser. The caller (Phase D) verifies the returned
 * `applicationArn` (when present) belongs to the expected account.
 */
export async function initiateLogin(
  args: InitiateLoginArgs,
): Promise<InitiateLoginOutput> {
  const input: InitiateLoginInput = {
    idp: args.idp,
    redirectUri: args.redirectUri ?? KIRO_WEB_PORTAL_REDIRECT_URI,
    codeChallenge: args.codeChallenge,
    codeChallengeMethod: "S256",
    state: args.state,
  };
  const { buffer } = await postWebPortal(
    "InitiateLogin",
    encodeInitiateLogin(input),
    {},
    args.signal,
  );
  const output = decodeInitiateLogin(buffer);
  _logger.info(`[InitiateLogin] ${args.idp} → redirect URL issued`);
  return output;
}

// =============================================================================
// ExchangeToken
// =============================================================================

export interface ExchangeTokenArgs {
  idp: KiroIdp;
  /** The `code` query parameter from the browser-redirected URL. */
  code: string;
  /** The PKCE `code_verifier` from the original `InitiateLogin` call. */
  codeVerifier: string;
  /**
   * Must match the `redirect_uri` passed to `InitiateLogin` (per
   * OAuth 2.0 §4.1.3). Defaults to the Portal's own callback for
   * backward compat with the no-callback-server callers.
   */
  redirectUri?: string;
  state: string;
  signal?: AbortSignal;
}

export interface ExchangeTokenResult {
  /** The decoded CBOR body. Contains `accessToken`, `expiresIn`, and
   * optionally `csrfToken` and `profileArn`. */
  body: ExchangeTokenOutput;

  /**
   * Cookies extracted from the response's `Set-Cookie` headers. The
   * Portal returns the `RefreshToken` and `SessionToken` as cookies,
   * not in the body (confirmed by the kiro-auto-register Python ref
   * and live probing). Caller should persist these as part of the
   * Kiro credential so the refresh path can use them.
   */
  cookies: {
    refreshToken?: string;
    sessionToken?: string;
    accessToken?: string;
    idp?: string;
  };
}

/**
 * Parse `Set-Cookie` headers into a flat key→value map. The Portal's
 * cookies don't carry the `Domain`/`Path`/`Expires`/`HttpOnly`/`Secure`
 * attributes we care about for the refresh path; we only need the
 * name→value mapping.
 *
 * @internal
 */
function parseSetCookieHeaders(headers: readonly string[]): {
  refreshToken?: string;
  sessionToken?: string;
  accessToken?: string;
  idp?: string;
} {
  const result: {
    refreshToken?: string;
    sessionToken?: string;
    accessToken?: string;
    idp?: string;
  } = {};
  for (const raw of headers) {
    // Each Set-Cookie value looks like "Name=Value; Attr1; Attr2".
    // We only care about the first `Name=Value` segment.
    const firstSegment = raw.split(";")[0]?.trim() ?? "";
    const eq = firstSegment.indexOf("=");
    if (eq < 0) continue;
    const name = firstSegment.slice(0, eq).trim();
    const value = firstSegment.slice(eq + 1).trim();
    if (!name || !value) continue;
    if (name === "RefreshToken") result.refreshToken = value;
    else if (name === "SessionToken") result.sessionToken = value;
    else if (name === "AccessToken") result.accessToken = value;
    else if (name === "Idp") result.idp = value;
  }
  return result;
}

/**
 * Trade the auth code for a Kiro auth token. Returns both the CBOR body
 * (which has `accessToken`, `expiresIn`, optional `profileArn`) and the
 * cookies (which carry the `RefreshToken` for the refresh path).
 */
export async function exchangeToken(
  args: ExchangeTokenArgs,
): Promise<ExchangeTokenResult> {
  const input: ExchangeTokenInput = {
    idp: args.idp,
    code: args.code,
    codeVerifier: args.codeVerifier,
    redirectUri: args.redirectUri ?? KIRO_WEB_PORTAL_REDIRECT_URI,
    state: args.state,
  };

  const { buffer, status, setCookieHeaders } = await postWebPortal(
    "ExchangeToken",
    encodeExchangeToken(input),
    {},
    args.signal,
  );

  const body = decodeExchangeToken(buffer);
  const cookies = parseSetCookieHeaders(setCookieHeaders);

  // Log profileArn at debug level with last-20-char truncation
  // (per design doc's "Errors and observability" section). Never log
  // the accessToken or any other credential material.
  if (body.profileArn) {
    _logger.debug(
      `[ExchangeToken] ${args.idp} → access token issued (profileArn ends ...${body.profileArn.slice(-20)})`,
    );
  } else {
    _logger.debug(
      `[ExchangeToken] ${args.idp} → access token issued (no profileArn in response)`,
    );
  }
  _logger.info(
    `[ExchangeToken] ${args.idp} → access token (${body.accessToken.length} chars, expires in ${body.expiresIn}s, status ${status}, cookies: refreshToken=${Boolean(cookies.refreshToken)}, sessionToken=${Boolean(cookies.sessionToken)})`,
  );

  return { body, cookies };
}

// =============================================================================
// GetUserInfo
// =============================================================================

export interface GetUserInfoArgs {
  origin: GetUserInfoInput["origin"];
  /** The Kiro `accessToken` to authenticate the request. */
  accessToken: string;
  /** The IdP the token was issued for. */
  idp: KiroIdp;
  signal?: AbortSignal;
}

/**
 * Fetch the user's email, userId, and subscription info. Requires the
 * access token from a prior `ExchangeToken` call.
 */
export async function getUserInfo(
  args: GetUserInfoArgs,
): Promise<GetUserInfoOutput> {
  const input: GetUserInfoInput = { origin: args.origin };

  // The Portal expects both an Authorization header and an IdP cookie
  // for the authenticated session. The cookie is informational; the
  // bearer is the source of truth.
  const cookies = `Idp=${args.idp}; AccessToken=${args.accessToken}`;

  const { buffer } = await postWebPortal(
    "GetUserInfo",
    encodeGetUserInfo(input),
    {
      Authorization: `Bearer ${args.accessToken}`,
      Cookie: cookies,
    },
    args.signal,
  );

  const output = decodeGetUserInfo(buffer);
  _logger.info(
    `[GetUserInfo] ${args.idp} → user info retrieved (status: ${output.status ?? "Active"})`,
  );
  return output;
}

// =============================================================================
// Internal helpers
// =============================================================================

/** The redirect URI registered with the Kiro Web Portal. */
const KIRO_WEB_PORTAL_REDIRECT_URI = `${KIRO_WEB_PORTAL}/signin/oauth`;
