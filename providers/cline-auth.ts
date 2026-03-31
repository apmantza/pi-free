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

import * as http from "node:http";
import { URL as NodeURL } from "node:url";
import type {
	OAuthCredentials,
	OAuthLoginCallbacks,
} from "@mariozechner/pi-ai";
import { BASE_URL_CLINE, CLINE_AUTH_TIMEOUT_MS } from "../constants.ts";
import { createLogger } from "../lib/logger.ts";

const logger = createLogger("cline-auth");

// =============================================================================
// Port range for callback server (matches official Cline CLI AuthHandler)
const CALLBACK_PORT_START = 48801;
const CALLBACK_PORT_END = 48811;
const AUTH_PATH = "/auth";

// =============================================================================
// Headers (must match real Cline VS Code extension exactly)
const VS_CODE_VERSION = "1.109.3";
const CLINE_EXTENSION_VERSION = "3.76.0";

function buildClineHeaders(): Record<string, string> {
	return {
		Accept: "application/json",
		"Content-Type": "application/json",
		"User-Agent": `Cline/${CLINE_EXTENSION_VERSION}`,
		"X-PLATFORM": "Visual Studio Code",
		"X-PLATFORM-VERSION": VS_CODE_VERSION,
		"X-CLIENT-TYPE": "VSCode Extension",
		"X-CLIENT-VERSION": CLINE_EXTENSION_VERSION,
		"X-CORE-VERSION": CLINE_EXTENSION_VERSION,
	};
}

// =============================================================================
// Callback server
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
	const query = new URLSearchParams(
		parsed.search.slice(1).replace(/\+/g, "%2B"),
	);

	const token =
		query.get("refreshToken") || query.get("idToken") || query.get("code");
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
		if (serverTimeout) {
			clearTimeout(serverTimeout);
			serverTimeout = undefined;
		}
		if (signal && abortListener) {
			signal.removeEventListener("abort", abortListener);
			abortListener = undefined;
		}
		if (server) {
			server.close();
			server = undefined as any;
		}
	};

	const settle = (fn: () => void) => {
		if (settled) return;
		settled = true;
		cleanup();
		fn();
	};

	let server = http.createServer((req, res) => {
		try {
			const parsed = new NodeURL(
				req.url ?? "",
				`http://127.0.0.1:${selectedPort}`,
			);
			if (parsed.pathname !== AUTH_PATH) {
				res.writeHead(404);
				res.end("Not found");
				settle(() =>
					rejectWait?.(new Error(`Unexpected path: ${parsed.pathname}`)),
				);
				return;
			}
			const callback = parseCallback(req.url!, selectedPort);
			res.writeHead(200, { "Content-Type": "text/html" });
			res.end(successHTML);
			settle(() => resolveWait?.(callback));
		} catch (error) {
			res.writeHead(400);
			res.end("Bad request");
			settle(() =>
				rejectWait?.(
					error instanceof Error ? error : new Error("Callback parse failed"),
				),
			);
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
		throw new Error(
			`No available port for auth callback (tried ${ports[0]}-${ports[ports.length - 1]})`,
		);
	}

	serverTimeout = setTimeout(() => {
		settle(() => rejectWait?.(new Error("Callback server timed out")));
	}, CLINE_AUTH_TIMEOUT_MS);

	abortListener = () =>
		settle(() => rejectWait?.(new Error("Login cancelled")));
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
// Auth URL fetching
// =============================================================================

async function fetchAuthorizeUrl(
	callbackUrl: string,
	signal?: AbortSignal,
): Promise<string> {
	const authUrl = new NodeURL("auth/authorize", `${BASE_URL_CLINE}/`);
	authUrl.searchParams.set("client_type", "extension");
	authUrl.searchParams.set("callback_url", callbackUrl);
	authUrl.searchParams.set("redirect_uri", callbackUrl);

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 8000);

	try {
		const res = await fetch(authUrl.toString(), {
			method: "GET",
			redirect: "manual",
			credentials: "include",
			headers: buildClineHeaders(),
			signal: signal ?? controller.signal,
		});

		if (res.status >= 300 && res.status < 400) {
			const location = res.headers.get("Location");
			if (location) return location;
			throw new Error("No redirect URL found in auth response");
		}

		const json = (await res.json()) as { redirect_url?: string };
		if (
			typeof json?.redirect_url === "string" &&
			json.redirect_url.length > 0
		) {
			return json.redirect_url;
		}
		throw new Error("Unexpected response from auth server");
	} catch (error) {
		throw new Error(
			`Authentication request failed: ${error instanceof Error ? error.message : "unknown error"}`,
		);
	} finally {
		clearTimeout(timeout);
	}
}

// =============================================================================
// Code input handling
// =============================================================================

function parseManualInput(input: string): {
	code: string;
	provider: string | null;
} {
	const trimmed = input.trim();

	if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
		const cb = new NodeURL(trimmed);
		const urlCode =
			cb.searchParams.get("refreshToken") ||
			cb.searchParams.get("idToken") ||
			cb.searchParams.get("code");
		if (!urlCode) throw new Error("No code found in callback URL");
		return { code: urlCode, provider: cb.searchParams.get("provider") };
	}

	return { code: trimmed, provider: null };
}

