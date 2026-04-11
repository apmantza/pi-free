/**
 * OpenCode Zen Provider Extension
 *
 * Provides access to curated AI models via the OpenCode Zen gateway.
 * Free models are available immediately with no account needed.
 * Set OPENCODE_API_KEY (or opencode_api_key in ~/.pi/free.json) for paid access.
 *
 * Model list fetched directly from the Zen gateway — only returns models that
 * are actually deployed. Metadata (pricing, context) enriched from models.dev.
 */

import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@mariozechner/pi-coding-agent";
import {
	applyHidden,
	OPENCODE_API_KEY as CONFIG_API_KEY,
	PROVIDER_ZEN,
	ZEN_SHOW_PAID,
} from "../config.ts";
import {
	BASE_URL_ZEN,
	DEFAULT_FETCH_TIMEOUT_MS,
	URL_ZEN_TOS,
} from "../constants.ts";
import {
	type StoredModels,
	setupProvider,
	createCtxReRegister,
} from "../provider-helper.ts";
import type { ZenGatewayModel } from "../lib/types.ts";
import { fetchModelsDevMeta } from "./model-fetcher.ts";
import { createOpenCodeSessionTracker } from "./opencode-session.ts";
import { fetchWithRetry, logWarning } from "../lib/util.ts";

const ZEN_CONFIG = {
	providerId: PROVIDER_ZEN,
	baseUrl: BASE_URL_ZEN,
	apiKey: "PI_FREE_ZEN_API_KEY",
	headers: {
		"X-Title": "Pi",
		"HTTP-Referer": "https://opencode.ai/",
	},
};

const session = createOpenCodeSessionTracker();

// =============================================================================
// Static fallback models (from Pi's built-in + OpenCode docs)
// Used when /models API is unavailable
// =============================================================================

