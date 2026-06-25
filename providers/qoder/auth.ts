/**
 * Qoder authentication — OAuth device flow + PAT exchange + token refresh.
 *
 * Qoder supports two authentication methods:
 *   1. **Personal Access Token (PAT):** A long-lived `pt-...` token that must
 *      be exchanged for a short-lived job token before it can be used for API calls.
 *      The PAT is stored and transparently re-exchanged on expiry.
 *   2. **OAuth Device Flow:** PKCE-based browser login, polls for token completion.
 *
 * This module handles login orchestration, token refresh, and credential caching.
 * It conforms to pi's OAuthLoginCallbacks interface so it works with `/login qoder`.
 */

import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
	OAuthCredentials,
	OAuthLoginCallbacks,
} from "@earendil-works/pi-ai";
import { getMachineId } from "./cosy.ts";

// ─── Constants ───────────────────────────────────────────────────────────────

const EXCHANGE_URL = "https://openapi.qoder.sh/api/v1/jobToken/exchange";
const USERINFO_URL = "https://openapi.qoder.sh/api/v1/userinfo";
const POLL_URL = "https://openapi.qoder.sh/api/v1/deviceToken/poll";
const REFRESH_URL = "https://center.qoder.sh/algo/api/v3/user/refresh_token";
const AUTH_FILE = join(homedir(), ".pi", "agent", "auth.json");
const UA = "pi-free-providers";

const PAT_REFRESH_PREFIX = "pat";

// ─── Types ───────────────────────────────────────────────────────────────────

/** Extended credentials with Qoder-specific identity fields. */
export interface QoderCredentials extends OAuthCredentials {
	userID: string;
	email: string;
	name: string;
	machineID: string;
}

interface PatExchangeResult {
	jobToken: string;
	jobRefreshToken: string;
	expiresAt: number;
}

// ─── PAT helpers ─────────────────────────────────────────────────────────────

function isPatRefresh(refresh: string): boolean {
	return refresh.startsWith(`${PAT_REFRESH_PREFIX}|`);
}

function encodePatRefresh(
	pat: string,
	jobRefreshToken: string,
	userID: string,
	machineID: string,
): string {
	return [PAT_REFRESH_PREFIX, pat, jobRefreshToken, userID, machineID].join(
		"|",
	);
}

function decodePatRefresh(refresh: string): {
	pat: string;
	jobRefreshToken: string;
	userID: string;
	machineID: string;
} {
	const parts = refresh.split("|");
	return {
		pat: parts[1] || "",
		jobRefreshToken: parts[2] || "",
		userID: parts[3] || "",
		machineID: parts[4] || "",
	};
}

/**
 * Exchange a Qoder PAT (pt-...) for a short-lived job token (jt-...).
 * This mirrors the official qodercli flow: PATs cannot authenticate API
 * calls directly — they must first be exchanged.
 */
async function exchangeJobToken(pat: string): Promise<PatExchangeResult> {
	const res = await fetch(EXCHANGE_URL, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Accept: "application/json",
			"User-Agent": UA,
			"Cosy-Version": "1.0.1",
			"Cosy-ClientType": "5",
		},
		body: JSON.stringify({ personal_token: pat }),
	});

	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(
			`Qoder PAT exchange failed: ${res.status} ${res.statusText}. ${text.slice(0, 200)}`,
		);
	}

	const data = (await res.json()) as {
		token?: string;
		refresh_token?: string;
		expires_at?: string;
		expires_in?: number;
	};

	if (!data.token) {
		throw new Error("Qoder PAT exchange returned no job token");
	}

	let expiresAt = Date.now() + 24 * 60 * 60 * 1000;
	if (data.expires_at) {
		const parsed = Date.parse(data.expires_at);
		if (!Number.isNaN(parsed)) expiresAt = parsed;
	} else if (data.expires_in) {
		// expires_in is in milliseconds per the observed API response
		expiresAt = Date.now() + data.expires_in;
	}

	return {
		jobToken: data.token,
		jobRefreshToken: data.refresh_token || "",
		expiresAt,
	};
}

