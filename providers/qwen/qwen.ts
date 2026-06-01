/**
 * Qwen OAuth Provider Extension
 *
 * @deprecated This provider is deprecated. Qwen no longer offers the 1,000 free API calls/day tier.
 * The provider remains functional for existing authenticated users but new free tier registrations
 * are not supported. Consider using other free providers like Kilo, Cline, or NVIDIA instead.
 *
 * Original description (now outdated):
 * ~~Provides free access to Qwen 3.6 Plus via OAuth device flow.
 * 1,000 free API calls/day — run /login qwen to authenticate.~~
 */

import type { Api, Model, OAuthCredentials } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { PROVIDER_QWEN, URL_QWEN_TOS } from "../../constants.ts";
import { createLogger } from "../../lib/logger.ts";
import { logWarning } from "../../lib/util.ts";
import {
	createReRegister,
	enhanceWithCI,
	type StoredModels,
	setupProvider,
} from "../../provider-helper.ts";
import { getQwenBaseUrl, loginQwen, refreshQwenToken } from "./qwen-auth.ts";
import { fetchQwenModels } from "./qwen-models.ts";

// =============================================================================
// 401 detection patterns
// =============================================================================

/** Patterns that indicate an auth failure requiring token refresh. */
const AUTH_ERROR_PATTERNS = [
	"invalid access token",
	"token expired",
	"401",
	"unauthorized",
	"authentication",
] as const;

const _logger = createLogger("qwen");

// =============================================================================
// Constants
// =============================================================================

// Mirrors qwen-code's DEFAULT_QWEN_BASE_URL (used when resource_url is absent).
const DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";

// Headers required by DashScope's OpenAI-compatible API for OAuth tokens.
// Replicates DashScopeOpenAICompatibleProvider.buildHeaders() from qwen-code.
const DASHSCOPE_HEADERS = {
	"X-DashScope-AuthType": "qwen-oauth",
	"X-DashScope-CacheControl": "enable",
	"X-DashScope-UserAgent": "QwenCode/0.0.5 (pi-free)",
	"Client-Code": "QwenCode",
};

// =============================================================================
// Extension entry point
// =============================================================================

export default async function qwenProvider(pi: ExtensionAPI) {
	// DEPRECATION WARNING
	_logger.warn(
		"Qwen provider is deprecated. The 1,000 req/day free tier is no longer available.",
	);

	// Fetch static free-tier models
	const models = await fetchQwenModels().catch((err) => {
		logWarning("qwen", "Failed to load models at startup", err);
		return [];
	});

	if (models.length === 0) {
		logWarning("qwen", "No models available, skipping provider");
		return;
	}

	const stored: StoredModels = { free: models, all: models };

	// OAuth config for Qwen
	const oauthConfig = {
		name: "Qwen",
		login: loginQwen,
		refreshToken: refreshQwenToken,
		getApiKey: (cred: OAuthCredentials) => cred.access,
		modifyModels: (models: Model<Api>[], cred: OAuthCredentials) => {
			// Mirror qwen-code: resolve baseUrl from resource_url per-credential.
			// Chinese accounts → dashscope.aliyuncs.com/v1
			// International accounts → portal.qwen.ai/v1 (or custom endpoint)
			const baseUrl = getQwenBaseUrl(cred);
			_logger.info("Qwen OAuth modifyModels called", {
				baseUrl,
				resource_url: cred.resource_url,
				modelCount: models.length,
			});
			if (baseUrl === DEFAULT_BASE_URL) return models;
			// modifyModels receives ALL models across providers — only patch Qwen ones.
			const nonQwen = models.filter((m) => m.provider !== PROVIDER_QWEN);
			const qwen = models
				.filter((m) => m.provider === PROVIDER_QWEN)
				.map((m) => ({ ...m, baseUrl }));
			return [...nonQwen, ...qwen];
		},
	};

	// Register provider with OpenAI-compatible API
	function registerProvider(m = models) {
		pi.registerProvider(PROVIDER_QWEN, {
			baseUrl: DEFAULT_BASE_URL,
			apiKey: "$QWEN_API_KEY",
			api: "openai-completions" as const,
			headers: {
				"User-Agent": "pi-free",
				...DASHSCOPE_HEADERS,
			},
			models: enhanceWithCI(m),
			oauth: oauthConfig,
		});
	}

	registerProvider();

	// Wire up shared boilerplate (commands, model_select, turn_end, ToS)
	const reRegister = createReRegister(pi, {
		providerId: PROVIDER_QWEN,
		baseUrl: DEFAULT_BASE_URL,
		apiKey: "$QWEN_API_KEY",
		oauth: oauthConfig as any,
	});

	setupProvider(
		pi,
		{
			providerId: PROVIDER_QWEN,
			tosUrl: URL_QWEN_TOS,
			initialShowPaid: false,
			reRegister: (m) => {
				reRegister(m);
			},
		},
		stored,
	);

	// Request counting + 401 auth-error detection with forced token refresh.
	//
	// When Qwen returns a 401 / "invalid access token" error, the stored token
	// may have been revoked server-side even though its expiry hasn't been reached.
	// We force-expire the credential in auth storage so that pi-core's next
	// getApiKey() call will trigger a token refresh via refreshToken().
	// This mirrors qwen-code's executeWithCredentialManagement() retry logic.
	//
	function isQwenAuthError(msg: {
		role?: string;
		errorMessage?: string;
	}): boolean {
		if (msg.role !== "assistant" || !msg.errorMessage) return false;
		const errLower = msg.errorMessage.toLowerCase();
		return AUTH_ERROR_PATTERNS.some((p) => errLower.includes(p));
	}

	function forceExpireQwenToken(
		ctx: any,
		msg: { errorMessage?: string },
	): void {
		_logger.warn("Qwen auth error detected, force-expiring token for refresh", {
			error: (msg.errorMessage ?? "").slice(0, 100),
		});

		try {
			const authStorage = (ctx as any).modelRegistry?.authStorage;
			if (authStorage) {
				const cred = authStorage.get(PROVIDER_QWEN);
				if (cred?.type === "oauth" && cred.expires > Date.now()) {
					authStorage.set(PROVIDER_QWEN, { ...cred, expires: 0 });
					_logger.info(
						"Qwen token force-expired; will refresh on next request",
					);
				}
			}
			ctx.ui.notify("Qwen: auth error detected, refreshing token…", "warning");
		} catch (e) {
			_logger.warn("Failed to force-expire Qwen token", {
				error: e instanceof Error ? e.message : String(e),
			});
		}
	}

	pi.on("turn_end", async (event, ctx) => {
		if (ctx.model?.provider !== PROVIDER_QWEN) return;

		const msg = (
			event as { message?: { role?: string; errorMessage?: string } }
		).message;

		if (msg && isQwenAuthError(msg)) {
			forceExpireQwenToken(ctx, msg);
		}
	});
}
