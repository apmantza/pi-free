/**
 * Qwen OAuth Device Authorization Flow (RFC 8628 with PKCE)
 *
 * Provides 1,000 free API calls/day via Qwen's OAuth device flow.
 * Based on the official qwen-code implementation.
 *
 * Flow:
 *   1. Generate PKCE code_verifier and code_challenge
 *   2. Request device authorization (get user_code + verification URL)
 *   3. Open browser for user to authorize
 *   4. Poll token endpoint until user approves
 *   5. Receive access_token + refresh_token
 */

import crypto from "node:crypto";
import { spawn } from "node:child_process";
import type {
	OAuthCredentials,
	OAuthLoginCallbacks,
} from "@mariozechner/pi-ai";
import { createLogger } from "../lib/logger.ts";

const _logger = createLogger("qwen-auth");

// =============================================================================
// OAuth Configuration (from official qwen-code)
// =============================================================================

const QWEN_OAUTH_BASE_URL = "https://chat.qwen.ai";
const QWEN_OAUTH_DEVICE_CODE_ENDPOINT = `${QWEN_OAUTH_BASE_URL}/api/v1/oauth2/device/code`;
const QWEN_OAUTH_TOKEN_ENDPOINT = `${QWEN_OAUTH_BASE_URL}/api/v1/oauth2/token`;
const QWEN_OAUTH_CLIENT_ID = "f0304373b74a44d2b584a3fb70ca9e56";
const QWEN_OAUTH_SCOPE = "openid profile email model.completion";
const QWEN_OAUTH_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";

// Polling configuration
const INITIAL_POLL_INTERVAL_MS = 2000;
const MAX_POLL_INTERVAL_MS = 10000;

// =============================================================================
// PKCE Utilities
// =============================================================================

function generateCodeVerifier(): string {
	return crypto.randomBytes(32).toString("base64url");
}

function generateCodeChallenge(codeVerifier: string): string {
	return crypto
		.createHash("sha256")
		.update(codeVerifier)
		.digest("base64url");
}

function generatePKCEPair(): {
	code_verifier: string;
	code_challenge: string;
} {
	const codeVerifier = generateCodeVerifier();
	const codeChallenge = generateCodeChallenge(codeVerifier);
	return { code_verifier: codeVerifier, code_challenge: codeChallenge };
}

// =============================================================================
// Helpers
// =============================================================================

function objectToUrlEncoded(data: Record<string, string>): string {
	return Object.keys(data)
		.map(
			(key) =>
				`${encodeURIComponent(key)}=${encodeURIComponent(data[key])}`,
		)
		.join("&");
}

function openBrowser(url: string): void {
	try {
		if (process.platform === "win32") {
			spawn("cmd", ["/c", "start", "", url], {
				detached: true,
				shell: false,
				windowsHide: true,
			}).unref();
		} else if (process.platform === "darwin") {
			spawn("open", [url], { detached: true }).unref();
		} else {
			spawn("xdg-open", [url], { detached: true }).unref();
		}
	} catch (err) {
		_logger.debug("Failed to open browser", { error: String(err) });
	}
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new Error("Login cancelled"));
			return;
		}
		const timeout = setTimeout(resolve, ms);
		signal?.addEventListener(
			"abort",
			() => {
				clearTimeout(timeout);
				reject(new Error("Login cancelled"));
			},
			{ once: true },
		);
	});
}

// =============================================================================
// API Types
// =============================================================================

interface DeviceAuthorizationData {
	device_code: string;
	user_code: string;
	verification_uri: string;
	verification_uri_complete: string;
	expires_in: number;
}

interface DeviceTokenData {
	access_token: string | null;
	refresh_token?: string | null;
	token_type: string;
	expires_in: number | null;
	resource_url?: string;
}

interface ErrorData {
	error: string;
	error_description?: string;
}

// =============================================================================
// OAuth Flow
// =============================================================================