type AuthCodeResult =
	| { type: "local"; code: string; provider: string | null }
	| { type: "manual"; code: string; provider: string | null };

async function waitForAuthCode(
	callbackServer: { waitForCode: Promise<CallbackResult>; close: () => void },
	onManualInput: OAuthLoginCallbacks["onManualCodeInput"],
	signal?: AbortSignal,
): Promise<AuthCodeResult> {
	if (!onManualInput) {
		const result = await callbackServer.waitForCode;
		return { type: "local", ...result };
	}

	const result = await Promise.race([
		callbackServer.waitForCode.then((r) => ({ type: "local" as const, ...r })),
		onManualInput().then((c) => ({ type: "manual" as const, code: c })),
	]);

	if (result.type === "local") {
		return result;
	}

	// Manual input - close server and parse
	callbackServer.close();
	if (signal?.aborted) throw new Error("Login cancelled");
	if (!result.code?.trim()) throw new Error("No code provided");

	const parsed = parseManualInput(result.code);
	return { type: "manual", ...parsed };
}

// =============================================================================
// Token exchange
// =============================================================================

interface TokenData {
	accessToken: string;
	refreshToken?: string;
	expiresAt: string;
}

async function exchangeCodeForTokens(
	code: string,
	provider: string | null,
	callbackUrl: string,
	signal?: AbortSignal,
): Promise<TokenData> {
	const providerCandidates: Array<string | null> = provider
		? [provider]
		: [null, "google", "github", "microsoft", "authkit"];

	let tokenData: TokenData | null = null;
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
			signal,
		});

		if (!res.ok) {
			lastError = `${res.status}: ${(await res.text().catch(() => "")).slice(0, 120)}`;
			continue;
		}

		const data = (await res.json()) as {
			success?: boolean;
			data?: TokenData;
		};

		if (data?.success && data.data?.accessToken) {
			tokenData = data.data;
			break;
		}
		lastError = "Invalid token response";
	}

	if (!tokenData) {
		throw new Error(
			`Cline token exchange failed${lastError ? ` (${lastError})` : ""}`,
		);
	}

	return tokenData;
}

function parseExpiresAt(expiresAt: string): number {
	const ms = Date.parse(expiresAt);
	if (Number.isNaN(ms))
		throw new Error("Cline auth response has invalid expiresAt");
	return Math.max(Date.now() + 30_000, ms - 5 * 60_000);
}

// =============================================================================
// Public API
// =============================================================================

export async function loginCline(
	callbacks: OAuthLoginCallbacks,
): Promise<OAuthCredentials> {
	callbacks.onProgress?.("Preparing Cline authentication...");

	const callbackServer = await startCallbackServer(callbacks.signal);
	logger.debug("Callback server started", { port: callbackServer.port });

	try {
		const authUrl = await fetchAuthorizeUrl(
			callbackServer.callbackUrl,
			callbacks.signal,
		);
		logger.debug("Auth URL fetched");

		callbacks.onAuth({
			url: authUrl,
			instructions:
				"Copy this URL and open it in a new browser tab:\n(The link may wrap — copy the full URL, not just the visible portion)",
		});

		callbacks.onProgress?.("Waiting for authentication callback...");

		const { code, provider } = await waitForAuthCode(
			callbackServer,
			callbacks.onManualCodeInput,
			callbacks.signal,
		);
		logger.debug("Auth code received", {
			provider,
			type: code.length > 50 ? "token" : "short",
		});

		callbacks.onProgress?.("Completing Cline authentication...");

		const tokenData = await exchangeCodeForTokens(
			code,
			provider,
			callbackServer.callbackUrl,
			callbacks.signal,
		);
		logger.info("Login successful");

		return {
			access: tokenData.accessToken,
			refresh: tokenData.refreshToken ?? "",
			expires: parseExpiresAt(tokenData.expiresAt),
		};
	} finally {
		callbackServer.close();
	}
}

export async function refreshClineToken(
	credentials: OAuthCredentials,
): Promise<OAuthCredentials> {
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
		throw new Error(
			"Cline token refresh failed. Run /login cline to re-authenticate.",
		);
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
