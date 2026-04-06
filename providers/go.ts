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
	OPENCODE_GO_API_KEY as CONFIG_API_KEY,
	PROVIDER_GO,
} from "../config.ts";
import {
	BASE_URL_GO,
	DEFAULT_FETCH_TIMEOUT_MS,
	URL_GO_TOS,
} from "../constants.ts";
import {
	type StoredModels,
	setupProvider,
	createCtxReRegister,
} from "../provider-helper.ts";
import { fetchModelsDevMeta } from "./model-fetcher.ts";
import { fetchWithRetry, logWarning } from "../lib/util.ts";

const GO_CONFIG = {
	providerId: PROVIDER_GO,
	baseUrl: BASE_URL_GO,
	apiKey: "PI_FREE_GO_API_KEY",
	headers: {
		"X-Title": "Pi",
		"HTTP-Referer": "https://opencode.ai/",
	},
};

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

/** Fetch the model list from the Go gateway */
async function fetchGatewayModels(token: string): Promise<string[]> {
	const response = await fetchWithRetry(
		`${BASE_URL_GO}/models`,
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
			`Go /models returned ${response.status} ${response.statusText}`,
		);
	}

	const json = (await response.json()) as { data?: { id: string }[] };
	return (json.data ?? []).map((m) => m.id);
}

// =============================================================================
// Main fetch
// =============================================================================

async function fetchGoModels(token: string): Promise<{
	all: ProviderModelConfig[];
	useStaticFallback: boolean;
}> {
	try {
		const [gatewayIds, meta] = await Promise.all([
			fetchGatewayModels(token),
			fetchModelsDevMeta(), // Fetch all providers' models
		]);

		const all: ProviderModelConfig[] = [];

		for (const id of gatewayIds) {
			// Try to find model metadata by ID or partial match
			const m = meta[id] ?? 
				Object.values(meta).find(m => m.id?.includes(id) || id.includes(m.id ?? ""));

			// Skip image-output models
			if (m?.modalities?.output?.includes("image")) continue;

			const config: ProviderModelConfig = {
				id,
				name: m?.name ?? STATIC_GO_MODELS.find(s => s.id === id)?.name ?? id,
				reasoning: m?.reasoning ?? STATIC_GO_MODELS.find(s => s.id === id)?.reasoning ?? false,
				input: m?.modalities?.input?.includes("image")
					? ["text", "image"]
					: ["text"],
				cost: {
					input: m?.cost?.input ?? STATIC_GO_MODELS.find(s => s.id === id)?.cost?.input ?? 0,
					output: m?.cost?.output ?? STATIC_GO_MODELS.find(s => s.id === id)?.cost?.output ?? 0,
					cacheRead: m?.cost?.cache_read ?? 0,
					cacheWrite: m?.cost?.cache_write ?? 0,
				},
				contextWindow: m?.limit?.context ?? STATIC_GO_MODELS.find(s => s.id === id)?.contextWindow ?? 128_000,
				maxTokens: m?.limit?.output ?? STATIC_GO_MODELS.find(s => s.id === id)?.maxTokens ?? 16_384,
			};

			all.push(config);
		}

		// If no models from API, use static fallback
		if (all.length === 0) {
			return { all: applyHidden(STATIC_GO_MODELS), useStaticFallback: true };
		}

		return {
			all: applyHidden(all),
			useStaticFallback: false,
		};
	} catch (error) {
		logWarning(
			"go",
			"API unavailable, using static model list",
			error,
		);
		return { all: applyHidden(STATIC_GO_MODELS), useStaticFallback: true };
	}
}

// =============================================================================
// Extension Entry Point
// =============================================================================

export default async function (pi: ExtensionAPI) {
	const hasKey = !!CONFIG_API_KEY;
	const token = CONFIG_API_KEY ?? "";

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

		let models: ProviderModelConfig[] = [];

		try {
			const result = await fetchGoModels(token);
			models = result.all;
			stored.all = models;
			stored.free = models; // Go has no free tier
		} catch (error) {
			logWarning("go", "Failed to fetch models, using static list", error);
			models = STATIC_GO_MODELS;
			stored.all = models;
			stored.free = models;
		}

		if (models.length === 0) {
			return;
		}

		// Create re-register function
		reRegisterFn = createCtxReRegister(ctx as any, GO_CONFIG);

		// Register our provider
		reRegisterFn(models);
	});
}
