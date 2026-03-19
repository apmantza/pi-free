/**
 * Cline OAuth login flow — based on pi-cline's proven implementation.
 *
 * Flow:
 *   1. Start local callback server (scans ports 48801-48811)
 *   2. Fetch redirect URL from /auth/authorize
 *   3. Open browser to OAuth login page
 *   4. Capture authorization code via callback (refreshToken/idToken/code)
 *   5. Exchange code for access/refresh tokens
 */

import type { OAuthCredentials, OAuthLoginCallbacks } from "@mariozechner/pi-ai";
import * as http from "node:http";
import { URL as NodeURL } from "node:url";
import { spawn } from "child_process";
import { BASE_URL_CLINE, CLINE_AUTH_TIMEOUT_MS } from "./constants.ts";

// =============================================================================
// Constants (aligned with pi-cline)
// =============================================================================

const CLINE_CLIENT_VERSION = "2.7.0";
const CLINE_CORE_VERSION = "3.72.0";

// Port range for callback server (pi-cline scans 48801-48811)
const CALLBACK_PORT_START = 48801;
const CALLBACK_PORT_END = 48811;
const AUTH_PATH = "/auth";

// =============================================================================
// Headers (aligned with pi-cline)
// =============================================================================

function buildClineHeaders(): Record<string, string> {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": `Cline/${CLINE_CORE_VERSION}`,
    "X-PLATFORM": "Cline CLI - Node.js",
    "X-PLATFORM-VERSION": CLINE_CLIENT_VERSION,
    "X-CLIENT-TYPE": "CLI",
    "X-CLIENT-VERSION": CLINE_CLIENT_VERSION,
    "X-CORE-VERSION": CLINE_CORE_VERSION,
  };
}

// =============================================================================
// Browser open
// =============================================================================

function openBrowser(url: string): void {
  try {
    if (process.platform === "win32") {
      spawn("cmd", ["/c", "start", "", url], { detached: true, shell: false }).unref();
    } else if (process.platform === "darwin") {
      spawn("open", [url], { detached: true }).unref();
    } else {
      spawn("xdg-open", [url], { detached: true }).unref();
    }
  } catch {
    // non-fatal
  }
}

// =============================================================================
// Callback server (port scanning like pi-cline)
// =============================================================================

interface CallbackResult {
  code: string;
  provider: string | null;
}

function tryListenOnPort(server: http.Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      server.off("error", onError);
      reject(err);
    };
    server.once("error", onError);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", onError);
      resolve();
    });
  });
}

function parseCallback(rawUrl: string, port: number): CallbackResult {
  const parsed = new NodeURL(rawUrl, `http://127.0.0.1:${port}`);
  const query = new URLSearchParams(parsed.search.slice(1).replace(/\+/g, "%2B"));

  // pi-cline looks for refreshToken, idToken, or code
  const token = query.get("refreshToken") || query.get("idToken") || query.get("code");
  if (!token) {
    throw new Error("Missing authorization code in callback URL");
  }

  return { code: token, provider: query.get("provider") };
}