const _STATIC_ZEN_MODELS: ProviderModelConfig[] = [
	// Free models (from OpenCode Zen docs)
	{
		id: "big-pickle",
		name: "Big Pickle",
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200000,
		maxTokens: 128000,
	},
	{
		id: "trinity-large-preview-free",
		name: "Trinity Large Preview Free",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
	},
	{
		id: "minimax-m2.5-free",
		name: "MiniMax M2.5 Free",
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200000,
		maxTokens: 16384,
	},
	{
		id: "mimo-v2-pro-free",
		name: "MiMo V2 Pro Free",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
	},
	{
		id: "mimo-v2-omni-free",
		name: "MiMo V2 Omni Free",
		reasoning: false,
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
	},
	{
		id: "mimo-v2-flash-free",
		name: "MiMo V2 Flash Free",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
	},
	{
		id: "nemotron-3-super-free",
		name: "Nemotron 3 Super Free",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
	},
	// Paid models (available when show_paid: true and API key set)
	{
		id: "claude-3-5-haiku",
		name: "Claude Haiku 3.5",
		reasoning: false,
		input: ["text", "image"],
		cost: { input: 0.8, output: 4, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200000,
		maxTokens: 8192,
	},
	{
		id: "claude-haiku-4-5",
		name: "Claude Haiku 4.5",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 1, output: 5, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200000,
		maxTokens: 64000,
	},
	{
		id: "claude-opus-4-5",
		name: "Claude Opus 4.5",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 5, output: 25, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200000,
		maxTokens: 64000,
	},
	{
		id: "claude-sonnet-4-5",
		name: "Claude Sonnet 4.5",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 3, output: 15, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200000,
		maxTokens: 64000,
	},
	{
		id: "gemini-3-flash",
		name: "Gemini 3 Flash",
		reasoning: false,
		input: ["text", "image"],
		cost: { input: 0.5, output: 3, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
	},
	{
		id: "gemini-3.1-pro",
		name: "Gemini 3.1 Pro",
		reasoning: false,
		input: ["text", "image"],
		cost: { input: 2, output: 12, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200000,
		maxTokens: 16384,
	},
	{
		id: "minimax-m2.5",
		name: "MiniMax M2.5",
		reasoning: true,
		input: ["text"],
		cost: { input: 0.3, output: 1.2, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200000,
		maxTokens: 16384,
	},
];

// =============================================================================
// Fetch helpers
// =============================================================================

// Models confirmed broken (always return empty content regardless of token budget).
const ZEN_BROKEN_MODELS = new Set([
	"gpt-5-nano", // always returns empty content/choices
	"gpt-5.4-nano", // same family, same issue
]);

/** Fetch the model list from the Zen gateway — authoritative for what's deployed. */
async function fetchGatewayModels(token: string): Promise<string[]> {
	const response = await fetchWithRetry(
		`${BASE_URL_ZEN}/models`,
		{
			headers: {
				Authorization: `Bearer ${token}`,
				"User-Agent": "pi-free-providers",
			},
		},
		3,
		1000,
		DEFAULT_FETCH_TIMEOUT_MS,
	);

	if (!response.ok) {
		throw new Error(
			`Zen /models returned ${response.status} ${response.statusText}`,
		);
	}

	const json = (await response.json()) as { data?: ZenGatewayModel[] };
	return (json.data ?? [])
		.map((m) => m.id)
		.filter((id) => !ZEN_BROKEN_MODELS.has(id));
}

// =============================================================================
// Main fetch
// =============================================================================

async function fetchZenModels(token: string): Promise<{
	all: ProviderModelConfig[];
	free: ProviderModelConfig[];
	useStaticFallback: boolean;
}> {
	try {
		const [gatewayIds, meta] = await Promise.all([
			fetchGatewayModels(token),
			fetchModelsDevMeta("opencode"), // Fetch only opencode provider's models
		]);

		const all: ProviderModelConfig[] = [];
		const free: ProviderModelConfig[] = [];

		for (const id of gatewayIds) {
			const m = meta[id];

			// Skip image-output models
			if (m?.modalities?.output?.includes("image")) continue;

			const config: ProviderModelConfig = {
				id,
				name: m?.name ?? id,
				reasoning: m?.reasoning ?? false,
				input: m?.modalities?.input?.includes("image")
					? ["text", "image"]
					: ["text"],
				cost: {
					input: m?.cost?.input ?? 0,
					output: m?.cost?.output ?? 0,
					cacheRead: m?.cost?.cache_read ?? 0,
					cacheWrite: m?.cost?.cache_write ?? 0,
				},
				contextWindow: m?.limit?.context ?? 128_000,
				maxTokens: m?.limit?.output ?? 16_384,
			};

			all.push(config);
			if ((m?.cost?.input ?? 0) === 0) free.push(config);
		}

		return {
			all: applyHidden(all),
			free: applyHidden(free),
			useStaticFallback: false,
		};
	} catch (error) {
		// API failed - return special flag to skip registration
		// Pi's built-in OpenCode provider will be used instead
		logWarning(
			"zen",
			"API unavailable, letting Pi use built-in provider",
			error,
		);
		return { all: [], free: [], useStaticFallback: true };
	}
}

// =============================================================================
// Extension Entry Point
// =============================================================================

export default async function (pi: ExtensionAPI) {
	const hasKey = !!CONFIG_API_KEY;
	const token = CONFIG_API_KEY ?? "public";

	// Use a private env var so we don't accidentally activate Pi's built-in
	// opencode provider, which also watches OPENCODE_API_KEY.
	const ZEN_KEY_VAR = "PI_FREE_ZEN_API_KEY";

	// Shared model storage (references held by setupProvider for commands)
	const stored: StoredModels = { free: [], all: [] };

	// Re-registration function - will be set in session_start with ctx
	let reRegisterFn: (models: ProviderModelConfig[]) => void = () => {};

	// Wire up shared boilerplate (commands, model_select, turn_end, ToS)
	setupProvider(
		pi,
		{
			providerId: PROVIDER_ZEN,
			tosUrl: URL_ZEN_TOS,
			hasKey,
			initialShowPaid: ZEN_SHOW_PAID,
			reRegister: (models) => reRegisterFn(models),
		},
		stored,
	);

	// Check in session_start if user already has auth for this provider
	// If they do, we still register with session headers for better reliability
	pi.on("session_start", async (_event, ctx) => {
		const availableModels = ctx.modelRegistry.getAvailable();
		const _hasExistingAuth = availableModels.some(
			(m) => m.provider === PROVIDER_ZEN,
		);

		// Set up the env var regardless - either for our use or to supplement existing auth
		process.env[ZEN_KEY_VAR] = token;

		let models: ProviderModelConfig[] = [];
		let _freeCount = 0;
		let useStaticFallback = false;

		try {
			const result = await fetchZenModels(token);
			models = hasKey && ZEN_SHOW_PAID ? result.all : result.free;
			_freeCount = result.free.length;
			useStaticFallback = result.useStaticFallback;

			// Store for command toggle
			stored.free = result.free;
			stored.all = result.all;
		} catch (error) {
			logWarning("zen", "Failed to fetch models", error);
		}

		// If API failed, don't register our provider - let Pi use its built-in
		if (useStaticFallback || models.length === 0) {
			return;
		}

		// Generate session ID for this session (used in headers)
		const sessionId = session.getSessionId();

		// Create re-register function with session headers
		const sessionConfig = {
			...ZEN_CONFIG,
			headers: {
				...ZEN_CONFIG.headers,
				"x-opencode-session": sessionId,
				"x-session-affinity": sessionId,
			},
		};
		reRegisterFn = createCtxReRegister(ctx as any, sessionConfig);

		// Register our filtered provider (CI enhancement handled by provider-helper)
		reRegisterFn(models);
	});

	// Update request count before each agent turn (for request ID generation)
	pi.on("before_agent_start", async (_event, ctx) => {
		if (ctx.model?.provider !== PROVIDER_ZEN) return;
		session.nextRequestId();
	});
}
