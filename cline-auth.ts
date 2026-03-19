/**
 * Cline OAuth login flow using a local callback server.
 *
 * Flow:
 *   1. Fetch redirect URL from /auth/authorize (with local callback URL)
 *   2. Open browser to OAuth login page
 *   3. Capture authorization code via local HTTP server on port 31234
 *      (or let user paste the full callback URL for SSH/remote use)
 *   4. Exchange code for access/refresh tokens
 */

import type { OAuthCredentials, OAuthLoginCallbacks } from "@mariozechner/pi-ai";
import * as http from "node:http";
import * as url from "node:url";
import * as crypto from "node:crypto";
import { spawn } from "child_process";
import {
  BASE_URL_CLINE,
  CLINE_CALLBACK_PORT,
  CLINE_AUTH_TIMEOUT_MS,
} from "./constants.ts";

// =============================================================================
// Headers
// =============================================================================

const CLINE_VERSION = "3.63.0";

function buildClineHeaders(): Record<string, string> {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-Platform": "Visual Studio Code",
    "X-Platform-Version": "1.109.3",
    "X-Client-Type": "VSCode Extension",
    "X-Client-Version": CLINE_VERSION,
    "X-Core-Version": CLINE_VERSION,
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
// Login
// =============================================================================

export async function loginCline(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
  const callbackUrl = `http://127.0.0.1:${CLINE_CALLBACK_PORT}/auth`;

  // Fetch the WorkOS auth redirect URL
  let finalAuthUrl: string;
  try {
    const authUrl = new URL(`${BASE_URL_CLINE}/auth/authorize`);
    authUrl.searchParams.set("client_type", "extension");
    authUrl.searchParams.set("callback_url", callbackUrl);
    authUrl.searchParams.set("redirect_uri", callbackUrl);

    const response = await fetch(authUrl.toString(), {
      method: "GET",
      redirect: "manual",
      headers: buildClineHeaders(),
    });

    if (response.status >= 300 && response.status < 400) {
      finalAuthUrl = response.headers.get("Location") ?? authUrl.toString();
    } else {
      const json = (await response.json()) as { redirect_url?: string };
      finalAuthUrl = json.redirect_url ?? authUrl.toString();
    }
  } catch {
    // Fall back to direct URL
    const authUrl = new URL(`${BASE_URL_CLINE}/auth/authorize`);
    authUrl.searchParams.set("client_type", "extension");
    authUrl.searchParams.set("callback_url", callbackUrl);
    authUrl.searchParams.set("redirect_uri", callbackUrl);
    finalAuthUrl = authUrl.toString();
  }

  const reset = "\x1b[0m";
  const teal = "\x1b[38;2;0;175;175m";
  const orange = "\x1b[38;2;254;188;56m";
  const purple = "\x1b[38;2;178;129;214m";
  const bold = "\x1b[1m";

  callbacks.onAuth({
    url: finalAuthUrl,
    instructions: `
  Cline Authentication

  ${teal}Same machine:${reset}
  Your browser will open. Complete login to auto-complete.

  ${teal}Different machine (SSH/remote):${reset}
  1. Open the URL above in a browser
  2. Complete login — the browser will fail to reach localhost
  3. Copy the callback URL from the browser's URL bar:
     ${orange}http://127.0.0.1:${CLINE_CALLBACK_PORT}/auth?code=${bold}${purple}XXX${reset}${orange}&provider=...${reset}
  4. Paste the full callback URL (or just the code) here
`,
  });

  openBrowser(finalAuthUrl);

  // Start local callback server
  let server: http.Server | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const cleanup = () => {
    if (server) { server.close(); server = null; }
    if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
  };

  const codePromise = new Promise<{ code: string; provider: string | null }>((resolve, reject) => {
    server = http.createServer((req, res) => {
      try {
        const reqUrl = new url.URL(req.url ?? "", `http://127.0.0.1:${CLINE_CALLBACK_PORT}`);
        if (reqUrl.pathname === "/auth") {
          const code = reqUrl.searchParams.get("code");
          const provider = reqUrl.searchParams.get("provider");
          if (code) {
            res.writeHead(200, { "Content-Type": "text/html" });
            res.end(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Pi – Cline Auth</title>
<style>body{font-family:system-ui,sans-serif;background:#18181e;color:#b5bd68;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.msg{text-align:center}.msg h1{font-size:24px;margin-bottom:8px}.msg p{color:#808080}</style></head>
<body><div class="msg"><h1>✓ Authenticated</h1><p>You can close this window</p></div></body></html>`);
            resolve({ code, provider });
          } else {
            res.writeHead(400); res.end("Missing code");
            reject(new Error("Missing code in callback"));
          }
        } else {
          res.writeHead(404); res.end("Not found");
        }
      } catch (e) { reject(e); } finally { cleanup(); }
    });

    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        reject(new Error(`Port ${CLINE_CALLBACK_PORT} already in use. Cancel any in-progress login and try again.`));
      } else {
        reject(new Error(`Callback server error: ${err.message}`));
      }
    });

    server.listen(CLINE_CALLBACK_PORT, "127.0.0.1");

    timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error("Authentication timed out. Complete login within 5 minutes, or paste the callback URL manually."));
    }, CLINE_AUTH_TIMEOUT_MS);

    callbacks.signal?.addEventListener("abort", () => {
      cleanup();
      reject(new Error("Login cancelled"));
    }, { once: true });
  });

  let code: string;
  let provider: string | null = null;

  if (callbacks.onManualCodeInput) {
    const result = await Promise.race([
      codePromise.then((r) => ({ type: "local" as const, ...r })),
      callbacks.onManualCodeInput().then((c) => ({ type: "manual" as const, code: c })),
    ]);

    if (result.type === "local") {
      code = result.code;
      provider = result.provider;
    } else {
      cleanup();
      if (callbacks.signal?.aborted) throw new Error("Login cancelled");
      if (!result.code?.trim()) throw new Error("No code provided");

      const input = result.code.trim();
      if (input.startsWith("http://") || input.startsWith("https://")) {
        const cb = new URL(input);
        const urlCode = cb.searchParams.get("code");
        if (!urlCode) throw new Error("No code found in callback URL");
        code = urlCode;
        provider = cb.searchParams.get("provider");
      } else {
        code = input;
      }
    }
  } else {
    const result = await codePromise;
    code = result.code;
    provider = result.provider;
  }

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
      redirect_uri: callbackUrl,
    };
    if (candidate) payload.provider = candidate;

    const res = await fetch(`${BASE_URL_CLINE}/auth/token`, {
      method: "POST",
      headers: buildClineHeaders(),
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      lastError = `${res.status}: ${(await res.text().catch(() => "")).slice(0, 120)}`;
      continue;
    }

    const data = (await res.json()) as { success?: boolean; data?: { accessToken: string; refreshToken?: string; expiresAt: string } };
    if (data?.success && data.data?.accessToken) {
      tokenData = data.data;
      break;
    }
    lastError = "Invalid token response";
  }

  if (!tokenData) {
    throw new Error(`Cline token exchange failed${lastError ? ` (${lastError})` : ""}`);
  }

  return {
    access: `workos:${tokenData.accessToken}`,
    refresh: tokenData.refreshToken ?? "",
    expires: new Date(tokenData.expiresAt).getTime(),
  };
}

// =============================================================================
// Refresh
// =============================================================================

export async function refreshClineToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
  if (credentials.expires > Date.now()) return credentials;

  const res = await fetch(`${BASE_URL_CLINE}/auth/refresh`, {
    method: "POST",
    headers: buildClineHeaders(),
    body: JSON.stringify({ refreshToken: credentials.refresh, grantType: "refresh_token" }),
  });

  if (!res.ok) throw new Error("Cline token refresh failed. Run /login cline to re-authenticate.");
  const data = (await res.json()) as { success?: boolean; data?: { accessToken: string; refreshToken?: string; expiresAt: string } };
  if (!data?.success || !data.data) throw new Error("Invalid refresh response");

  return {
    access: `workos:${data.data.accessToken}`,
    refresh: data.data.refreshToken ?? credentials.refresh,
    expires: new Date(data.data.expiresAt).getTime(),
  };
}