async function startCallbackServer(signal?: AbortSignal): Promise<{
  callbackUrl: string;
  waitForCode: Promise<CallbackResult>;
  close: () => void;
  port: number;
}> {
  const ports = Array.from(
    { length: CALLBACK_PORT_END - CALLBACK_PORT_START + 1 },
    (_, i) => CALLBACK_PORT_START + i,
  );

  let selectedPort = 0;
  let settled = false;
  let serverTimeout: NodeJS.Timeout | undefined;
  let abortListener: (() => void) | undefined;

  let resolveWait: ((r: CallbackResult) => void) | undefined;
  let rejectWait: ((e: Error) => void) | undefined;

  const waitForCode = new Promise<CallbackResult>((resolve, reject) => {
    resolveWait = resolve;
    rejectWait = reject;
  });
  void waitForCode.catch(() => {});

  const successHTML = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Cline Auth</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
font-family:system-ui,sans-serif;background:#fff;color:#333}
.box{text-align:center;padding:24px;border:1px solid #e1e1e1;border-radius:8px;background:#f8f8f8}
.ok{color:#2f855a;font-size:20px;margin-bottom:8px}</style></head>
<body><div class="box"><div class="ok">✓ Authenticated</div>
<p>You can close this window and return to your terminal.</p></div></body></html>`;

  const cleanup = () => {
    if (serverTimeout) { clearTimeout(serverTimeout); serverTimeout = undefined; }
    if (signal && abortListener) { signal.removeEventListener("abort", abortListener); abortListener = undefined; }
    if (server) { server.close(); server = undefined as any; }
  };

  const settle = (fn: () => void) => {
    if (settled) return;
    settled = true;
    cleanup();
    fn();
  };

  const server = http.createServer((req, res) => {
    try {
      const parsed = new NodeURL(req.url ?? "", `http://127.0.0.1:${selectedPort}`);
      if (parsed.pathname !== AUTH_PATH) {
        res.writeHead(404); res.end("Not found");
        settle(() => rejectWait?.(new Error(`Unexpected path: ${parsed.pathname}`)));
        return;
      }
      const callback = parseCallback(req.url!, selectedPort);
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(successHTML);
      settle(() => resolveWait?.(callback));
    } catch (error) {
      res.writeHead(400); res.end("Bad request");
      settle(() => rejectWait?.(error instanceof Error ? error : new Error("Callback parse failed")));
    }
  });

  // Scan port range
  for (const port of ports) {
    try {
      await tryListenOnPort(server, port);
      selectedPort = port;
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EADDRINUSE") throw err;
    }
  }

  if (selectedPort === 0) {
    cleanup();
    throw new Error(`No available port for auth callback (tried ${ports[0]}-${ports[ports.length - 1]})`);
  }

  // Timeout + abort handling (pi-cline uses 10min, we use our CLINE_AUTH_TIMEOUT_MS)
  serverTimeout = setTimeout(() => {
    settle(() => rejectWait?.(new Error("Callback server timed out")));
  }, CLINE_AUTH_TIMEOUT_MS);

  abortListener = () => settle(() => rejectWait?.(new Error("Login cancelled")));
  if (signal) {
    signal.addEventListener("abort", abortListener, { once: true });
    if (signal.aborted) abortListener();
  }

  return {
    callbackUrl: `http://127.0.0.1:${selectedPort}${AUTH_PATH}`,
    waitForCode,
    port: selectedPort,
    close: () => settle(() => rejectWait?.(new Error("Login cancelled"))),
  };
}

// =============================================================================
// Token helpers
// =============================================================================

function parseExpiresAt(expiresAt: string): number {
  const ms = Date.parse(expiresAt);
  if (Number.isNaN(ms)) throw new Error("Cline auth response has invalid expiresAt");
  // Buffer: expire 5 min early to avoid edge-case failures
  return Math.max(Date.now() + 30_000, ms - 5 * 60_000);
}

// =============================================================================
// Login
// =============================================================================

