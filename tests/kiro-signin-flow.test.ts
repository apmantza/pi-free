/**
 * Unit tests for `providers/kiro/kiro-signin-flow.ts` — the automatic
 * loopback relay for the Cognito-backed social IdPs (Google, Github).
 *
 * Covers: relay request handling (code relay, IdP error relay, malformed
 * requests), the social login attempt starter (IdP guard, InitiateLogin
 * wiring, relay-before-init ordering), the token exchange (shape
 * normalization, error surface), and credential-material redaction
 * (agents.md convention #17).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { decode as cborDecode, encode as cborEncode } from "cbor-x";
import {
  KIRO_SOCIAL_IDPS,
  KIRO_SOCIAL_REDIRECT_URI,
  KiroSigninFlowError,
  exchangeKiroSocialCode,
  startKiroSocialLoginAttempt,
  startKiroSigninRelay,
} from "../providers/kiro/kiro-signin-flow.ts";
import { KiroWebPortalHttpError } from "../providers/kiro/kiro-web-portal.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

// =============================================================================
// Constants
// =============================================================================

describe("kiro-signin-flow — constants", () => {
  it("exposes exactly the Cognito-backed social IdPs", () => {
    expect(KIRO_SOCIAL_IDPS).toEqual(["Google", "Github"]);
  });

  it("uses the fixed loopback redirect the Cognito allowlist holds", () => {
    expect(KIRO_SOCIAL_REDIRECT_URI).toBe(
      "http://localhost:3128/oauth/callback",
    );
  });
});

// =============================================================================
// Relay request handling
// =============================================================================

describe("kiro-signin-flow — relay request handling", () => {
  it("resolves with code and state on a valid relayed callback", async () => {
    const relay = await startKiroSigninRelay();
    try {
      const waitP = relay.waitForRelay;
      const res = await fetch(
        "http://127.0.0.1:3128/oauth/callback?code=relay-code&state=relay-state",
      );
      expect(res.status).toBe(200);
      await expect(waitP).resolves.toEqual({
        code: "relay-code",
        state: "relay-state",
      });
    } finally {
      relay.close();
    }
  });

  it("rejects with the relayed IdP error", async () => {
    const relay = await startKiroSigninRelay();
    try {
      const waitP = relay.waitForRelay;
      await fetch("http://127.0.0.1:3128/oauth/callback?error=access_denied");
      await expect(waitP).rejects.toThrow(/access_denied/);
    } finally {
      relay.close();
    }
  });

  it("responds 400 and stays pending on a malformed hit", async () => {
    const relay = await startKiroSigninRelay();
    try {
      const waitP = relay.waitForRelay;
      const res = await fetch("http://127.0.0.1:3128/oauth/callback");
      expect(res.status).toBe(400);
      // Still pending — prove it with a race against a microtask tick.
      let settled = false;
      waitP.then(
        () => (settled = true),
        () => (settled = true),
      );
      await new Promise((r) => setTimeout(r, 25));
      expect(settled).toBe(false);
      // A second, valid hit still resolves the one-shot.
      await fetch("http://127.0.0.1:3128/oauth/callback?code=c2&state=s2");
      await expect(waitP).resolves.toEqual({ code: "c2", state: "s2" });
    } finally {
      relay.close();
    }
  });

  it("rejects with Login cancelled when the signal aborts", async () => {
    const controller = new AbortController();
    const relay = await startKiroSigninRelay(controller.signal);
    try {
      const waitP = relay.waitForRelay;
      controller.abort();
      await expect(waitP).rejects.toThrow("Login cancelled");
    } finally {
      relay.close();
    }
  });

  it("closes idempotently and frees the port for a rebind", async () => {
    const relay1 = await startKiroSigninRelay();
    relay1.close();
    relay1.close();
    const relay2 = await startKiroSigninRelay();
    relay2.close();
  });

  it("rejects with a bind-failure KiroSigninFlowError when port 3128 is occupied", async () => {
    // Occupy the fixed port so the relay's mandatory 127.0.0.1 bind fails.
    const { createServer } = await import("node:http");
    const blocker = createServer();
    await new Promise<void>((resolve) =>
      blocker.listen(3128, "127.0.0.1", resolve),
    );
    try {
      let rejection: unknown;
      try {
        await startKiroSigninRelay();
      } catch (err) {
        rejection = err;
      }
      expect(rejection).toBeInstanceOf(KiroSigninFlowError);
      expect((rejection as KiroSigninFlowError).isBindFailure).toBe(true);
      expect((rejection as Error).message).toMatch(/Could not bind/);
    } finally {
      blocker.close();
      blocker.closeAllConnections();
    }
    // With the blocker gone, a fresh relay binds — proving the failed
    // attempt left no residual state on the port.
    const retry = await startKiroSigninRelay();
    retry.close();
  });
});

// =============================================================================
// startKiroSocialLoginAttempt
// =============================================================================

describe("kiro-signin-flow — startKiroSocialLoginAttempt", () => {
  it("rejects non-social IdPs before any I/O", async () => {
    await expect(
      startKiroSocialLoginAttempt({ idp: "BuilderId" }),
    ).rejects.toThrow(/supports only Google and Github/);
    await expect(
      startKiroSocialLoginAttempt({ idp: "AWSIdC" }),
    ).rejects.toThrow(/supports only Google and Github/);
  });

  it("calls InitiateLogin with the loopback redirect URI and returns the authorize URL", async () => {
    const { KIRO_WEB_PORTAL } = await import(
      "../providers/kiro/kiro-web-portal-cbor.ts"
    );
    const initResponse = {
      redirectUrl: "https://cognito.example/authorize?fetched=1",
    };
    const encoded = cborEncode(initResponse);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/cbor" }),
      arrayBuffer: async () =>
        encoded.buffer.slice(
          encoded.byteOffset,
          encoded.byteOffset + encoded.byteLength,
        ),
    } as unknown as Response) as unknown as typeof fetch;

    const attempt = await startKiroSocialLoginAttempt({ idp: "Google" });
    try {
      expect(attempt.authorizeUrl).toBe(initResponse.redirectUrl);

      // InitiateLogin was called once, with the loopback redirect URI.
      const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls).toHaveLength(1);
      const [url, init] = calls[0] as [string, RequestInit];
      expect(url).toBe(
        `${KIRO_WEB_PORTAL}/service/KiroWebPortalService/operation/InitiateLogin`,
      );
      const body = cborDecode(init.body as Uint8Array) as Record<
        string,
        unknown
      >;
      expect(body.idp).toBe("Google");
      expect(body.redirectUri).toBe("http://localhost:3128/oauth/callback");
      expect(body.codeChallengeMethod).toBe("S256");
      expect(typeof body.state).toBe("string");
    } finally {
      attempt.relay.close();
    }
  });

  it("closes the relay when InitiateLogin fails (no leaked listener)", async () => {
    const encodedError = cborEncode({
      __type: "com.amazon.kirowebportalservice#UnauthorizedException",
      message: "Authentication required or access denied.",
    });
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      headers: new Headers({ "content-type": "application/cbor" }),
      arrayBuffer: async () => encodedError.buffer,
    } as unknown as Response) as unknown as typeof fetch;

    await expect(
      startKiroSocialLoginAttempt({ idp: "Github" }),
    ).rejects.toThrow(KiroWebPortalHttpError);
    // Port freed — a fresh relay can bind.
    const relay = await startKiroSigninRelay();
    relay.close();
  });
});

// =============================================================================
// exchangeKiroSocialCode
// =============================================================================

describe("kiro-signin-flow — exchangeKiroSocialCode", () => {
  it("POSTs JSON { code, code_verifier, redirect_uri } and returns tokens", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          accessToken: "aoa-social",
          refreshToken: "rt-social",
          profileArn: "arn:aws:codewhisperer:us-east-1:1:profile/SOCIAL",
          expiresIn: 3600,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ) as unknown as typeof fetch;

    const tokens = await exchangeKiroSocialCode({
      code: "the-code",
      codeVerifier: "the-verifier",
    });
    expect(tokens.accessToken).toBe("aoa-social");
    expect(tokens.refreshToken).toBe("rt-social");
    expect(tokens.profileArn).toBe(
      "arn:aws:codewhisperer:us-east-1:1:profile/SOCIAL",
    );
    expect(tokens.expiresIn).toBe(3600);

    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    expect(url).toContain("/oauth/token");
    const body = JSON.parse(init.body as string) as Record<string, string>;
    expect(body.code).toBe("the-code");
    expect(body.code_verifier).toBe("the-verifier");
    expect(body.redirect_uri).toBe("http://localhost:3128/oauth/callback");
  });

  it("surfaces a 400 with the server's message", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "Bad request" }), {
        status: 400,
      }),
    ) as unknown as typeof fetch;

    await expect(
      exchangeKiroSocialCode({ code: "c", codeVerifier: "v" }),
    ).rejects.toThrow(/400.*Bad request/s);
  });

  it("defaults expiresIn when the response omits it", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ accessToken: "aoa-x" }), {
        status: 200,
      }),
    ) as unknown as typeof fetch;

    const tokens = await exchangeKiroSocialCode({
      code: "c",
      codeVerifier: "v",
    });
    expect(tokens.expiresIn).toBe(3600);
  });

  it("surfaces Login cancelled (not a wrapped error) when the signal aborts mid-exchange", async () => {
    const controller = new AbortController();
    globalThis.fetch = vi.fn().mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          // Simulate the fetch failing with the abort.
          init?.signal?.addEventListener("abort", () =>
            reject(
              new DOMException("This operation was aborted", "AbortError"),
            ),
          );
        }),
    ) as unknown as typeof fetch;

    const exchangeP = exchangeKiroSocialCode({
      code: "c",
      codeVerifier: "v",
      signal: controller.signal,
    });
    controller.abort();
    await expect(exchangeP).rejects.toThrow("Login cancelled");
  });
});

// =============================================================================
// Credential-material redaction (agents.md convention #17)
// =============================================================================

describe("kiro-signin-flow — credential redaction", () => {
  it("never logs the code, code_verifier, or tokens on exchange failure", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "Bad request" }), {
        status: 400,
      }),
    ) as unknown as typeof fetch;

    try {
      await exchangeKiroSocialCode({
        code: "secret-relay-code",
        codeVerifier: "secret-relay-verifier",
      });
    } catch {
      // Expected
    }

    for (const call of consoleErrorSpy.mock.calls) {
      const serialized = JSON.stringify(call);
      expect(serialized).not.toContain("secret-relay-code");
      expect(serialized).not.toContain("secret-relay-verifier");
    }
  });
});
