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

import type { OAuthCredentials } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { PROVIDER_QWEN, URL_QWEN_TOS } from "../constants.ts";
import {
	enhanceWithCI,
	type StoredModels,
	setupProvider,
	createReRegister,
} from "../provider-helper.ts";
import { incrementRequestCount } from "../usage/metrics.ts";
import { logWarning } from "../lib/util.ts";
import { createLogger } from "../lib/logger.ts";
import { loginQwen, refreshQwenToken, getQwenBaseUrl } from "./qwen-auth.ts";
import { fetchQwenModels } from "./qwen-models.ts";

const _logger = createLogger("qwen");

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";

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
	};

	// Register provider with OpenAI-compatible API
	function registerProvider(m = models) {
		pi.registerProvider(PROVIDER_QWEN, {
			baseUrl: DEFAULT_BASE_URL,
			apiKey: "QWEN_API_KEY",
			api: "openai-completions" as const,
			headers: {
				"User-Agent": "pi-free-providers",
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

	// Qwen-specific: update base URL dynamically from OAuth credentials
	pi.on("before_provider_request", (event: unknown) => {
		const evt = event as { type?: string; payload?: Record<string, unknown> };
		if (evt.type !== "qwen") return;

		// Try to get credentials and update base URL if resource_url was provided
		try {
			const cred = (pi as any).modelRegistry?.authStorage?.get?.(PROVIDER_QWEN);
			if (cred?.type === "oauth") {
				const baseUrl = getQwenBaseUrl(cred as OAuthCredentials);
				if (baseUrl !== DEFAULT_BASE_URL && evt.payload) {
					_logger.debug("Using dynamic base URL from OAuth", { baseUrl });
				}
			}
		} catch {
			// Ignore - use default base URL
		}
	});

	// Track requests
	pi.on("turn_end", async (_event, ctx) => {
		if (ctx.model?.provider !== PROVIDER_QWEN) return;
		incrementRequestCount(PROVIDER_QWEN);
	});
}
