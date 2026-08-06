/**
 * Kilo device authorization flow and native provider auth.
 *
 * Exposes a pi-ai `ProviderAuth` (apiKey + oauth) for the createProvider object
 * form. Pi owns credential persistence (~/.pi/agent/auth.json) and token refresh:
 * `OAuthAuth.refresh` is called under the credential-store lock before any
 * network access, replacing the hand-rolled refresh the legacy `oauth:` config
 * required the extension to own.
 */

import type {
	ApiKeyAuth,
	ApiKeyCredential,
	AuthContext,
	AuthInteraction,
	AuthResult,
	ModelAuth,
	OAuthAuth,
	OAuthCredential,
	ProviderAuth,
} from "@earendil-works/pi-ai/compat";
import { getKiloApiKey } from "../../config.ts";
import {
	KILO_POLL_INTERVAL_MS,
	KILO_TOKEN_EXPIRATION_MS,
} from "../../constants.ts";
import { openBrowser } from "../../lib/open-browser.ts";

const KILO_API_BASE = process.env.KILO_API_URL || "https://api.kilo.ai";
const DEVICE_AUTH_ENDPOINT = `${KILO_API_BASE}/api/device-auth/codes`;
const PROFILE_ENDPOINT = `${KILO_API_BASE}/api/profile`;

// =============================================================================
// Balance & Rate Limit
// =============================================================================

export async function fetchKiloBalance(token: string): Promise<number | null> {
	try {
		const response = await fetch(`${PROFILE_ENDPOINT}/balance`, {
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
		});
		if (!response.ok) return null;
		const data = (await response.json()) as { balance?: number };
		return data.balance ?? null;
	} catch {
		return null;
	}
}

export function formatCredits(balance: number): string {
	return balance >= 1000
		? `$${(balance / 1000).toFixed(1)}k`
		: `$${balance.toFixed(2)}`;
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
	if (!response.ok)
		throw new Error(`Failed to poll device authorization: ${response.status}`);
	return (await response.json()) as DeviceAuthPollResponse;
}

/**
 * Run the Kilo device-authorization flow against the native `AuthInteraction`
 * (Pi renders auth_url/device_code/progress events; `signal` cancels). Returns
 * a canonical OAuth credential Pi persists to the shared auth store.
 */
export async function loginKilo(
	interaction: AuthInteraction,
): Promise<OAuthCredential> {
	interaction.notify({
		type: "progress",
		message: "Initiating device authorization...",
	});
	const { code, verificationUrl, expiresIn } = await initiateDeviceAuth();

	interaction.notify({
		type: "auth_url",
		url: verificationUrl,
		instructions: `Enter code: ${code}`,
	});
	interaction.notify({
		type: "device_code",
		userCode: code,
		verificationUri: verificationUrl,
	});
	openBrowser(verificationUrl);
	interaction.notify({
		type: "progress",
		message: "Waiting for browser authorization...",
	});

	const deadline = Date.now() + expiresIn * 1000;
	while (Date.now() < deadline) {
		if (interaction.signal?.aborted) throw new Error("Login cancelled");
		// pi-lens-ignore: await-in-loop
		await abortableSleep(KILO_POLL_INTERVAL_MS, interaction.signal);

		const result = await pollDeviceAuth(code);
		if (result.status === "approved") {
			if (!result.token)
				throw new Error("Authorization approved but no token received");
			interaction.notify({ type: "progress", message: "Login successful!" });
			return {
				type: "oauth",
				refresh: result.token,
				access: result.token,
				expires: Date.now() + KILO_TOKEN_EXPIRATION_MS,
			};
		}
		if (result.status === "denied")
			throw new Error("Authorization denied by user.");
		if (result.status === "expired")
			throw new Error("Authorization code expired. Please try again.");

		const remaining = Math.ceil((deadline - Date.now()) / 1000);
		interaction.notify({
			type: "progress",
			message: `Waiting for browser authorization... (${remaining}s remaining)`,
		});
	}
	throw new Error("Authentication timed out. Please try again.");
}

/**
 * Native OAuth refresh. Kilo access tokens are long-lived (1 year) with no
 * refresh endpoint, so a still-valid credential is returned as-is and an expired
 * one throws — Pi preserves the stored credential for retry and `/login kilo`
 * re-authenticates. This replaces the legacy `refreshKiloToken` the extension
 * previously had to wire up itself.
 */
export async function refreshKiloCredential(
	credential: OAuthCredential,
	_signal?: AbortSignal,
): Promise<OAuthCredential> {
	if (credential.expires > Date.now()) return credential;
	throw new Error(
		"Kilo token expired. Please run /login kilo to re-authenticate.",
	);
}

// =============================================================================
// Native ProviderAuth
// =============================================================================

/**
 * Resolve the effective Kilo API key: a natively-stored key (from
 * `interaction.prompt` login) wins, then the ambient `KILO_API_KEY` env var /
 * `~/.pi/free.json` value via the shared config getter.
 */
async function resolveKiloApiKey(input: {
	ctx: AuthContext;
	credential?: ApiKeyCredential;
	signal?: AbortSignal;
}): Promise<AuthResult | undefined> {
	const key = input.credential?.key ?? getKiloApiKey();
	if (!key) return undefined;
	return {
		auth: { apiKey: key },
		source: input.credential?.key ? "stored API key" : "KILO_API_KEY",
	};
}

export const kiloApiKeyAuth: ApiKeyAuth = {
	name: "Kilo API key",
	async login(interaction: AuthInteraction): Promise<ApiKeyCredential> {
		const key = await interaction.prompt({
			type: "secret",
			message: "Kilo API key",
		});
		return { type: "api_key", key };
	},
	resolve: resolveKiloApiKey,
};

export const kiloOAuthAuth: OAuthAuth = {
	name: "Kilo",
	loginLabel: "Sign in with Kilo",
	login: loginKilo,
	refresh: refreshKiloCredential,
	async toAuth(credential: OAuthCredential): Promise<ModelAuth> {
		return { apiKey: credential.access };
	},
};

/** Native auth for the Kilo provider: API key and OAuth device flow. */
export const kiloAuth: ProviderAuth = {
	apiKey: kiloApiKeyAuth,
	oauth: kiloOAuthAuth,
};