async function requestDeviceAuthorization(
	codeChallenge: string,
	signal?: AbortSignal,
): Promise<DeviceAuthorizationData> {
	const bodyData = {
		client_id: QWEN_OAUTH_CLIENT_ID,
		scope: QWEN_OAUTH_SCOPE,
		code_challenge: codeChallenge,
		code_challenge_method: "S256",
	};

	const response = await fetch(QWEN_OAUTH_DEVICE_CODE_ENDPOINT, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			Accept: "application/json",
		},
		body: objectToUrlEncoded(bodyData),
		signal,
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(
			`Device authorization failed: ${response.status} ${errorText}`,
		);
	}

	const result = (await response.json()) as
		| DeviceAuthorizationData
		| ErrorData;

	if ("error" in result) {
		throw new Error(
			`Device authorization failed: ${result.error} - ${result.error_description ?? "No details"}`,
		);
	}

	return result as DeviceAuthorizationData;
}

async function pollDeviceToken(
	deviceCode: string,
	codeVerifier: string,
	signal?: AbortSignal,
): Promise<
	| { type: "success"; data: DeviceTokenData }
	| { type: "pending"; slowDown?: boolean }
	| { type: "error"; error: string }
> {
	const bodyData = {
		grant_type: QWEN_OAUTH_GRANT_TYPE,
		client_id: QWEN_OAUTH_CLIENT_ID,
		device_code: deviceCode,
		code_verifier: codeVerifier,
	};

	const response = await fetch(QWEN_OAUTH_TOKEN_ENDPOINT, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			Accept: "application/json",
		},
		body: objectToUrlEncoded(bodyData),
		signal,
	});

	if (!response.ok) {
		const responseText = await response.text();
		let errorData: ErrorData | null = null;
		try {
			errorData = JSON.parse(responseText) as ErrorData;
		} catch {
			return { type: "error", error: responseText };
		}

		// RFC 8628: authorization_pending = keep polling
		if (
			response.status === 400 &&
			errorData.error === "authorization_pending"
		) {
			return { type: "pending" };
		}

		// RFC 8628: slow_down = increase interval
		if (response.status === 429 && errorData.error === "slow_down") {
			return { type: "pending", slowDown: true };
		}

		return {
			type: "error",
			error: `${errorData.error}: ${errorData.error_description ?? "Unknown"}`,
		};
	}

	const data = (await response.json()) as DeviceTokenData;
	if (data.access_token) {
		return { type: "success", data };
	}
	return { type: "pending" };
}

// =============================================================================
// Public API
// =============================================================================

export async function loginQwen(
	callbacks: OAuthLoginCallbacks,
): Promise<OAuthCredentials> {
	callbacks.onProgress?.("Initiating Qwen OAuth device authorization...");

	// 1. Generate PKCE pair
	const { code_verifier, code_challenge } = generatePKCEPair();

	// 2. Request device authorization
	const deviceAuth = await requestDeviceAuthorization(
		code_challenge,
		callbacks.signal,
	);

	_logger.info("Device authorization received", {
		userCode: deviceAuth.user_code,
		verificationUri: deviceAuth.verification_uri,
	});

	// 3. Use verification_uri_complete directly (server already embedded the code)
	// If not available, fall back to verification_uri + user_code
	const authUrl = deviceAuth.verification_uri_complete || deviceAuth.verification_uri;
	const instructions = deviceAuth.verification_uri_complete
		? undefined // Code is already embedded in the URL
		: `Enter code: ${deviceAuth.user_code}`;

	_logger.info("Opening auth URL", { url: authUrl });

	// 4. Show auth URL to user
	callbacks.onAuth({ url: authUrl, instructions });

	// 5. Open browser
	openBrowser(authUrl);

	callbacks.onProgress?.("Waiting for browser authorization...");

	// 6. Poll for token
	const deadline = Date.now() + deviceAuth.expires_in * 1000;
	let pollInterval = INITIAL_POLL_INTERVAL_MS;

	while (Date.now() < deadline) {
		if (callbacks.signal?.aborted) throw new Error("Login cancelled");

		const result = await pollDeviceToken(
			deviceAuth.device_code,
			code_verifier,
			callbacks.signal,
		);

		if (result.type === "success") {
			const { data } = result;
			callbacks.onProgress?.("Login successful!");

			// Store resource_url in refresh token so we can recover it later
			const resourceUrl = data.resource_url || "";
			const combinedRefresh = resourceUrl
				? `${resourceUrl}::${data.refresh_token ?? ""}`
				: data.refresh_token ?? "";

			return {
				access: data.access_token!,
				refresh: combinedRefresh,
				expires: data.expires_in
					? Date.now() + data.expires_in * 1000
					: Date.now() + 3600 * 1000, // 1 hour default
			};
		}

		if (result.type === "error") {
			throw new Error(`Qwen OAuth failed: ${result.error}`);
		}

		// Handle slow_down
		if (result.slowDown) {
			pollInterval = Math.min(pollInterval * 1.5, MAX_POLL_INTERVAL_MS);
		}

		const remaining = Math.ceil((deadline - Date.now()) / 1000);
		callbacks.onProgress?.(
			`Waiting for authorization... (${remaining}s remaining)`,
		);

		await abortableSleep(pollInterval, callbacks.signal);
	}

	throw new Error("Qwen OAuth timed out. Please try again.");
}

