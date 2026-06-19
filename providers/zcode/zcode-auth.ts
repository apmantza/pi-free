/**
 * ZCode OAuth device-poll flow.
 *
 * Reverse-engineered from TriDefender/zcode-api (src/auth/oauth.ts).
 *
 * Flow:
 *   1. POST /oauth/cli/init with a random pollToken → returns flow_id, authorize_url, expires_at
 *   2. User opens authorize_url in browser, logs in to Z.ai, grants access
 *   3. Poll GET /oauth/cli/poll/{flowId} with pollToken → eventually returns
 *      { status: "ready", token: <jwt>, zai: { access_token }, user: { user_id } }
 *   4. We extract `token` as the start-plan JWT and `zai.access_token` as
 *      the coding-plan API key fallback.
 *
 * The `token` (JWT) is what we send as `Authorization: Bearer <jwt>` to the
 * start-plan gateway at zcode.z.ai/api/v1/zcode-plan. The `zai.access_token`
 * is the longer-lived Z.AI API key, kept around as a fallback for the paid
 * coding-plan tier.
 */

import { randomBytes, randomUUID } from "node:crypto";
import type {
	OAuthCredentials,
	OAuthLoginCallbacks,
} from "@earendil-works/pi-ai";
import {
	ZCODE_OAUTH_BASE,
	ZCODE_POLL_INTERVAL_MS,
	ZCODE_TOKEN_EXPIRATION_MS,
} from "../../constants.ts";
import { createLogger } from "../../lib/logger.ts";
import { openBrowser } from "../../lib/open-browser.ts";

const _logger = createLogger("zcode-auth");

// =============================================================================
// Types
// =============================================================================

interface ZaiEnvelope<T = Record<string, unknown>> {
	code: number;
	data?: T;
	msg?: string;
}

interface OAuthInitData {
	flow_id: string;
	poll_token?: string;
	authorize_url: string;
	expires_at: number;
	poll_interval_sec: number;
}

interface OAuthPollData {
	status: "pending" | "ready" | "failed";
	token?: string;
	zai?: { access_token?: string };
	user?: { user_id?: string };
}

interface OAuthInitResponse {
	flowId: string;
	pollToken: string;
	authorizeUrl: string;
	expiresAt: number;
	pollIntervalSec: number;
}

// =============================================================================
// Helpers
// =============================================================================

function generatePollToken(): string {
	return randomBytes(32).toString("hex");
}

function safeJsonParse<T>(text: string): T | null {
	try {
		return JSON.parse(text) as T;
	} catch {
		return null;
	}
}

function unwrapZaiEnvelope<T>(
	raw: unknown,
	httpStatus: number,
): T {
	const env = raw as ZaiEnvelope<T> | null;
	if (!env || typeof env.code !== "number") {
		throw new Error(
			`Invalid OAuth response envelope (httpStatus=${httpStatus})`,
		);
	}
	if (env.code !== 0) {
		throw new Error(env.msg ?? `OAuth business error: code=${env.code}`);
	}
	return (env.data ?? ({} as T)) as T;
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new Error("Login cancelled"));
			return;
		}
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			reject(new Error("Login cancelled"));
		};
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

// =============================================================================
// OAuth init / poll
// =============================================================================

async function initOAuth(): Promise<OAuthInitResponse> {
	const pollToken = generatePollToken();

	const resp = await fetch(`${ZCODE_OAUTH_BASE}/oauth/cli/init`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: `Bearer ${pollToken}`,
		},
		body: JSON.stringify({ provider: "zai" }),
	});

	const raw = safeJsonParse<ZaiEnvelope<OAuthInitData>>(
		await resp.text(),
	);
	if (!resp.ok) {
		const msg = (raw as ZaiEnvelope | null)?.msg;
		throw new Error(
			`ZCode OAuth init failed: ${resp.status}${msg ? ` — ${msg}` : ""}`,
		);
	}

	const data = unwrapZaiEnvelope<OAuthInitData>(raw, resp.status);

	if (
		typeof data.flow_id !== "string" ||
		typeof data.authorize_url !== "string" ||
		typeof data.expires_at !== "number" ||
		typeof data.poll_interval_sec !== "number"
	) {
		throw new Error(
			`Invalid ZCode OAuth init response: ${JSON.stringify(data).slice(0, 200)}`,
		);
	}

	return {
		flowId: data.flow_id,
		pollToken,
		authorizeUrl: data.authorize_url,
		// expires_at is in seconds
		expiresAt: data.expires_at * 1000,
		pollIntervalSec: data.poll_interval_sec,
	};
}

