/**
 * Unit tests for `providers/kiro/kiro-web-portal-cbor.ts`.
 *
 * Per design doc Phase B: round-trip encode/decode of an InitiateLogin
 * and an ExchangeToken-shaped payload, including the `Output` envelope
 * (we use the Coral error envelope as a sanity check; successful
 * responses are flat maps).
 */

import { describe, expect, it } from "vitest";
import {
  KIRO_WEB_PORTAL_HEADERS,
  decodeError,
  decodeExchangeToken,
  decodeGetUserInfo,
  decodeInitiateLogin,
  encodeExchangeToken,
  encodeInitiateLogin,
  KiroWebPortalShapeError,
} from "../providers/kiro/kiro-web-portal-cbor.ts";
import { encode as cborEncode } from "cbor-x";

describe("kiro-web-portal-cbor — protocol headers", () => {
  it("exports the Smithy rpc-v2-cbor headers", () => {
    expect(KIRO_WEB_PORTAL_HEADERS["Content-Type"]).toBe("application/cbor");
    expect(KIRO_WEB_PORTAL_HEADERS.Accept).toBe("application/cbor");
    expect(KIRO_WEB_PORTAL_HEADERS["smithy-protocol"]).toBe("rpc-v2-cbor");
  });
});

describe("kiro-web-portal-cbor — InitiateLogin round-trip", () => {
  it("encodes an InitiateLogin payload as CBOR", () => {
    const input = {
      idp: "BuilderId" as const,
      redirectUri: "https://app.kiro.dev/signin/oauth",
      codeChallenge: "abc123-challenge-1234567890",
      codeChallengeMethod: "S256" as const,
      state: "test-state-uuid",
    };
    const encoded = encodeInitiateLogin(input);
    expect(encoded).toBeInstanceOf(Uint8Array);
    expect(encoded.length).toBeGreaterThan(0);
  });

  it("decodes a flat InitiateLogin 200 response", () => {
    // Mimics the live response shape confirmed by the throwaway probe.
    const liveResponse = {
      applicationArn:
        "arn:aws:sso::432677196278:application/ssoins-xxx/apl-xxx",
      instanceRegion: "us-east-1",
      redirectUrl:
        "https://us-east-1.signin.aws/platform/authorize?client_id=arn%3A...",
    };
    const buffer = cborEncode(liveResponse);
    const decoded = decodeInitiateLogin(buffer);
    expect(decoded.redirectUrl).toBe(liveResponse.redirectUrl);
    expect(decoded.applicationArn).toBe(liveResponse.applicationArn);
    expect(decoded.instanceRegion).toBe(liveResponse.instanceRegion);
  });

  it("decodes a minimal InitiateLogin response (no applicationArn)", () => {
    // A first-time user without an existing session gets just redirectUrl.
    const buffer = cborEncode({
      redirectUrl: "https://us-east-1.signin.aws/platform/authorize?...",
    });
    const decoded = decodeInitiateLogin(buffer);
    expect(decoded.redirectUrl).toContain("authorize");
    expect(decoded.applicationArn).toBeUndefined();
  });

  it("throws KiroWebPortalShapeError when redirectUrl is missing", () => {
    const buffer = cborEncode({ applicationArn: "arn:foo" });
    expect(() => decodeInitiateLogin(buffer)).toThrow(KiroWebPortalShapeError);
    expect(() => decodeInitiateLogin(buffer)).toThrow(/redirectUrl/);
  });
});

