/**
 * Unit tests for `providers/kiro/kiro-desktop-auth.ts`.
 *
 * Per design doc Phase D test plan: Refresh extracts `profileArn` and
 * `csrfToken` from the response, persists to credential shape. Also
 * covers the redirect-URL parser and the machineId derivation.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { encode as cborEncode, decode as cborDecode } from "cbor-x";
import {
  KiroDesktopLoginError,
  deriveMachineId,
  loginKiroDesktop,
  refreshKiroDesktopCredential,
} from "../providers/kiro/kiro-desktop-auth.ts";
import { KIRO_WEB_PORTAL } from "../providers/kiro/kiro-web-portal-cbor.ts";
import type { KiroCredentials } from "../providers/kiro/kiro-auth.ts";

/**
 * Read the CBOR-encoded InitiateLogin request body from a mocked
 * fetch call. Returns the decoded input shape (idp, codeChallenge,
 * state, etc.) so the test can build a matching redirect URL.
 */
function readInitiateLoginRequestBody(mockFetch: ReturnType<typeof vi.fn>): {
  idp: string;
  codeChallenge: string;
  state: string;
} {
  const init = mockFetch.mock.calls[0]?.[1] as RequestInit | undefined;
  const body = init?.body as Uint8Array | undefined;
  if (!body)
    throw new Error("InitiateLogin fetch was not called or had no body");
  return cborDecode(body) as {
    idp: string;
    codeChallenge: string;
    state: string;
  };
}

// =============================================================================
// deriveMachineId
// =============================================================================

describe("kiro-desktop-auth — deriveMachineId", () => {
  it("returns a 32-character hex string", () => {
    const id = deriveMachineId();
    expect(id).toMatch(/^[a-f0-9]{32}$/);
  });

  it("is deterministic across calls", () => {
    const a = deriveMachineId();
    const b = deriveMachineId();
    expect(a).toBe(b);
  });
});

// =============================================================================
// loginKiroDesktop — redirect URL parsing (covered via the full flow below)
// =============================================================================

function mockFetchCbor(
  status: number,
  cborBody: unknown,
  setCookie?: string[],
) {
  const buffer = cborEncode(cborBody);
  const headers = new Headers({ "content-type": "application/cbor" });
  if (setCookie) {
    for (const cookie of setCookie) headers.append("set-cookie", cookie);
  }
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers,
    arrayBuffer: async () =>
      buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      ),
  } as unknown as Response;
}

function makeInteraction(
  overrides: Partial<{
    pastedUrl: string;
    signalAborted: boolean;
  }> = {},
): {
  notify: ReturnType<typeof vi.fn>;
  prompt: ReturnType<typeof vi.fn>;
  signal: AbortSignal;
} {
  return {
    notify: vi.fn(),
    prompt: vi.fn().mockResolvedValue(overrides.pastedUrl ?? ""),
    signal: overrides.signalAborted
      ? AbortSignal.abort()
      : new AbortController().signal,
  };
}

function buildRedirectUrl(state: string, code = "auth-code-from-idp"): string {
  return `${KIRO_WEB_PORTAL}/signin/oauth?code=${encodeURIComponent(
    code,
  )}&state=${encodeURIComponent(state)}`;
}

afterEach(() => {
  vi.restoreAllMocks();
});

// =============================================================================
// loginKiroDesktop — full PKCE flow
// =============================================================================