/**
 * Fetch user profile using a job token. Best-effort; returns empty strings
 * on failure.
 */
async function fetchUserInfo(jobToken: string): Promise<{
	userID: string;
	email: string;
	name: string;
}> {
	let userID = "";
	let email = "";
	let name = "";
	try {
		const res = await fetch(USERINFO_URL, {
			headers: {
				Authorization: `Bearer ${jobToken}`,
				Accept: "application/json",
				"User-Agent": UA,
				"Cosy-Version": "1.0.1",
				"Cosy-ClientType": "5",
			},
		});
		if (res.ok) {
			const info = (await res.json()) as {
				id?: string;
				email?: string;
				name?: string;
				username?: string;
			};
			userID = info.id || "";
			email = info.email || "";
			name = info.name || info.username || "";
		}
	} catch {
		// Best-effort
	}
	return { userID, email, name };
}

/**
 * Build full Qoder credentials from a Personal Access Token.
 * Exchanges the PAT for a job token and resolves user identity.
 */
async function credentialsFromPat(pat: string): Promise<QoderCredentials> {
	const { jobToken, jobRefreshToken, expiresAt } = await exchangeJobToken(pat);
	const { userID, email, name } = await fetchUserInfo(jobToken);
	const machineID = getMachineId();

	return {
		refresh: encodePatRefresh(pat, jobRefreshToken, userID, machineID),
		access: jobToken,
		expires: expiresAt - 5 * 60 * 1000, // 5 min buffer
		userID,
		email,
		name,
		machineID,
	} as QoderCredentials;
}

// ─── PKCE helpers ────────────────────────────────────────────────────────────

function generatePKCE() {
	const codeVerifier = crypto.randomBytes(32).toString("base64url");
	const codeChallenge = crypto
		.createHash("sha256")
		.update(codeVerifier)
		.digest("base64url");
	return { codeVerifier, codeChallenge };
}

function parseExpiresAt(s?: string, expiresInSeconds?: number): number {
	if (s) {
		const t = Date.parse(s);
		if (!Number.isNaN(t)) return t;
		const ms = Number.parseInt(s, 10);
		if (!Number.isNaN(ms) && ms > 0) return ms;
	}
	if (expiresInSeconds && expiresInSeconds > 0) {
		return Date.now() + expiresInSeconds * 1000;
	}
	return Date.now() + 30 * 24 * 60 * 60 * 1000; // default 30 days
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
	if (signal?.aborted)
		return Promise.reject(signal.reason || new Error("Login cancelled"));
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			reject(signal?.reason || new Error("Login cancelled"));
		};
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

// ─── OAuth Device Flow ───────────────────────────────────────────────────────

async function buildDeviceFlowCredentials(
	callbacks: OAuthLoginCallbacks,
	tokenData: {
		token: string;
		user_id: string;
		refresh_token: string;
		expires_at?: string;
		expires_in?: number;
	},
	machineID: string,
): Promise<QoderCredentials> {
	const expireMs = parseExpiresAt(tokenData.expires_at, tokenData.expires_in);

	(callbacks as unknown as { onProgress?: (msg: string) => void }).onProgress?.(
		"Fetching user profile...",
	);
	let email = "";
	let name = "";
	try {
		const userinfoRes = await fetch(USERINFO_URL, {
			method: "GET",
			headers: {
				Authorization: `Bearer ${tokenData.token}`,
				Accept: "application/json",
				"User-Agent": UA,
			},
		});
		if (userinfoRes.ok) {
			const userinfo = (await userinfoRes.json()) as {
				email?: string;
				name?: string;
				username?: string;
			};
			email = userinfo.email || "";
			name = userinfo.name || userinfo.username || "";
		}
	} catch {
		// Best-effort
	}

	(callbacks as unknown as { onProgress?: (msg: string) => void }).onProgress?.(
		"Login successful!",
	);

	return {
		refresh: `${tokenData.refresh_token}|${tokenData.user_id}|${machineID}`,
		access: tokenData.token,
		expires: expireMs - 5 * 60 * 1000,
		userID: tokenData.user_id,
		email,
		name,
		machineID,
	} as QoderCredentials;
}

