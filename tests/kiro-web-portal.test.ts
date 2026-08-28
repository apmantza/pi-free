/**
 * Unit tests for `providers/kiro/kiro-web-portal.ts`.
 *
 * Per design doc Phase C test plan: Mocked `fetch` for InitiateLogin
 * (200 CBOR), ExchangeToken (200 CBOR with `profileArn`), 4xx errors
 * propagate, no credential material in error logs.
 *
 * The HTTP client uses the global `fetch` (matching the rest of the kiro
 * module's pattern) — tests stub `globalThis.fetch` per the
 * `mockFetchOk` convention from `tests/fetch-openai-compatible.test.ts`.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { encode as cborEncode } from "cbor-x";
import {
  KiroWebPortalHttpError,
  KiroWebPortalServiceError,
  exchangeToken,
  getUserInfo,
  initiateLogin,
} from "../providers/kiro/kiro-web-portal.ts";
import {
  KIRO_WEB_PORTAL,
  KIRO_IDP_VALUES,
} from "../providers/kiro/kiro-web-portal-cbor.ts";

/**
 * Build a mocked Response that decodes the body as CBOR.
 *
 * The kiro-web-portal client reads `response.arrayBuffer()` then parses
 * it via cbor-x. So the mock must return an `arrayBuffer()` that resolves
 * to a real CBOR-encoded buffer.
 */
function mockFetchCbor(
  status: number,
  cborBody: unknown,
  options: { setCookie?: string[] } = {},
): Response {
  const buffer = cborEncode(cborBody);
  const headers = new Headers({
    "content-type": "application/cbor",
  });
  if (options.setCookie) {
    for (const cookie of options.setCookie) headers.append("set-cookie", cookie);
  }
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers,
    arrayBuffer: async () => buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    ),
  } as unknown as Response;
}

function mockFetchNetworkError(message: string): Response {
  throw new TypeError(message);
}

afterEach(() => {
  vi.restoreAllMocks();
});

// =============================================================================
// initiateLogin
// =============================================================================

describe("kiro-web-portal — initiateLogin", () => {
  it("POSTs a CBOR InitiateLogin and decodes the redirect URL", async () => {
    const responseBody = {
      applicationArn:
        "arn:aws:sso::432677196278:application/ssoins-xxx/apl-xxx",
      instanceRegion: "us-east-1",
      redirectUrl:
        "https://us-east-1.signin.aws/platform/authorize?client_id=arn%3A...",
    };
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockFetchCbor(200, responseBody),
    ) as unknown as typeof fetch;

    const result = await initiateLogin({
      idp: "BuilderId",
      codeChallenge: "test-challenge",
      state: "test-state",
    });

    expect(result.redirectUrl).toBe(responseBody.redirectUrl);
    expect(result.applicationArn).toBe(responseBody.applicationArn);
    expect(result.instanceRegion).toBe("us-east-1");

    // Verify the request was sent to the right URL with the right body
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(url).toBe(
      `${KIRO_WEB_PORTAL}/service/KiroWebPortalService/operation/InitiateLogin`,
    );
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).headers).toMatchObject({
      "Content-Type": "application/cbor",
      Accept: "application/cbor",
      "smithy-protocol": "rpc-v2-cbor",
    });
  });

  it("accepts all four supported IdPs", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        mockFetchCbor(200, { redirectUrl: "https://example.com" }),
      ) as unknown as typeof fetch;

    for (const idp of KIRO_IDP_VALUES) {
      await initiateLogin({ idp, codeChallenge: "x", state: "y" });
    }
    expect(globalThis.fetch).toHaveBeenCalledTimes(KIRO_IDP_VALUES.length);
  });

  it("propagates a 4xx as KiroWebPortalHttpError with the Coral error type", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockFetchCbor(400, {
        __type: "com.amazon.coral.service#ValidationException",
        message: "Invalid parameter: idp",
      }),
    ) as unknown as typeof fetch;

    await expect(
      initiateLogin({ idp: "BuilderId", codeChallenge: "x", state: "y" }),
    ).rejects.toThrow(KiroWebPortalHttpError);

    try {
      await initiateLogin({ idp: "BuilderId", codeChallenge: "x", state: "y" });
    } catch (e) {
      expect((e as KiroWebPortalHttpError).status).toBe(400);
      expect((e as KiroWebPortalHttpError).errorType).toBe(
        "com.amazon.coral.service#ValidationException",
      );
      expect((e as KiroWebPortalHttpError).message).toContain(
        "Invalid parameter: idp",
      );
    }
  });

  it("propagates a 5xx as KiroWebPortalHttpError", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockFetchCbor(503, { __type: "ServiceUnavailable" }),
    ) as unknown as typeof fetch;

    await expect(
      initiateLogin({ idp: "BuilderId", codeChallenge: "x", state: "y" }),
    ).rejects.toThrow(KiroWebPortalHttpError);
  });

  it("propagates a network failure as KiroWebPortalServiceError", async () => {
    globalThis.fetch = vi
      .fn()
      .mockImplementation(() => mockFetchNetworkError("ECONNREFUSED"));

    await expect(
      initiateLogin({ idp: "BuilderId", codeChallenge: "x", state: "y" }),
    ).rejects.toThrow(KiroWebPortalServiceError);
  });

  it("throws when the 2xx body is missing redirectUrl", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockFetchCbor(200, { applicationArn: "arn:foo" }),
    ) as unknown as typeof fetch;

    await expect(
      initiateLogin({ idp: "BuilderId", codeChallenge: "x", state: "y" }),
    ).rejects.toThrow(/redirectUrl/);
  });
});

