/**
 * OpenRouter Provider Extension
 *
 * Provides access to 29+ free models and 300+ paid models via OpenRouter.
 * Requires OPENROUTER_API_KEY (free account at https://openrouter.ai).
 *
 * By default only free (:free) models are shown.
 * Set OPENROUTER_OPENROUTER_SHOW_PAID=true to also include paid models.
 */

import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@mariozechner/pi-coding-agent";
import {
	applyHidden,
	OPENROUTER_API_KEY as CONFIG_API_KEY,
	OPENROUTER_SHOW_PAID,
	PROVIDER_OPENROUTER,
} from "../config.ts";
import { BASE_URL_OPENROUTER, DEFAULT_FETCH_TIMEOUT_MS } from "../constants.ts";
import { fetchOpenRouterMetrics } from "../metrics.ts";
import { type StoredModels, setupProvider } from "../provider-helper.ts";
import { logWarning } from "../util.ts";
import { fetchOpenRouterModelsWithFree } from "./model-fetcher.ts";

// =============================================================================
// Fetch
// =============================================================================

async function fetchOpenRouterModels(apiKey: string): Promise<{
	free: ProviderModelConfig[];
	all: ProviderModelConfig[];
}> {
	const { free, all } = await fetchOpenRouterModelsWithFree({
		baseUrl: BASE_URL_OPENROUTER,
		apiKey,
		extraHeaders: {
			"HTTP-Referer": "https://github.com/apmantza/pi-free",
			"X-Title": "Pi",
		},
	});

	return { free: applyHidden(free), all: applyHidden(all) };
}

// =============================================================================
// Extension Entry Point
// =============================================================================

export default async function (pi: ExtensionAPI) {
	const apiKey = CONFIG_API_KEY;

	// Shared model storage (references held by setupProvider for commands)
	const stored: StoredModels = { free: [], all: [] };

	// Re-registration closure (set in session_start when we have ctx)
	let reRegisterFn: (models: ProviderModelConfig[]) => void = () => {};

	// Wire up shared boilerplate (commands, model_select, turn_end)
	setupProvider(
		pi,
		{
			providerId: PROVIDER_OPENROUTER,
			reRegister: (models) => reRegisterFn(models),
		},
		stored,
	);

	// Check in session_start if user already has auth for this provider
	// If yes: filter their models to free-only, use their key
	// If no: use our extension's key with filtered models
	pi.on("session_start", async (_event, ctx) => {
		const allModels = ctx.modelRegistry.getAll();
		const availableModels = ctx.modelRegistry.getAvailable();
		const existingModels = allModels.filter(
			(m) => m.provider === PROVIDER_OPENROUTER,
		);
		const hasExistingAuth = availableModels.some(
			(m) => m.provider === PROVIDER_OPENROUTER,
		);

		if (hasExistingAuth && existingModels.length > 0) {
			// User has existing auth - filter to free models, use their key
			const freeModels = existingModels
				.filter((m) => (m.cost?.input ?? 0) === 0)
				.map((m) => ({
					id: m.id,
					name: m.name,
					reasoning: m.reasoning,
					input: m.input,
					cost: m.cost,
					contextWindow: m.contextWindow,
					maxTokens: m.maxTokens,
				}));

			if (freeModels.length === 0) {
				console.warn(
					"[openrouter] No free models available from existing auth",
				);
				return;
			}

			// Store for command toggle
			stored.free = freeModels;
			stored.all = existingModels;

			// Set up re-registration closure
			reRegisterFn = (m: ProviderModelConfig[]) => {
				ctx.modelRegistry.registerProvider(PROVIDER_OPENROUTER, {
					baseUrl: BASE_URL_OPENROUTER,
					apiKey: "OPENROUTER_API_KEY",
					api: "openai-completions" as const,
					headers: {
						"HTTP-Referer": "https://github.com/apmantza/pi-free",
						"X-Title": "Pi",
						"User-Agent": "pi-free-providers",
					},
					models: m,
				});
			};

			// Register filtered version (no apiKey - uses existing Pi auth)
			reRegisterFn(freeModels);
			return;
		}

		// User doesn't have existing auth — use our extension's key
		if (apiKey) {
			process.env.OPENROUTER_API_KEY = apiKey;
		} else {
			console.warn(
				"[openrouter] No API key found — set OPENROUTER_API_KEY or add openrouter_api_key to ~/.pi/free.json. Free key at https://openrouter.ai",
			);
			return;
		}

		let models: ProviderModelConfig[] = [];
		let fetchResult: {
			free: ProviderModelConfig[];
			all: ProviderModelConfig[];
		} | null = null;

		try {
			fetchResult = await fetchOpenRouterModels(apiKey);
			models = OPENROUTER_SHOW_PAID ? fetchResult.all : fetchResult.free;
		} catch (error) {
			logWarning("openrouter", "Failed to fetch models", error);
		}

		if (models.length === 0) return;

		// Store for command toggle
		if (fetchResult) {
			stored.free = fetchResult.free;
			stored.all = fetchResult.all;
		}

		// Set up re-registration closure
		reRegisterFn = (m: ProviderModelConfig[]) => {
			ctx.modelRegistry.registerProvider(PROVIDER_OPENROUTER, {
				baseUrl: BASE_URL_OPENROUTER,
				apiKey: "OPENROUTER_API_KEY",
				api: "openai-completions" as const,
				headers: {
					"HTTP-Referer": "https://github.com/apmantza/pi-free",
					"X-Title": "Pi",
					"User-Agent": "pi-free-providers",
				},
				models: m,
			});
		};

		// Register our filtered provider
		reRegisterFn(models);

		// Fetch and cache metrics (used internally, not displayed)
		await fetchOpenRouterMetrics();
	});
}
