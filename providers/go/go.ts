/**
 * OpenCode Go Provider Extension
 *
 * Provides access to curated open coding models via the OpenCode Go gateway.
 * Requires an OpenCode Go subscription ($5 first month, then $10/month).
 * Set OPENCODE_GO_API_KEY (or opencode_go_api_key in ~/.pi/free.json) for access.
 *
 * Models available:
 *   - GLM-5
 *   - Kimi K2.5
 *   - MiMo-V2-Pro
 *   - MiMo-V2-Omni
 *   - MiniMax M2.7
 *   - MiniMax M2.5
 *
 * See: https://opencode.ai/docs/go
 */

import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@mariozechner/pi-coding-agent";
import {
	applyHidden,
	GO_SHOW_PAID,
	OPENCODE_API_KEY,
	OPENCODE_GO_API_KEY as CONFIG_API_KEY,
	PROVIDER_GO,
} from "../../config.ts";
import {
	BASE_URL_GO,
	URL_GO_TOS,
} from "../../constants.ts";
import {
	type StoredModels,
	setupProvider,
	createReRegister,
	createCtxReRegister,
} from "../../provider-helper.ts";
import { createOpenCodeSessionTracker } from "../opencode-session.ts";
import { createLogger } from "../../lib/logger.ts";

const _logger = createLogger("go");

const GO_CONFIG = {
	providerId: PROVIDER_GO,
	baseUrl: BASE_URL_GO,
	apiKey: "PI_FREE_GO_API_KEY",
	headers: {
		"X-Title": "Pi",
		"HTTP-Referer": "https://opencode.ai/",
	},
};

const session = createOpenCodeSessionTracker();

// =============================================================================
// Static models (from OpenCode Go docs)
// =============================================================================

const STATIC_GO_MODELS: ProviderModelConfig[] = [
	{
		id: "glm-5",
		name: "GLM-5",
		reasoning: true,
		input: ["text"],
		cost: { input: 0.5, output: 2, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
	},
	{
		id: "kimi-k2.5",
		name: "Kimi K2.5",
		reasoning: true,
		input: ["text"],
		cost: { input: 0.3, output: 1.5, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
	},
	{
		id: "mimo-v2-pro",
		name: "MiMo V2 Pro",
		reasoning: false,
		input: ["text"],
		cost: { input: 0.4, output: 1.2, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
	},
	{
		id: "mimo-v2-omni",
		name: "MiMo V2 Omni",
		reasoning: false,
		input: ["text", "image"],
		cost: { input: 0.25, output: 0.8, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
	},
	{
		id: "minimax-m2.7",
		name: "MiniMax M2.7",
		reasoning: true,
		input: ["text"],
		cost: { input: 0.1, output: 0.4, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200000,
		maxTokens: 16384,
	},
	{
		id: "minimax-m2.5",
		name: "MiniMax M2.5",
		reasoning: true,
		input: ["text"],
		cost: { input: 0.05, output: 0.2, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200000,
		maxTokens: 16384,
	},
];

// =============================================================================
// Extension Entry Point
// =============================================================================

export default async function (pi: ExtensionAPI) {
	const token = CONFIG_API_KEY ?? OPENCODE_API_KEY ?? "";
	const hasKey = !!token;

	// Go requires an API key (no free tier)
	if (!hasKey) {
		_logger.warn(
			"[go] No API key found — set OPENCODE_GO_API_KEY or add opencode_go_api_key to ~/.pi/free.json",
		);
		return;
	}

	// Use a private env var so we don't conflict with other providers
	const GO_KEY_VAR = "PI_FREE_GO_API_KEY";

	// Shared model storage
	const stored: StoredModels = {
		free: applyHidden(STATIC_GO_MODELS),
		all: applyHidden(STATIC_GO_MODELS),
	};

	// Register provider immediately (shows in --list-models)
	pi.registerProvider(PROVIDER_GO, {
		baseUrl: BASE_URL_GO,
		apiKey: GO_KEY_VAR,
		api: "openai-completions" as const,
		headers: GO_CONFIG.headers,
		models: applyHidden(STATIC_GO_MODELS),
	});

	// Wire up shared boilerplate
	const reRegister = createReRegister(pi, GO_CONFIG);
	setupProvider(
		pi,
		{
			providerId: PROVIDER_GO,
			tosUrl: URL_GO_TOS,
			hasKey,
			initialShowPaid: GO_SHOW_PAID,
			reRegister: (models) => reRegister(models),
		},
		stored,
	);

	// Update with session headers on session_start
	pi.on("session_start", async (_event, ctx) => {
		// Set up the env var
		process.env[GO_KEY_VAR] = token;

		// Generate session ID for this session (used in headers)
		const sessionId = session.getSessionId();

		// Create re-register function with session headers
		const sessionConfig = {
			...GO_CONFIG,
			headers: {
				...GO_CONFIG.headers,
				"x-opencode-session": sessionId,
				"x-session-affinity": sessionId,
			},
		};
		const ctxReRegister = createCtxReRegister(ctx as any, sessionConfig);

		// Register with session headers
		ctxReRegister(applyHidden(STATIC_GO_MODELS));
	});

	// Update request count before each agent turn (for request ID generation)
	pi.on("before_agent_start", async (_event, ctx) => {
		if (ctx.model?.provider !== PROVIDER_GO) return;
		session.nextRequestId();
	});
}