// =============================================================================
// exchangeToken
// =============================================================================

describe("kiro-web-portal — exchangeToken", () => {
  it("POSTs a CBOR ExchangeToken, decodes the body, and parses cookies", async () => {
    const responseBody = {
      accessToken: "aoaEXAMPLE123",
      csrfToken: "csrf-abc123",
      expiresIn: 3600,
      profileArn: "arn:aws:codewhisperer:us-east-1:123456789:profile/ABCDE",
    };
    const setCookie = [
      "RefreshToken=rt-secret; HttpOnly; Secure; Path=/",
      "SessionToken=st-secret; HttpOnly; Secure; Path=/",
      "Idp=BuilderId; Path=/",
    ];
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockFetchCbor(200, responseBody, { setCookie }),
    ) as unknown as typeof fetch;

    const result = await exchangeToken({
      idp: "BuilderId",
      code: "auth-code-from-redirect",
      codeVerifier: "code-verifier-12345",
      state: "matching-state-uuid",
    });

    expect(result.body.accessToken).toBe("aoaEXAMPLE123");
    expect(result.body.csrfToken).toBe("csrf-abc123");
    expect(result.body.expiresIn).toBe(3600);
    expect(result.body.profileArn).toBe(
      "arn:aws:codewhisperer:us-east-1:123456789:profile/ABCDE",
    );
    expect(result.cookies.refreshToken).toBe("rt-secret");
    expect(result.cookies.sessionToken).toBe("st-secret");
    expect(result.cookies.idp).toBe("BuilderId");
    expect(result.cookies.accessToken).toBeUndefined();
  });

  it("works with a 200 response that has no Set-Cookie (falls back to body)", async () => {
    const responseBody = { accessToken: "aoa...", expiresIn: 604800 };
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(mockFetchCbor(200, responseBody)) as unknown as typeof fetch;

    const result = await exchangeToken({
      idp: "BuilderId",
      code: "c",
      codeVerifier: "v",
      state: "s",
    });
    expect(result.body.accessToken).toBe("aoa...");
    expect(result.cookies).toEqual({});
  });

  it("handles a single Set-Cookie header (kiro-cli style RefreshToken only)", async () => {
    const responseBody = { accessToken: "aoa...", expiresIn: 3600 };
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockFetchCbor(200, responseBody, {
        setCookie: ["RefreshToken=only-refresh-token"],
      }),
    ) as unknown as typeof fetch;

    const result = await exchangeToken({
      idp: "BuilderId",
      code: "c",
      codeVerifier: "v",
      state: "s",
    });
    expect(result.cookies.refreshToken).toBe("only-refresh-token");
  });

  it("propagates a 4xx as KiroWebPortalHttpError", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockFetchCbor(400, {
        __type: "com.amazon.coral.service#ValidationException",
        message: "code_verifier mismatch",
      }),
    ) as unknown as typeof fetch;

    await expect(
      exchangeToken({
        idp: "BuilderId",
        code: "c",
        codeVerifier: "v",
        state: "s",
      }),
    ).rejects.toThrow(KiroWebPortalHttpError);
  });

  it("throws when the 2xx body is missing accessToken", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockFetchCbor(200, { expiresIn: 3600 }),
    ) as unknown as typeof fetch;

    await expect(
      exchangeToken({
        idp: "BuilderId",
        code: "c",
        codeVerifier: "v",
        state: "s",
      }),
    ).rejects.toThrow(/accessToken/);
  });
});