// ─── OAuth Device Flow ───────────────────────────────────────────────────────

/**
 * Run the PKCE-based OAuth device code flow.
 * Opens a browser URL for the user to authenticate, then polls for the token.
 */
async function runDeviceFlow(
	callbacks: OAuthLoginCallbacks,
): Promise<QoderCredentials> {
	const { codeVerifier, codeChallenge } = generatePKCE();
	const nonce = crypto.randomUUID();
	const machineID = getMachineId();

	const verificationURI = `https://qoder.com/device/selectAccounts?challenge=${codeChallenge}&challenge_method=S256&machine_id=${machineID}&nonce=${nonce}`;

	// Notify user
	(callbacks as unknown as { onProgress?: (msg: string) => void }).onProgress?.(
		"Please complete login in your browser...",
	);

	(
		callbacks as unknown as {
			onAuth?: (info: { url: string; instructions: string }) => void;
		}
	).onAuth?.({
		url: verificationURI,
		instructions: "Click to sign in with your Qoder account in the browser.",
	});

	const pollURL = `${POLL_URL}?nonce=${encodeURIComponent(nonce)}&verifier=${encodeURIComponent(codeVerifier)}&challenge_method=S256`;
	const pollInterval = 2000;
	const maxAttempts = 90; // 3 minutes

	// Helper to read signal
	const getSignal = (): AbortSignal | undefined =>
		(callbacks as unknown as { signal?: AbortSignal }).signal;

	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		if (getSignal()?.aborted) throw new Error("Login cancelled");
		await abortableDelay(pollInterval, getSignal());

		try {
			const response = await fetch(pollURL, {
				method: "GET",
				headers: {
					Accept: "application/json",
					"User-Agent": UA,
				},
				signal: getSignal(),
			});

			if (response.status === 202 || response.status === 404) {
				continue;
			}

			if (!response.ok) {
				const errText = await response.text();
				throw new Error(
					`Device token poll failed: ${response.status} ${response.statusText}. Response: ${errText}`,
				);
			}

			const tokenData = (await response.json()) as {
				token: string;
				user_id: string;
				refresh_token: string;
				expires_at?: string;
				expires_in?: number;
			};

			if (!tokenData.token) {
				throw new Error("Device token poll returned empty access token");
			}

			return buildDeviceFlowCredentials(callbacks, tokenData, machineID);
		} catch (e: unknown) {
			const err = e as { name?: string };
			if (err.name === "AbortError" || getSignal()?.aborted) {
				throw new Error("Login cancelled");
			}
			throw e;
		}
	}

	throw new Error("Authorization timed out");
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Retrieve cached Qoder credentials (userID/email/name/machineID) from
 * pi's auth store. Best-effort — returns null if not found.
 */
export function getCachedCredentials(): QoderCredentials | null {
	if (existsSync(AUTH_FILE)) {
		try {
			const auth = JSON.parse(readFileSync(AUTH_FILE, "utf-8"));
			const creds = auth?.qoder;
			if (creds?.userID) {
				return creds as QoderCredentials;
			}
		} catch {
			// Best-effort
		}
	}
	return null;
}

/**
 * Main login handler for `/login qoder`.
 *
 * Flow:
 * 1. Check for PAT in env vars (QODER_PERSONAL_ACCESS_TOKEN or QODER_PAT)
 * 2. If no PAT, prompt user for one (or choose browser login)
 * 3. Exchange PAT for job token or run OAuth device flow
 * 4. Cache models after login
 */