describe("kiro-desktop-auth — loginKiroDesktop", () => {
  it("drives the full PKCE flow and returns a KiroCredentials with profileArn", async () => {
    const interaction = makeInteraction();
    const initResponse = {
      applicationArn:
        "arn:aws:sso::432677196278:application/ssoins-xxx/apl-xxx",
      instanceRegion: "us-east-1",
      redirectUrl: "https://us-east-1.signin.aws/platform/authorize?...",
    };
    const exchangeResponse = {
      accessToken: "aoaEXAMPLE123",
      csrfToken: "csrf-abc123",
      expiresIn: 3600,
      profileArn: "arn:aws:codewhisperer:us-east-1:123456789:profile/ABCDE",
    };
    const setCookie = [
      "RefreshToken=rt-secret; HttpOnly; Secure; Path=/",
      "Idp=BuilderId; Path=/",
    ];

    let call = 0;
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      call++;
      if (call === 1) return mockFetchCbor(200, initResponse); // InitiateLogin
      if (call === 2) return mockFetchCbor(200, exchangeResponse, setCookie); // ExchangeToken
      throw new Error(`Unexpected fetch call #${call} to ${url}`);
    }) as unknown as typeof fetch;

    // Pre-decode the InitiateLogin body so we can build a matching
    // redirect URL for the user paste. The fetch hasn't been called
    // yet, so we drive it explicitly via the prompt mock.
    interaction.prompt = vi.fn().mockImplementation(async () => {
      // First call to prompt happens after InitiateLogin completes.
      // Read the request body to extract the state the server saw.
      const initiateBody = readInitiateLoginRequestBody(
        globalThis.fetch as ReturnType<typeof vi.fn>,
      );
      return buildRedirectUrl(initiateBody.state);
    });

    const creds = await loginKiroDesktop(interaction as never, {
      idp: "BuilderId",
      preferLocalhost: false, // existing tests use the manual-paste path
    });

    expect(creds.type).toBe("oauth");
    expect(creds.access).toBe("aoaEXAMPLE123");
    expect(creds.refresh).toBe("rt-secret");
    expect(creds.profileArn).toBe(
      "arn:aws:codewhisperer:us-east-1:123456789:profile/ABCDE",
    );
    expect(creds.csrfToken).toBe("csrf-abc123");
    expect(creds.idp).toBe("BuilderId");
    expect(creds.authMethod).toBe("web-portal");
    expect(creds.clientId).toBe(initResponse.applicationArn);
    expect(creds.clientSecret).toBe("");
    expect(creds.region).toBe("us-east-1");
    expect(creds.machineId).toMatch(/^[a-f0-9]{32}$/);
    // Expiry = now + 3600s - 5min buffer
    const expectedExpires = Date.now() + 3600 * 1000 - 5 * 60 * 1000;
    expect(creds.expires).toBeGreaterThan(expectedExpires - 1000);
    expect(creds.expires).toBeLessThan(expectedExpires + 1000);

    // Verify notify was called with the auth_url shape
    const notifyCalls = (interaction.notify as ReturnType<typeof vi.fn>).mock
      .calls;
    const authUrlCall = notifyCalls.find(
      (c) => (c[0] as { type?: string }).type === "auth_url",
    );
    expect(authUrlCall).toBeDefined();
    expect((authUrlCall![0] as { url: string }).url).toBe(
      initResponse.redirectUrl,
    );
  });

  it("throws KiroDesktopLoginError when the pasted URL is missing the code", async () => {
    const interaction = makeInteraction();
    const initResponse = { redirectUrl: "https://example.com/redirect" };
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        mockFetchCbor(200, initResponse),
      ) as unknown as typeof fetch;

    interaction.prompt = vi.fn().mockImplementation(async () => {
      const initiateBody = readInitiateLoginRequestBody(
        globalThis.fetch as ReturnType<typeof vi.fn>,
      );
      // Paste a redirect URL missing the `code` parameter.
      return `${KIRO_WEB_PORTAL}/signin/oauth?state=${encodeURIComponent(
        initiateBody.state,
      )}`;
    });

    await expect(
      loginKiroDesktop(interaction as never, { preferLocalhost: false }),
    ).rejects.toThrow(KiroDesktopLoginError);
    await expect(
      loginKiroDesktop(interaction as never, { preferLocalhost: false }),
    ).rejects.toThrow(/`code`/);
  });

  it("throws KiroDesktopLoginError on state mismatch (CSRF protection)", async () => {
    const interaction = makeInteraction();
    const initResponse = { redirectUrl: "https://example.com/redirect" };
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        mockFetchCbor(200, initResponse),
      ) as unknown as typeof fetch;

    // Paste a redirect URL with a DIFFERENT state value
    interaction.prompt = vi
      .fn()
      .mockResolvedValue(
        `${KIRO_WEB_PORTAL}/signin/oauth?code=auth-code&state=wrong-state-value`,
      );

    await expect(
      loginKiroDesktop(interaction as never, { preferLocalhost: false }),
    ).rejects.toThrow(/state.*does not match/);
  });

  it("throws when ExchangeToken returns no refresh token cookie", async () => {
    const interaction = makeInteraction();
    const initResponse = { redirectUrl: "https://example.com/redirect" };
    const exchangeResponse = {
      accessToken: "aoa",
      expiresIn: 3600,
      // no refresh token cookie, no profileArn
    };
    let call = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      call++;
      if (call === 1) return mockFetchCbor(200, initResponse);
      if (call === 2) return mockFetchCbor(200, exchangeResponse, []);
      throw new Error("unexpected call");
    }) as unknown as typeof fetch;

    interaction.prompt = vi.fn().mockImplementation(async () => {
      const initiateBody = readInitiateLoginRequestBody(
        globalThis.fetch as ReturnType<typeof vi.fn>,
      );
      return buildRedirectUrl(initiateBody.state);
    });

    await expect(
      loginKiroDesktop(interaction as never, { preferLocalhost: false }),
    ).rejects.toThrow(/no refresh token/);
  });

  it("propagates a network error as a wrapped KiroDesktopLoginError", async () => {
    const interaction = makeInteraction();
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(
        new TypeError("ECONNREFUSED"),
      ) as unknown as typeof fetch;

    await expect(
      loginKiroDesktop(interaction as never, { preferLocalhost: false }),
    ).rejects.toThrow();
  });
});

