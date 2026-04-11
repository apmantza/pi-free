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
} from "../config.ts";
import {
	BASE_URL_GO,
	URL_GO_TOS,
} from "../constants.ts";
import {
	type StoredModels,
	setupProvider,
	createCtxReRegister,
} from "../provider-helper.ts";
import { createOpenCodeSessionTracker } from "./opencode-session.ts";

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
// Static fallback models (from OpenCode Go docs)
// Used when /models API is unavailable
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
// Fetch helpers
// =============================================================================

// OpenCode Go does not have a /models endpoint.
// Models are only accessible via the chat completions API.
// Static models are used directly (see below).

// =============================================================================
// Main fetch
// =============================================================================

/**
 * OpenCode Go does not have a /models endpoint.
 * Models are only accessible via chat completions.
 * So we use the static fallback models directly.
 */
async function fetchGoModels(_token: string): Promise<{
	all: ProviderModelConfig[];
	useStaticFallback: boolean;
}> {
	// Go has no /models API - use static models
	return { all: applyHidden(STATIC_GO_MODELS), useStaticFallback: true };
}

// =============================================================================
// Extension Entry Point
// =============================================================================

export default async function (pi: ExtensionAPI) {
	const token = CONFIG_API_KEY ?? OPENCODE_API_KEY ?? "";
	const hasKey = !!token;

	// Go requires an API key (no free tier)
	if (!hasKey) {
		pi.on("session_start", async () => {
			// No key - don't register provider
		});
		return;
	}

	// Use a private env var so we don't conflict with other providers
	const GO_KEY_VAR = "PI_FREE_GO_API_KEY";

	// Shared model storage
	const stored: StoredModels = { free: [], all: [] };

	// Re-registration function
	let reRegisterFn: (models: ProviderModelConfig[]) => void = () => {};

	// Wire up shared boilerplate
	setupProvider(
		pi,
		{
			providerId: PROVIDER_GO,
			tosUrl: URL_GO_TOS,
			hasKey,
			initialShowPaid: GO_SHOW_PAID,
			reRegister: (models) => reRegisterFn(models),
		},
		stored,
	);

	// Register provider on session start
	pi.on("session_start", async (_event, ctx) => {
		// Set up the env var
		process.env[GO_KEY_VAR] = token;

		// OpenCode Go has no /models endpoint - use static fallback
		const models = applyHidden(STATIC_GO_MODELS);

		stored.all = models;
		stored.free = models; // Go has no free tier

		if (models.length === 0) {
			return;
		}

		// Generate session ID for this session (used in headers)
		const sessionId = session.getSessionId();

		// Create re-register function with session headers (same as zen)
		const sessionConfig = {
			...GO_CONFIG,
			headers: {
				...GO_CONFIG.headers,
				"x-opencode-session": sessionId,
				"x-session-affinity": sessionId,
			},
		};
		reRegisterFn = createCtxReRegister(ctx as any, sessionConfig);

		// Register our provider
		reRegisterFn(models);
	});

	// Update request count before each agent turn (for request ID generation)
	pi.on("before_agent_start", async (_event, ctx) => {
		if (ctx.model?.provider !== PROVIDER_GO) return;
		session.nextRequestId();
	});
}
