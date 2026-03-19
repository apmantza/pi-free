/**
 * Kilo device authorization flow and token management.
 */

import type { OAuthCredentials, OAuthLoginCallbacks } from "@mariozechner/pi-ai";
import { spawn } from "child_process";
import { KILO_POLL_INTERVAL_MS, KILO_TOKEN_EXPIRATION_MS } from "./constants.ts";

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
    // non-fatal — Pi will still show the URL in the terminal
  }
}

const KILO_API_BASE = process.env.KILO_API_URL || "https://api.kilo.ai";
const DEVICE_AUTH_ENDPOINT = `${KILO_API_BASE}/api/device-auth/codes`;
const PROFILE_ENDPOINT = `${KILO_API_BASE}/api/profile`;

// =============================================================================
// Balance
// =============================================================================

export async function fetchKiloBalance(token: string): Promise<number | null> {
  try {
    const response = await fetch(`${PROFILE_ENDPOINT}/balance`, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { balance?: number };
    return data.balance ?? null;
  } catch {
    return null;
  }
}

export function formatCredits(balance: number): string {
  return balance >= 1000 ? `$${(balance / 1000).toFixed(1)}k` : `$${balance.toFixed(2)}`;
}

// =============================================================================
// Device auth
// =============================================================================

interface DeviceAuthResponse {
  code: string;
  verificationUrl: string;
  expiresIn: number;
}

interface DeviceAuthPollResponse {
  status: "pending" | "approved" | "denied" | "expired";
  token?: string;
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error("Login cancelled")); return; }
    const timeout = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(timeout); reject(new Error("Login cancelled")); }, { once: true });
  });
}

async function initiateDeviceAuth(): Promise<DeviceAuthResponse> {
  const response = await fetch(DEVICE_AUTH_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!response.ok) {
    throw new Error(
      response.status === 429
        ? "Too many pending authorization requests. Please try again later."
        : `Failed to initiate device authorization: ${response.status}`,
    );
  }
  return (await response.json()) as DeviceAuthResponse;
}

async function pollDeviceAuth(code: string): Promise<DeviceAuthPollResponse> {
  const response = await fetch(`${DEVICE_AUTH_ENDPOINT}/${code}`);
  if (response.status === 202) return { status: "pending" };
  if (response.status === 403) return { status: "denied" };
  if (response.status === 410) return { status: "expired" };
  if (!response.ok) throw new Error(`Failed to poll device authorization: ${response.status}`);
  return (await response.json()) as DeviceAuthPollResponse;
}

export async function loginKilo(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
  callbacks.onProgress?.("Initiating device authorization...");
  const { code, verificationUrl, expiresIn } = await initiateDeviceAuth();

  callbacks.onAuth({ url: verificationUrl, instructions: `Enter code: ${code}` });
  openBrowser(verificationUrl);
  callbacks.onProgress?.("Waiting for browser authorization...");

  const deadline = Date.now() + expiresIn * 1000;
  while (Date.now() < deadline) {
    if (callbacks.signal?.aborted) throw new Error("Login cancelled");
    await abortableSleep(KILO_POLL_INTERVAL_MS, callbacks.signal);

    const result = await pollDeviceAuth(code);
    if (result.status === "approved") {
      if (!result.token) throw new Error("Authorization approved but no token received");
      callbacks.onProgress?.("Login successful!");
      return { refresh: result.token, access: result.token, expires: Date.now() + KILO_TOKEN_EXPIRATION_MS };
    }
    if (result.status === "denied") throw new Error("Authorization denied by user.");
    if (result.status === "expired") throw new Error("Authorization code expired. Please try again.");

    const remaining = Math.ceil((deadline - Date.now()) / 1000);
    callbacks.onProgress?.(`Waiting for browser authorization... (${remaining}s remaining)`);
  }
  throw new Error("Authentication timed out. Please try again.");
}

export async function refreshKiloToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
  if (credentials.expires > Date.now()) return credentials;
  throw new Error("Kilo token expired. Please run /login kilo to re-authenticate.");
}
