/**
 * Qwen OAuth Provider Extension
 *
 * Provides free access to Qwen 3.6 Plus via OAuth device flow.
 * 1,000 free API calls/day — run /login qwen to authenticate.
 *
 * Usage:
 *   pi install git:github.com/apmantza/pi-free
 *   # Then /login qwen, select qwen model
 */

import type { OAuthCredentials, Model, Api } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { PROVIDER_QWEN, URL_QWEN_TOS } from "../../constants.ts";
import {
	enhanceWithCI,
	type StoredModels,
	setupProvider,
	createReRegister,
} from "../../provider-helper.ts";
import { incrementRequestCount } from "../../usage/metrics.ts";
import { logWarning } from "../../lib/util.ts";
import { createLogger } from "../../lib/logger.ts";
import { loginQwen, refreshQwenToken, getQwenBaseUrl } from "./qwen-auth.ts";
import { fetchQwenModels } from "./qwen-models.ts";

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

export default async function (pi: ExtensionAPI) {
	// Fetch static free-tier models
	let models = await fetchQwenModels().catch((err) => {
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
			apiKey: "QWEN_API_KEY",
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
		apiKey: "QWEN_API_KEY",
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

	// Keep lightweight request counting for now (internal only).
	pi.on("turn_end", async (_event, ctx) => {
		if (ctx.model?.provider !== PROVIDER_QWEN) return;
		incrementRequestCount(PROVIDER_QWEN);
	});
}