export async function loginQoder(
	callbacks: OAuthLoginCallbacks,
): Promise<OAuthCredentials> {
	// 1. Try environment variables first (PAT)
	const pat = process.env.QODER_PERSONAL_ACCESS_TOKEN || process.env.QODER_PAT;
	if (pat) {
		try {
			const creds = await credentialsFromPat(pat);
			return creds as OAuthCredentials;
		} catch {
			(
				callbacks as unknown as { onProgress?: (msg: string) => void }
			).onProgress?.(
				"Environment PAT invalid, falling back to interactive login...",
			);
		}
	}

	// 2. Prompt for PAT or browser login
	const prompt = (
		callbacks as unknown as {
			onPrompt: (p: {
				message: string;
				placeholder?: string;
				allowEmpty?: boolean;
			}) => Promise<string>;
		}
	).onPrompt;

	if (!prompt) {
		throw new Error("Login cancelled: no prompt handler available");
	}

	const entered = await prompt({
		message:
			"Paste a Qoder Personal Access Token (pt-...), or leave empty for browser login",
		placeholder: "pt-...",
		allowEmpty: true,
	});

	if ((callbacks as unknown as { signal?: AbortSignal }).signal?.aborted) {
		throw new Error("Login cancelled");
	}

	if (entered?.trim()) {
		const creds = await credentialsFromPat(entered.trim());
		return creds as OAuthCredentials;
	}

	// 3. OAuth device flow
	return runDeviceFlow(callbacks) as Promise<OAuthCredentials>;
}

/**
 * Token refresh handler.
 *
 * For PAT-based credentials: re-exchanges the stored PAT for a fresh job token.
 * For OAuth-based credentials: calls the refresh_token endpoint.
 * Falls back to extending validity by 1 hour if refresh fails.
 */
export async function refreshQoderToken(
	credentials: OAuthCredentials,
): Promise<OAuthCredentials> {
	// PAT-based: re-exchange
	if (isPatRefresh(credentials.refresh)) {
		const { pat } = decodePatRefresh(credentials.refresh);
		if (pat) {
			try {
				const refreshed = await credentialsFromPat(pat);
				return refreshed as OAuthCredentials;
			} catch {
				// Fall through to validity extension
			}
		}
		return {
			...credentials,
			expires: Date.now() + 60 * 60 * 1000, // extend 1 hour
		};
	}

	// OAuth-based: use refresh token
	const parts = credentials.refresh.split("|");
	const refreshToken = parts[0] || "";
	const userID = parts[1] || "";
	const machineID = parts[2] || getMachineId();
	const prev = credentials as Partial<QoderCredentials>;
	const prevName = prev.name || "";
	const prevEmail = prev.email || "";

	try {
		const response = await fetch(REFRESH_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${credentials.access}`,
				Accept: "application/json",
				"User-Agent": UA,
			},
			body: JSON.stringify({ refreshToken }),
		});

		if (response.ok) {
			const data = (await response.json()) as {
				token: string;
				refresh_token?: string;
				expires_at?: string;
				expires_in?: number;
			};

			const newAccess = data.token;
			const newRefresh = data.refresh_token || refreshToken;

			let expireMs = Date.now() + 30 * 24 * 60 * 60 * 1000;
			if (data.expires_at) {
				const parsed = Date.parse(data.expires_at);
				if (!Number.isNaN(parsed)) expireMs = parsed;
			} else if (data.expires_in) {
				expireMs = Date.now() + data.expires_in * 1000;
			}

			return {
				...credentials,
				refresh: `${newRefresh}|${userID}|${machineID}`,
				access: newAccess,
				expires: expireMs - 5 * 60 * 1000,
				userID,
				email: prevEmail,
				name: prevName,
				machineID,
			} as QoderCredentials;
		}
	} catch {
		// Fall through
	}

	// Fallback: extend validity by 1 hour
	return {
		...credentials,
		expires: Date.now() + 60 * 60 * 1000,
	};
}