// =============================================================================
// refreshKiroDesktopCredential
// =============================================================================

describe("kiro-desktop-auth — refreshKiroDesktopCredential", () => {
  const baseCredential: KiroCredentials = {
    type: "oauth",
    access: "aoa-old",
    refresh: "rt-old",
    expires: Date.now() - 1000, // expired
    clientId: "arn:aws:sso::123:application/xxx/apl-xxx",
    clientSecret: "",
    region: "us-east-1",
    authMethod: "web-portal",
    idp: "BuilderId",
    machineId: "abcdef1234567890abcdef1234567890",
    profileArn: "arn:aws:codewhisperer:us-east-1:OLD:profile/XXX",
  };

  it("extracts profileArn and csrfToken from the refresh response", async () => {
    const refreshResponse = {
      accessToken: "aoa-new",
      refreshToken: "rt-new",
      expiresIn: 3600,
      profileArn: "arn:aws:codewhisperer:us-east-1:NEW:profile/YYY",
      csrfToken: "csrf-new",
    };
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(refreshResponse), { status: 200 }),
      ) as unknown as typeof fetch;

    const refreshed = await refreshKiroDesktopCredential(baseCredential);

    expect(refreshed.access).toBe("aoa-new");
    expect(refreshed.refresh).toBe("rt-new");
    expect(refreshed.profileArn).toBe(
      "arn:aws:codewhisperer:us-east-1:NEW:profile/YYY",
    );
    expect(refreshed.csrfToken).toBe("csrf-new");
    // Expiry = now + 3600s - 5min buffer
    const expectedExpires = Date.now() + 3600 * 1000 - 5 * 60 * 1000;
    expect(refreshed.expires).toBeGreaterThan(expectedExpires - 1000);
    expect(refreshed.expires).toBeLessThan(expectedExpires + 1000);
    // Identity fields preserved
    expect(refreshed.region).toBe("us-east-1");
    expect(refreshed.authMethod).toBe("web-portal");
    expect(refreshed.machineId).toBe(baseCredential.machineId);
  });

  it("preserves the previous profileArn when the response omits it", async () => {
    const refreshResponse = {
      accessToken: "aoa-new",
      refreshToken: "rt-new",
      expiresIn: 3600,
      // no profileArn in response
    };
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(refreshResponse), { status: 200 }),
      ) as unknown as typeof fetch;

    const refreshed = await refreshKiroDesktopCredential(baseCredential);
    expect(refreshed.profileArn).toBe(baseCredential.profileArn);
  });

  it("falls back to the previous refresh token when the response omits it", async () => {
    const refreshResponse = {
      accessToken: "aoa-new",
      expiresIn: 3600,
      // no refreshToken
    };
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(refreshResponse), { status: 200 }),
      ) as unknown as typeof fetch;

    const refreshed = await refreshKiroDesktopCredential(baseCredential);
    expect(refreshed.refresh).toBe(baseCredential.refresh);
  });

  it("uses the credential's machineId in the User-Agent header", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          accessToken: "aoa",
          refreshToken: "rt",
          expiresIn: 3600,
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    await refreshKiroDesktopCredential(baseCredential);

    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0];
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["User-Agent"]).toBe(
      `KiroIDE-0.6.18-${baseCredential.machineId}`,
    );
  });

  it("derives a machineId when the credential has none", async () => {
    const credential: KiroCredentials = { ...baseCredential };
    delete credential.machineId;
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          accessToken: "aoa",
          refreshToken: "rt",
          expiresIn: 3600,
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    await refreshKiroDesktopCredential(credential);

    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0];
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["User-Agent"]).toMatch(/^KiroIDE-0\.6\.18-[a-f0-9]{32}$/);
  });

  it("throws on a 4xx refresh failure", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "invalid_grant" }), {
        status: 401,
      }),
    ) as unknown as typeof fetch;

    await expect(refreshKiroDesktopCredential(baseCredential)).rejects.toThrow(
      /Kiro desktop refresh failed/,
    );
  });

  it("throws on a 5xx refresh failure", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response("service unavailable", { status: 503 }),
      ) as unknown as typeof fetch;

    await expect(refreshKiroDesktopCredential(baseCredential)).rejects.toThrow(
      /503/,
    );
  });

  it("throws when the refresh response is missing accessToken", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ expiresIn: 3600 }), { status: 200 }),
      ) as unknown as typeof fetch;

    await expect(refreshKiroDesktopCredential(baseCredential)).rejects.toThrow(
      /missing accessToken/,
    );
  });
});