async function pollOAuth(
	flowId: string,
	pollToken: string,
): Promise<OAuthPollData> {
	const resp = await fetch(
		`${ZCODE_OAUTH_BASE}/oauth/cli/poll/${encodeURIComponent(flowId)}`,
		{
			method: "GET",
			headers: { authorization: `Bearer ${pollToken}` },
		},
	);

	const raw = safeJsonParse<ZaiEnvelope<OAuthPollData>>(await resp.text());
	if (!resp.ok) {
		// 400/404/408 -> poll failure
		if (
			resp.status === 400 ||
			resp.status === 404 ||
			resp.status === 408
		) {
			return { status: "failed" };
		}
		const msg = (raw as ZaiEnvelope | null)?.msg;
		throw new Error(
			`ZCode OAuth poll failed: ${resp.status}${msg ? ` — ${msg}` : ""}`,
		);
	}

	const data = unwrapZaiEnvelope<OAuthPollData>(raw, resp.status);
	if (
		data.status !== "pending" &&
		data.status !== "ready" &&
		data.status !== "failed"
	) {
		throw new Error(`Invalid OAuth poll status: ${String(data.status)}`);
	}
	return data;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Run the full ZCode OAuth login flow.
 * Returns OAuthCredentials where:
 *   - `access` = the start-plan JWT (what we send as Bearer to /zcode-plan/...)
 *   - `refresh` = the Z.AI upstream access_token (kept as fallback)
 *   - `jwt` = same as `access`, surfaced for downstream code
 *   - `userId` = upstream user id (for accounting)
 */
export async function loginZcode(
	callbacks: OAuthLoginCallbacks,
): Promise<OAuthCredentials> {
	callbacks.onProgress?.("Initiating ZCode device authorization...");

	const init = await initOAuth();
	_logger.debug("OAuth init OK", {
		flowId: init.flowId,
		expiresAt: new Date(init.expiresAt).toISOString(),
		pollIntervalSec: init.pollIntervalSec,
	});

	callbacks.onAuth({
		url: init.authorizeUrl,
		instructions:
			"Sign in with your Z.ai account, then click 'Authorize' to connect ZCode.",
	});
	openBrowser(init.authorizeUrl);
	callbacks.onProgress?.("Waiting for browser authorization...");

	const intervalMs = Math.max(
		ZCODE_POLL_INTERVAL_MS,
		init.pollIntervalSec * 1000,
	);
	const deadline = init.expiresAt;
	let sessionId = randomUUID();

	while (Date.now() < deadline) {
		if (callbacks.signal?.aborted) {
			throw new Error("Login cancelled");
		}

		await abortableSleep(intervalMs, callbacks.signal);

		const result = await pollOAuth(init.flowId, init.pollToken);

		if (result.status === "ready") {
			const jwt = result.token?.trim();
			const upstreamToken = result.zai?.access_token?.trim();
			if (!jwt) {
				throw new Error(
					"ZCode OAuth ready but no JWT returned. Try again.",
				);
			}

			callbacks.onProgress?.("Login successful!");
			_logger.info("ZCode login complete", {
				hasUpstreamToken: !!upstreamToken,
				userId: result.user?.user_id,
			});

			// `access` carries the start-plan JWT — that's the credential we
			// inject into Authorization: Bearer ... headers.
			// `refresh` carries the upstream Z.AI access_token as fallback.
			// `jwt` mirrors `access` so downstream code can read it directly.
			return {
				access: jwt,
				refresh: upstreamToken ?? jwt,
				expires: Date.now() + ZCODE_TOKEN_EXPIRATION_MS,
				jwt,
				upstreamToken: upstreamToken ?? "",
				userId: result.user?.user_id ?? "",
				sessionId,
			};
		}

		if (result.status === "failed") {
			throw new Error("Authorization failed. Please retry login.");
		}

		const remaining = Math.ceil((deadline - Date.now()) / 1000);
		callbacks.onProgress?.(
			`Waiting for browser authorization... (${remaining}s remaining)`,
		);
		// Refresh session id to look more like a real client
		sessionId = randomUUID();
	}

	throw new Error("Authentication timed out. Please retry login.");
}

/**
 * Token refresh — start-plan JWTs are long-lived (no refresh endpoint in the
 * reverse-engineered API), so we just check expiry and prompt re-login if
 * expired.
 */
export async function refreshZcodeToken(
	credentials: OAuthCredentials,
): Promise<OAuthCredentials> {
	if (credentials.expires > Date.now()) {
		return credentials;
	}
	throw new Error(
		"ZCode session expired. Please run /login zcode to re-authenticate.",
	);
}