export async function loginCline(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
  callbacks.onProgress?.("Preparing Cline authentication...");

  const callbackServer = await startCallbackServer(callbacks.signal);

  try {
    // Get authorize URL
    const authUrl = new NodeURL("auth/authorize", `${BASE_URL_CLINE}/`);
    authUrl.searchParams.set("client_type", "extension");
    authUrl.searchParams.set("callback_url", callbackServer.callbackUrl);
    authUrl.searchParams.set("redirect_uri", callbackServer.callbackUrl);

    let finalAuthUrl: string;
    try {
      const res = await fetch(authUrl.toString(), {
        method: "GET",
        redirect: "manual",
        headers: buildClineHeaders(),
        signal: callbacks.signal,
      });
      if (res.status >= 300 && res.status < 400) {
        finalAuthUrl = res.headers.get("Location") ?? authUrl.toString();
      } else {
        const json = (await res.json()) as { redirect_url?: string };
        finalAuthUrl = json.redirect_url ?? authUrl.toString();
      }
    } catch {
      finalAuthUrl = authUrl.toString();
    }

    callbacks.onAuth({
      url: finalAuthUrl,
      instructions: "Complete the sign-in in your browser.",
    });

    callbacks.onProgress?.("Waiting for authentication callback...");
    openBrowser(finalAuthUrl);

    // Wait for callback (with manual input fallback)
    let code: string;
    let provider: string | null = null;

    if (callbacks.onManualCodeInput) {
      const result = await Promise.race([
        callbackServer.waitForCode.then((r) => ({ type: "local" as const, ...r })),
        callbacks.onManualCodeInput().then((c) => ({ type: "manual" as const, code: c })),
      ]);

      if (result.type === "local") {
        code = result.code;
        provider = result.provider;
      } else {
        callbackServer.close();
        if (callbacks.signal?.aborted) throw new Error("Login cancelled");
        if (!result.code?.trim()) throw new Error("No code provided");

        const input = result.code.trim();
        if (input.startsWith("http://") || input.startsWith("https://")) {
          const cb = new NodeURL(input);
          const urlCode = cb.searchParams.get("refreshToken")
            || cb.searchParams.get("idToken")
            || cb.searchParams.get("code");
          if (!urlCode) throw new Error("No code found in callback URL");
          code = urlCode;
          provider = cb.searchParams.get("provider");
        } else {
          code = input;
        }
      }
    } else {
      const result = await callbackServer.waitForCode;
      code = result.code;
      provider = result.provider;
    }

    callbacks.onProgress?.("Completing Cline authentication...");

    // Exchange code for tokens
    const providerCandidates: Array<string | null> = provider
      ? [provider]
      : [null, "google", "github", "microsoft", "authkit"];

    let tokenData: { accessToken: string; refreshToken?: string; expiresAt: string } | null = null;
    let lastError = "";

    for (const candidate of providerCandidates) {
      const payload: Record<string, string> = {
        grant_type: "authorization_code",
        code,
        client_type: "extension",
        redirect_uri: callbackServer.callbackUrl,
      };
      if (candidate) payload.provider = candidate;

      const res = await fetch(`${BASE_URL_CLINE}/auth/token`, {
        method: "POST",
        headers: buildClineHeaders(),
        body: JSON.stringify(payload),
        signal: callbacks.signal,
      });

      if (!res.ok) {
        lastError = `${res.status}: ${(await res.text().catch(() => "")).slice(0, 120)}`;
        continue;
      }

      const data = (await res.json()) as {
        success?: boolean;
        data?: { accessToken: string; refreshToken?: string; expiresAt: string };
      };

      if (data?.success && data.data?.accessToken) {
        tokenData = data.data;
        break;
      }
      lastError = "Invalid token response";
    }

    if (!tokenData) {
      throw new Error(`Cline token exchange failed${lastError ? ` (${lastError})` : ""}`);
    }

    callbacks.onProgress?.("Login successful!");

    return {
      access: tokenData.accessToken,
      refresh: tokenData.refreshToken ?? "",
      expires: parseExpiresAt(tokenData.expiresAt),
    };
  } finally {
    callbackServer.close();
  }
}

// =============================================================================
// Refresh
// =============================================================================

export async function refreshClineToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
  if (credentials.expires > Date.now()) return credentials;

  const res = await fetch(`${BASE_URL_CLINE}/auth/refresh`, {
    method: "POST",
    headers: buildClineHeaders(),
    body: JSON.stringify({
      refreshToken: credentials.refresh,
      grantType: "refresh_token",
    }),
  });

  if (!res.ok) {
    throw new Error("Cline token refresh failed. Run /login cline to re-authenticate.");
  }

  const data = (await res.json()) as {
    success?: boolean;
    data?: { accessToken: string; refreshToken?: string; expiresAt: string };
  };

  if (!data?.success || !data.data) {
    throw new Error("Invalid refresh response");
  }

  return {
    access: data.data.accessToken,
    refresh: data.data.refreshToken ?? credentials.refresh,
    expires: parseExpiresAt(data.data.expiresAt),
  };
}
