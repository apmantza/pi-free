/**
 * Minimal CBOR encode/decode wrapper for the Kiro Web Portal.
 *
 * The Kiro Web Portal (`app.kiro.dev/service/KiroWebPortalService/...`) speaks
 * Smithy `rpc-v2-cbor`. The CBOR module is internal to `@smithy/core` and
 * blocked by their `exports` field, so we use `cbor-x` (a popular standalone
 * implementation, ~50KB unpacked, RFC 8949 conformant).
 *
 * The Kiro Web Portal responses are flat CBOR maps with no envelope wrapper
 * (the `Output`/`Version` envelope only appears in the JSON-path error
 * responses, which we never parse as CBOR — the error path is handled by
 * `decodeError` which expects the Coral error shape directly).
 *
 * Per design doc Phase B: this is the only file in the kiro module that
 * imports `cbor-x` directly. Higher-level modules (Phase C/D) call the
 * typed encode/decode helpers exposed here, so a future CBOR library
 * change is a one-file diff.
 */

import { encode as cborEncode, decode as cborDecode } from "cbor-x";

// =============================================================================
// Constants
// =============================================================================

/**
 * The Kiro Web Portal root. Operations live under
 * `/service/KiroWebPortalService/operation/{op}`.
 */
export const KIRO_WEB_PORTAL = "https://app.kiro.dev";

/** `idp` values the Portal accepts. Internal is excluded — not relevant for pi-free users. */
export const KIRO_IDP_VALUES = [
  "BuilderId",
  "Google",
  "Github",
  "AWSIdC",
] as const;
export type KiroIdp = (typeof KIRO_IDP_VALUES)[number];

// =============================================================================
// InitiateLogin
// =============================================================================

export interface InitiateLoginInput {
  idp: KiroIdp;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  state: string;
}

export interface InitiateLoginOutput {
  /** The AWS SSO authorize URL the user opens in their browser. */
  redirectUrl: string;
  /** Set when the caller is already authenticated; identifies the SSO application. */
  applicationArn?: string;
  /** Set alongside applicationArn; the SSO instance region. */
  instanceRegion?: string;
}

/** CBOR-encode an InitiateLogin request body. */
export function encodeInitiateLogin(input: InitiateLoginInput): Uint8Array {
  return cborEncode(input);
}

/** Decode an InitiateLogin 200 response (flat CBOR map). */
export function decodeInitiateLogin(buffer: Uint8Array): InitiateLoginOutput {
  const decoded = cborDecode(buffer) as Partial<InitiateLoginOutput>;
  if (typeof decoded.redirectUrl !== "string") {
    throw new KiroWebPortalShapeError(
      "InitiateLogin response missing required `redirectUrl` field",
    );
  }
  return decoded as InitiateLoginOutput;
}

// =============================================================================
// ExchangeToken
// =============================================================================

export interface ExchangeTokenInput {
  idp: KiroIdp;
  code: string;
  codeVerifier: string;
  redirectUri: string;
  state: string;
}

export interface ExchangeTokenOutput {
  accessToken: string;
  /** The Portal's CSRF token; included in some auth-protected downstream calls. */
  csrfToken?: string;
  /** Seconds until `accessToken` expires. */
  expiresIn: number;
  /**
   * The Kiro profileArn associated with the credential. This is the field
   * that fixes the 400 'Improperly formed request' error from the Kiro
   * streaming endpoint (PR #485).
   */
  profileArn?: string;
}

/** CBOR-encode an ExchangeToken request body. */
export function encodeExchangeToken(input: ExchangeTokenInput): Uint8Array {
  return cborEncode(input);
}

/** Decode an ExchangeToken 200 response. */
export function decodeExchangeToken(buffer: Uint8Array): ExchangeTokenOutput {
  const decoded = cborDecode(buffer) as Partial<ExchangeTokenOutput>;
  if (typeof decoded.accessToken !== "string") {
    throw new KiroWebPortalShapeError(
      "ExchangeToken response missing required `accessToken` field",
    );
  }
  if (typeof decoded.expiresIn !== "number") {
    throw new KiroWebPortalShapeError(
      "ExchangeToken response missing required `expiresIn` field",
    );
  }
  return decoded as ExchangeTokenOutput;
}

// =============================================================================
// GetUserInfo
// =============================================================================

export interface GetUserInfoInput {
  origin: "KIRO_IDE" | "AI_EDITOR";
}

export interface GetUserInfoOutput {
  status?: string;
  email?: string;
  userId?: string;
  subscriptionInfo?: Record<string, unknown>;
}

/** CBOR-encode a GetUserInfo request body. */
export function encodeGetUserInfo(input: GetUserInfoInput): Uint8Array {
  return cborEncode(input);
}

/** Decode a GetUserInfo 200 response. */
export function decodeGetUserInfo(buffer: Uint8Array): GetUserInfoOutput {
  return cborDecode(buffer) as GetUserInfoOutput;
}

// =============================================================================
// Error decoding
// =============================================================================

/**
 * Coral/Smithy error response shape. The Portal returns this when an
 * operation fails (4xx/5xx with Content-Type: application/cbor). The
 * `__type` carries the Smithy error code, `message` is human-readable.
 */
export interface KiroWebPortalError {
  __type: string;
  message?: string;
}

/**
 * Thrown by the typed decoders above when the response shape doesn't match
 * the expected contract. Distinct from a 4xx/5xx HTTP response — that is
 * handled by the caller (Phase C's `kiro-web-portal.ts`) which inspects
 * `response.status` first.
 */
export class KiroWebPortalShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KiroWebPortalShapeError";
  }
}

/**
 * Decode a 4xx/5xx response body. The Portal's Coral errors look like
 * `{ __type: "com.amazon.coral.service#ValidationException", message: "..." }`.
 * Returns a default `{ __type: "UnknownError" }` if the body can't be
 * decoded as a Coral error — caller can then fall back to surfacing the
 * raw status code.
 */
export function decodeError(buffer: Uint8Array): KiroWebPortalError {
  try {
    const decoded = cborDecode(buffer) as Partial<KiroWebPortalError>;
    if (typeof decoded.__type === "string") {
      return decoded as KiroWebPortalError;
    }
  } catch {
    // Fall through to the default
  }
  return { __type: "UnknownError" };
}

// =============================================================================
// Headers
// =============================================================================

/**
 * The Smithy rpc-v2-cbor protocol headers. Applied to every Portal
 * request from `kiro-web-portal.ts`.
 */
export const KIRO_WEB_PORTAL_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "Content-Type": "application/cbor",
  Accept: "application/cbor",
  "smithy-protocol": "rpc-v2-cbor",
});