export async function refreshQwenToken(
	credentials: OAuthCredentials,
): Promise<OAuthCredentials> {
	// If token hasn't expired, return as-is
	if (credentials.expires > Date.now()) {
		return credentials;
	}

	// Parse the combined refresh token
	const refreshToken = credentials.refresh;
	const parts = refreshToken.split("::");
	const actualRefreshToken = parts.length > 1 ? parts[1] : parts[0];

	if (!actualRefreshToken) {
		throw new Error(
			"No refresh token available. Run /login qwen to re-authenticate.",
		);
	}

	_logger.info("Refreshing Qwen OAuth token...");

	const bodyData = {
		grant_type: "refresh_token",
		refresh_token: actualRefreshToken,
		client_id: QWEN_OAUTH_CLIENT_ID,
	};

	const response = await fetch(QWEN_OAUTH_TOKEN_ENDPOINT, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			Accept: "application/json",
		},
		body: objectToUrlEncoded(bodyData),
	});

	if (!response.ok) {
		throw new Error(
			"Qwen token refresh failed. Run /login qwen to re-authenticate.",
		);
	}

	const data = (await response.json()) as DeviceTokenData & ErrorData;

	if ("error" in data && data.error) {
		throw new Error(
			`Qwen token refresh failed: ${data.error}. Run /login qwen to re-authenticate.`,
		);
	}

	if (!data.access_token) {
		throw new Error("Qwen token refresh returned no access token.");
	}

	// Preserve resource_url in refresh token
	const resourceUrl = data.resource_url || "";
	const combinedRefresh = resourceUrl
		? `${resourceUrl}::${data.refresh_token ?? actualRefreshToken}`
		: data.refresh_token ?? actualRefreshToken;

	return {
		access: data.access_token,
		refresh: combinedRefresh,
		expires: data.expires_in
			? Date.now() + data.expires_in * 1000
			: Date.now() + 3600 * 1000,
	};
}

/**
 * Extract the API base URL from credentials.
 * The resource_url is stored inside the refresh token.
 */
export function getQwenBaseUrl(credentials: OAuthCredentials): string {
	const refreshToken = credentials.refresh;
	const parts = refreshToken.split("::");
	const resourceUrl = parts.length > 1 ? parts[0] : "";

	if (resourceUrl) {
		const normalized = resourceUrl.startsWith("http")
			? resourceUrl
			: `https://${resourceUrl}`;
		return normalized.endsWith("/v1")
			? normalized
			: `${normalized}/v1`;
	}

	// Default DashScope endpoint
	return "https://dashscope.aliyuncs.com/compatible-mode/v1";
}