describe("kiro-web-portal-cbor — ExchangeToken round-trip", () => {
  it("encodes an ExchangeToken payload as CBOR", () => {
    const input = {
      idp: "BuilderId" as const,
      code: "abc-auth-code",
      codeVerifier: "abc-verifier-1234567890",
      redirectUri: "https://app.kiro.dev/signin/oauth",
      state: "test-state-uuid",
    };
    const encoded = encodeExchangeToken(input);
    expect(encoded).toBeInstanceOf(Uint8Array);
    expect(encoded.length).toBeGreaterThan(0);
  });

  it("decodes a full ExchangeToken 200 response with profileArn", () => {
    // The field that fixes the 400 'Improperly formed request' bug.
    const liveResponse = {
      accessToken: "aoaEXAMPLE123",
      csrfToken: "csrf-abc123",
      expiresIn: 3600,
      profileArn: "arn:aws:codewhisperer:us-east-1:123456789:profile/ABCDE",
    };
    const buffer = cborEncode(liveResponse);
    const decoded = decodeExchangeToken(buffer);
    expect(decoded.accessToken).toBe("aoaEXAMPLE123");
    expect(decoded.csrfToken).toBe("csrf-abc123");
    expect(decoded.expiresIn).toBe(3600);
    expect(decoded.profileArn).toBe(
      "arn:aws:codewhisperer:us-east-1:123456789:profile/ABCDE",
    );
  });

  it("decodes a minimal ExchangeToken response (no csrfToken, no profileArn)", () => {
    const buffer = cborEncode({ accessToken: "aoa...", expiresIn: 604800 });
    const decoded = decodeExchangeToken(buffer);
    expect(decoded.accessToken).toBe("aoa...");
    expect(decoded.expiresIn).toBe(604800);
    expect(decoded.csrfToken).toBeUndefined();
    expect(decoded.profileArn).toBeUndefined();
  });

  it("throws KiroWebPortalShapeError when accessToken is missing", () => {
    const buffer = cborEncode({ expiresIn: 3600 });
    expect(() => decodeExchangeToken(buffer)).toThrow(KiroWebPortalShapeError);
    expect(() => decodeExchangeToken(buffer)).toThrow(/accessToken/);
  });

  it("throws KiroWebPortalShapeError when expiresIn is missing", () => {
    const buffer = cborEncode({ accessToken: "aoa..." });
    expect(() => decodeExchangeToken(buffer)).toThrow(KiroWebPortalShapeError);
    expect(() => decodeExchangeToken(buffer)).toThrow(/expiresIn/);
  });
});

describe("kiro-web-portal-cbor — GetUserInfo decode", () => {
  it("decodes a status-only response", () => {
    // The live response confirmed this shape for a "Stale" credential.
    const buffer = cborEncode({ status: "Stale" });
    const decoded = decodeGetUserInfo(buffer);
    expect(decoded.status).toBe("Stale");
  });

  it("decodes a populated user info response", () => {
    const buffer = cborEncode({
      status: "Active",
      email: "user@example.com",
      userId: "user-abc123",
      subscriptionInfo: { tier: "Free", quota: 100 },
    });
    const decoded = decodeGetUserInfo(buffer);
    expect(decoded.email).toBe("user@example.com");
    expect(decoded.userId).toBe("user-abc123");
    expect(decoded.subscriptionInfo).toEqual({ tier: "Free", quota: 100 });
  });
});

describe("kiro-web-portal-cbor — error decoding", () => {
  it("decodes a Coral ValidationException", () => {
    // The actual error shape confirmed by the throwaway probe.
    const buffer = cborEncode({
      __type: "com.amazon.coral.service#ValidationException",
      message: "Invalid parameter: idp",
    });
    const decoded = decodeError(buffer);
    expect(decoded.__type).toBe("com.amazon.coral.service#ValidationException");
    expect(decoded.message).toBe("Invalid parameter: idp");
  });

  it("decodes an UnknownOperationException", () => {
    const buffer = cborEncode({
      __type: "com.amazon.coral.service#UnknownOperationException",
    });
    const decoded = decodeError(buffer);
    expect(decoded.__type).toBe(
      "com.amazon.coral.service#UnknownOperationException",
    );
  });

  it("falls back to UnknownError on undecodable bytes", () => {
    // Random bytes that don't form a valid CBOR map with __type.
    const buffer = new Uint8Array([0xff, 0xfe, 0xfd, 0xfc]);
    const decoded = decodeError(buffer);
    expect(decoded.__type).toBe("UnknownError");
  });

  it("returns UnknownError when body is a CBOR map without __type", () => {
    const buffer = cborEncode({ message: "something" });
    const decoded = decodeError(buffer);
    expect(decoded.__type).toBe("UnknownError");
  });
});
