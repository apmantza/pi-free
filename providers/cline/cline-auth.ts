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
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { URL as NodeURL } from "node:url";
import type {
	ApiKeyAuth,
	ApiKeyCredential,
	AuthContext,
	AuthInteraction,
	AuthResult,
	ModelAuth,
	OAuthAuth,
	OAuthCredential,
	OAuthCredentials,
	OAuthLoginCallbacks,
	ProviderAuth,
} from "@earendil-works/pi-ai/compat";
import { getClineApiKey } from "../../config.ts";
import {
	BASE_URL_CLINE,
	CLINE_AUTH_TIMEOUT_MS,
	CLINE_EXTENSION_VERSION,
	VS_CODE_VERSION,
} from "../../constants.ts";
import { createLogger } from "../../lib/logger.ts";

const logger = createLogger("cline-auth");

// =============================================================================
// Port range for callback server (matches official Cline CLI AuthHandler)
const CALLBACK_PORT_START = 48801;
const CALLBACK_PORT_END = 48811;
const AUTH_PATH = "/auth";

// =============================================================================
// Headers (must match real Cline VS Code extension exactly)

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
		parsed.search.slice(1).replaceAll("+", "%2B"),
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
			`No available port for auth callback (tried ${ports[0]}-${ports.at(-1)})`,
		);
	}

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
// Auth URL fetching
// =============================================================================

const ALLOWED_CLINE_AUTH_HOSTS = new Set(["api.cline.bot"]);