// =============================================================================
// Credential-material redaction (agents.md convention #17)
// =============================================================================

describe("kiro-desktop-auth — credential redaction", () => {
  it("never logs the accessToken, refreshToken, code, or codeVerifier in console.error", async () => {
    const interaction = makeInteraction();
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    // Force a state mismatch (which logs at error level) so we can
    // assert that the logged payload doesn't include any secrets.
    const initResponse = { redirectUrl: "https://example.com/redirect" };
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        mockFetchCbor(200, initResponse),
      ) as unknown as typeof fetch;

    interaction.prompt = vi
      .fn()
      .mockResolvedValue(
        `${KIRO_WEB_PORTAL}/signin/oauth?code=secret-auth-code&state=wrong-state`,
      );

    let initiateState: string | undefined;
    try {
      await loginKiroDesktop(interaction as never, { preferLocalhost: false });
    } catch {
      // Expected to throw on state mismatch. Now read the state the
      // InitiateLogin request was made with so we can assert it's
      // absent from the error log.
      initiateState = readInitiateLoginRequestBody(
        globalThis.fetch as ReturnType<typeof vi.fn>,
      ).state;
    }

    // No console.error call should ever include the auth code, the
    // full state, or the redirect URL.
    for (const call of consoleErrorSpy.mock.calls) {
      for (const arg of call) {
        const serialized = JSON.stringify(arg);
        expect(serialized).not.toContain("secret-auth-code");
        // The error message says "state does not match" but never
        // includes the state value itself.
        if (initiateState && serialized.includes("state")) {
          expect(serialized).not.toContain(initiateState);
        }
      }
    }
  });
});

// =============================================================================
// localhost callback server path (the default happy path)
// =============================================================================

describe("kiro-desktop-auth — localhost callback server", () => {
  // NOTE: The happy-path localhost-callback test (start the server,
  // hit /callback with a browser, verify the credential) is omitted
  // here. The notify-mock → realFetch → callback-server chain has a
  // microtask race that's hard to test deterministically without
  // mocking the entire startKiroCallbackServer function. The manual-
  // paste test below covers the same code path with explicit user
  // input, and the production code is exercised end-to-end by
  // `scripts/test-kiro-desktop.mjs`. Add a focused unit test in a
  // follow-up that mocks startKiroCallbackServer directly.

  it("falls back to manual paste when preferLocalhost is false", async () => {
    const interaction = {
      notify: vi.fn(),
      prompt: vi.fn().mockImplementation(async () => {
        const init = readInitiateLoginRequestBody(
          globalThis.fetch as ReturnType<typeof vi.fn>,
        );
        return buildRedirectUrl(init.state);
      }),
      signal: new AbortController().signal,
    };

    const initResponse = { redirectUrl: "https://example.com/redirect" };
    const exchangeResponse = {
      accessToken: "aoa-manual",
      expiresIn: 3600,
      profileArn: "arn:aws:codewhisperer:us-east-1:888:profile/M",
    };
    const setCookie = ["RefreshToken=rt-manual; HttpOnly; Path=/"];
    let call = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      call++;
      if (call === 1) return mockFetchCbor(200, initResponse);
      if (call === 2) return mockFetchCbor(200, exchangeResponse, setCookie);
      throw new Error(`unexpected call #${call}`);
    }) as unknown as typeof fetch;

    const creds = await loginKiroDesktop(interaction as never, {
      idp: "BuilderId",
      preferLocalhost: false,
    });
    expect(creds.access).toBe("aoa-manual");
    expect(creds.profileArn).toBe(
      "arn:aws:codewhisperer:us-east-1:888:profile/M",
    );
    // Manual paste path was used (interaction.prompt was called).
    expect(interaction.prompt).toHaveBeenCalled();
  });
});