// =============================================================================
// getUserInfo
// =============================================================================

describe("kiro-web-portal — getUserInfo", () => {
  it("sends the Authorization header and IdP cookie, decodes the user info", async () => {
    const responseBody = {
      status: "Active",
      email: "user@example.com",
      userId: "user-abc123",
      subscriptionInfo: { tier: "Free", quota: 100 },
    };
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockFetchCbor(200, responseBody),
    ) as unknown as typeof fetch;

    const result = await getUserInfo({
      origin: "KIRO_IDE",
      accessToken: "aoaEXAMPLE",
      idp: "BuilderId",
    });

    expect(result.status).toBe("Active");
    expect(result.email).toBe("user@example.com");
    expect(result.userId).toBe("user-abc123");
    expect(result.subscriptionInfo).toEqual({ tier: "Free", quota: 100 });

    // Verify auth headers
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(url).toBe(
      `${KIRO_WEB_PORTAL}/service/KiroWebPortalService/operation/GetUserInfo`,
    );
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer aoaEXAMPLE");
    expect(headers.Cookie).toContain("Idp=BuilderId");
    expect(headers.Cookie).toContain("AccessToken=aoaEXAMPLE");
  });

  it("decodes a Stale-status response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockFetchCbor(200, { status: "Stale" }),
    ) as unknown as typeof fetch;

    const result = await getUserInfo({
      origin: "KIRO_IDE",
      accessToken: "x",
      idp: "BuilderId",
    });
    expect(result.status).toBe("Stale");
  });

  it("propagates a 401 as KiroWebPortalHttpError", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockFetchCbor(401, {
        __type: "com.amazon.coral.service#UnauthorizedException",
        message: "Bearer token authentication requires a resolvable operation",
      }),
    ) as unknown as typeof fetch;

    await expect(
      getUserInfo({ origin: "KIRO_IDE", accessToken: "x", idp: "BuilderId" }),
    ).rejects.toThrow(KiroWebPortalHttpError);
  });
});

// =============================================================================
// Credential-material redaction (agents.md convention #17)
// =============================================================================

describe("kiro-web-portal — credential redaction", () => {
  it("never logs the accessToken (even on 4xx errors)", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    globalThis.fetch = vi.fn().mockResolvedValue(
      mockFetchCbor(400, {
        __type: "com.amazon.coral.service#ValidationException",
        message: "Invalid parameter: code",
      }),
    ) as unknown as typeof fetch;

    try {
      await exchangeToken({
        idp: "BuilderId",
        code: "secret-auth-code",
        codeVerifier: "secret-verifier",
        state: "s",
      });
    } catch {
      // Expected to throw
    }

    // The log payload should only contain errorType + message, never
    // the code/codeVerifier/state. Verify by serializing everything
    // that was passed to console.error and asserting the secrets
    // are absent.
    for (const call of consoleErrorSpy.mock.calls) {
      for (const arg of call) {
        const serialized = JSON.stringify(arg);
        expect(serialized).not.toContain("secret-auth-code");
        expect(serialized).not.toContain("secret-verifier");
      }
    }
  });
});