async function fetchAuthorizeUrl(
	callbackUrl: string,
	signal?: AbortSignal,
): Promise<string> {
	const authUrl = new NodeURL("auth/authorize", `${BASE_URL_CLINE}/`);
	// Allowlist the outbound host: the authorize request must only ever target
	// the pinned Cline API host, never a caller-influenced URL.
	if (!ALLOWED_CLINE_AUTH_HOSTS.has(authUrl.hostname)) {
		throw new Error(
			`Cline auth URL host ${authUrl.hostname} is not on the allowlist`,
		);
	}
	authUrl.searchParams.set("client_type", "extension");
	authUrl.searchParams.set("callback_url", callbackUrl);
	authUrl.searchParams.set("redirect_uri", callbackUrl);

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 8000);

	try {
		// pi-lens-ignore: ts-ssrf — false positive: authUrl is built solely from
		// the compile-time BASE_URL_CLINE constant and its hostname is verified
		// against ALLOWED_CLINE_AUTH_HOSTS immediately above; callbackUrl only
		// feeds query parameters, never the request target.
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
		if (typeof json?.redirect_url === "string" && json.redirect_url.length > 0) {
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

async function attemptClineTokenRefresh(
	credentials: OAuthCredentials,
): Promise<OAuthCredentials> {
	const res = await fetch(`${BASE_URL_CLINE}/auth/refresh`, {
		method: "POST",
		headers: buildClineHeaders(),
		body: JSON.stringify({
			refreshToken: credentials.refresh,
			grantType: "refresh_token",
		}),
	});

	if (!res.ok) {
		throw new Error(`Cline token refresh failed with status ${res.status}`);
	}

	const data = (await res.json()) as {
		success?: boolean;
		data?: { accessToken: string; refreshToken?: string; expiresAt: string };
	};

	if (!data?.success || !data.data) {
		throw new Error(
			`Invalid Cline refresh response (success=${data?.success}, hasData=${!!data?.data})`,
		);
	}

	return {
		access: data.data.accessToken,
		refresh: data.data.refreshToken ?? credentials.refresh,
		expires: parseExpiresAt(data.data.expiresAt),
	};
}

export async function refreshClineToken(
	credentials: OAuthCredentials,
): Promise<OAuthCredentials> {
	if (credentials.expires > Date.now()) return credentials;

	try {
		return await attemptClineTokenRefresh(credentials);
	} catch (firstErr) {
		logger.warn("Cline token refresh failed, retrying in 1 s", {
			error: firstErr instanceof Error ? firstErr.message : String(firstErr),
		});
		await new Promise((resolve) => setTimeout(resolve, 1000));
		try {
			return await attemptClineTokenRefresh(credentials);
		} catch (secondErr) {
			logger.warn("Cline token refresh failed after retry", {
				error: secondErr instanceof Error ? secondErr.message : String(secondErr),
			});
			throw new Error(
				"Cline token refresh failed. Run /login cline to re-authenticate.",
			);
		}
	}
}

// =============================================================================
// Native ProviderAuth (createProvider object form)
// =============================================================================

/**
 * Derive the Cline request API key from an OAuth credential: Cline expects the
 * access token as a bearer value prefixed with `workos:` (idempotent). This is
 * the native `toAuth` equivalent of the legacy `oauth.getApiKey` config field.
 */
export function toApiKey(credentials: OAuthCredentials): string {
	const token = credentials.access;
	return token.startsWith("workos:") ? token : `workos:${token}`;
}

/**
 * Run the proven Cline OAuth flow (local callback server + browser) against the
 * native `AuthInteraction`. The mapping mirrors Pi's own legacy-OAuth adapter
 * (provider-composer `adaptOAuth`), so the flow behaves exactly as it did under
 * the legacy `oauth:` registration config: `onAuth` → `auth_url` notification,
 * `onProgress` → `progress`, manual code input → `manual_code` prompt. Returns
 * a canonical OAuth credential Pi persists to the shared auth store.
 */
export async function loginClineNative(
	interaction: AuthInteraction,
): Promise<OAuthCredential> {
	const credential = await loginCline({
		onAuth: (info) =>
			interaction.notify({
				type: "auth_url",
				url: info.url,
				instructions: info.instructions,
			}),
		onDeviceCode: (info) => interaction.notify({ type: "device_code", ...info }),
		onPrompt: (prompt) =>
			interaction.prompt({
				type: "text",
				message: prompt.message,
				placeholder: prompt.placeholder,
			}),
		onProgress: (message) => interaction.notify({ type: "progress", message }),
		onManualCodeInput: () =>
			interaction.prompt({
				type: "manual_code",
				message: "Paste the authorization code",
			}),
		onSelect: (prompt) =>
			interaction.prompt({
				type: "select",
				message: prompt.message,
				options: prompt.options,
			}),
		signal: interaction.signal,
	});
	return { ...credential, type: "oauth" };
}

/**
 * Native OAuth refresh. Delegates to the proven `refreshClineToken` (still-valid
 * credential returned as-is; expired → one retry, then throw so Pi preserves the
 * stored credential and `/login cline` re-authenticates). Pi runs this under the
 * credential-store lock before any network access, replacing the refresh the
 * legacy `oauth.refreshToken` config required Pi's composer to adapt.
 */
export async function refreshClineCredential(
	credential: OAuthCredential,
	_signal?: AbortSignal,
): Promise<OAuthCredential> {
	return { ...(await refreshClineToken(credential)), type: "oauth" };
}

/**
 * Resolve the effective Cline API key: a natively-stored key wins, then the
 * ambient `CLINE_API_KEY` env var / `~/.pi/free.json` value.
 *
 * Cline-specific deviation from the Kilo recipe: when NO key is configured this
 * still resolves — with an empty `auth` — instead of returning undefined. Cline's
 * model catalog is public (the legacy factory fetched it with no credential, so
 * models appeared before `/login cline`). Pi's `Models.refresh()` skips providers
 * whose auth does not resolve, which would leave logged-out users with no models
 * at all (no offline init, no background refresh). Always resolving keeps the
 * catalog flowing for everyone — this is Pi's sanctioned keyless pattern (the
 * pi-ai `faux` provider does the same) — while chat requests without a token
 * still fail fast in the XML bridge with an actionable message. Do not add
 * `apiKey.check`: Pi runs that check before `filterModels` and would hide this
 * intentionally public catalog when the user is logged out.
 */
// =============================================================================
// Cline CLI credential fallback
// =============================================================================

/** Cline CLI's provider settings store (auth.json on other platforms). */
const CLINE_CLI_PROVIDERS_PATH = join(
	homedir(),
	".cline",
	"data",
	"settings",
	"providers.json",
);

/**
 * Best-effort read of the durable Cline API key from the Cline CLI's
 * `providers.json` (structure: `providers["cline"]/["cline-pass"].settings.apiKey`).
 * Used only as a fallback so `cline auth` users get zero-config login in
 * pi-free without re-entering a key. Silently returns undefined on any error
 * (missing/malformed file) — credential failures must never break auth.
 *
 * NOTE: the CLI also stores short-lived WorkOS `settings.auth.accessToken`s;
 * those are deliberately NOT read here because refreshing them is owned by
 * Pi's native OAuth lifecycle, not the apiKey.resolve path.
 */
export function readClineCliApiKey(
	providersPath: string = CLINE_CLI_PROVIDERS_PATH,
): string | undefined {
	try {
		if (!providersPath || !existsSync(providersPath)) return undefined;
		const raw = JSON.parse(readFileSync(providersPath, "utf8")) as {
			providers?: Record<string, { settings?: { apiKey?: unknown } } | undefined>;
		};
		for (const name of ["cline-pass", "cline"] as const) {
			const apiKey = raw.providers?.[name]?.settings?.apiKey;
			if (typeof apiKey === "string" && apiKey.length > 0) return apiKey;
		}
	} catch {
		// Best-effort: malformed or unreadable CLI config must not fail auth.
	}
	return undefined;
}

/**
 * Resolve the effective Cline API key: a natively-stored key wins, then the
 * ambient `CLINE_API_KEY` env var / `~/.pi/free.json` value, then the Cline
 * CLI's durable API key (`~/.cline/data/settings/providers.json`).
 */
async function resolveClineApiKey(input: {
	ctx: AuthContext;
	credential?: ApiKeyCredential;
	signal?: AbortSignal;
}): Promise<AuthResult | undefined> {
	const key = input.credential?.key ?? getClineApiKey() ?? readClineCliApiKey();
	if (!key) {
		return { auth: {}, source: "public catalog (no account)" };
	}
	return {
		auth: { apiKey: key },
		source: input.credential?.key
			? "stored API key"
			: getClineApiKey()
				? "CLINE_API_KEY"
				: "Cline CLI",
	};
}

export const clineApiKeyAuth: ApiKeyAuth = {
	name: "Cline API key",
	async login(interaction: AuthInteraction): Promise<ApiKeyCredential> {
		const key = await interaction.prompt({
			type: "secret",
			message: "Cline API key",
		});
		return { type: "api_key", key };
	},
	resolve: resolveClineApiKey,
};

export const clineOAuthAuth: OAuthAuth = {
	name: "Cline",
	loginLabel: "Sign in with Cline",
	login: loginClineNative,
	refresh: refreshClineCredential,
	async toAuth(credential: OAuthCredential): Promise<ModelAuth> {
		return { apiKey: toApiKey(credential) };
	},
};

/** Native auth for the Cline provider: API key and OAuth (callback-server flow). */
export const clineAuth: ProviderAuth = {
	apiKey: clineApiKeyAuth,
	oauth: clineOAuthAuth,
};
