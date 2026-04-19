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
} from "../../config.ts";
import {
	BASE_URL_OPENROUTER,
	DEFAULT_FETCH_TIMEOUT_MS,
	DEFAULT_MIN_SIZE_B,
} from "../../constants.ts";
import { fetchOpenRouterMetrics } from "../../usage/metrics.ts";
import {
	type StoredModels,
	setupProvider,
	createReRegister,
	createCtxReRegister,
} from "../../provider-helper.ts";
import { createLogger } from "../../lib/logger.ts";
import { cleanModelName, isUsableModel, logWarning } from "../../lib/util.ts";
import { fetchOpenRouterModelsWithFree } from "../model-fetcher.ts";

const _logger = createLogger("openrouter");

const OPENROUTER_CONFIG = {
	providerId: PROVIDER_OPENROUTER,
	baseUrl: BASE_URL_OPENROUTER,
	apiKey: "OPENROUTER_API_KEY",
	headers: {
		"HTTP-Referer": "https://github.com/apmantza/pi-free",
		"X-Title": "Pi",
	},
};

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

	// Fetch models immediately for --list-models visibility
	let initialModels: ProviderModelConfig[] = [];
	let fetchResult: { free: ProviderModelConfig[]; all: ProviderModelConfig[] } | null = null;

	if (apiKey) {
		try {
			fetchResult = await fetchOpenRouterModels(apiKey);
			initialModels = OPENROUTER_SHOW_PAID ? fetchResult.all : fetchResult.free;
		} catch (error) {
			logWarning("openrouter", "Failed to fetch models at startup", error);
		}
	} else {
		_logger.warn(
			"[openrouter] No API key found — set OPENROUTER_API_KEY or add openrouter_api_key to ~/.pi/free.json. Free key at https://openrouter.ai",
		);
	}

	// Shared model storage for setupProvider commands
	const stored: StoredModels = {
		free: fetchResult?.free ?? [],
		all: fetchResult?.all ?? [],
	};

	// Register provider immediately (shows in --list-models)
	if (initialModels.length > 0) {
		pi.registerProvider(PROVIDER_OPENROUTER, {
			baseUrl: BASE_URL_OPENROUTER,
			apiKey: "OPENROUTER_API_KEY",
			api: "openai-completions" as const,
			headers: OPENROUTER_CONFIG.headers,
			models: initialModels,
		});
	}

	// Wire up shared boilerplate (commands, model_select, turn_end)
	const reRegister = createReRegister(pi, OPENROUTER_CONFIG);
	setupProvider(
		pi,
		{
			providerId: PROVIDER_OPENROUTER,
			initialShowPaid: OPENROUTER_SHOW_PAID,
			reRegister: (models) => reRegister(models),
		},
		stored,
	);

	// Refresh models on session_start
	pi.on("session_start", async (_event, ctx) => {
		// If no API key, nothing to refresh
		if (!apiKey) return;

		// Check if user has existing auth
		const availableModels = ctx.modelRegistry.getAvailable();
		const existingModels = availableModels.filter(
			(m) => m.provider === PROVIDER_OPENROUTER,
		);

		if (existingModels.length > 0) {
			// User has existing auth - filter to free models, use their key
			const freeModels = existingModels
				.filter((m) => (m.cost?.input ?? 0) === 0)
				.filter((m) => isUsableModel(m.id, DEFAULT_MIN_SIZE_B))
				.map((m) => ({
					id: m.id,
					name: cleanModelName(m.name),
					reasoning: m.reasoning,
					input: m.input,
					cost: m.cost,
					contextWindow: m.contextWindow,
					maxTokens: m.maxTokens,
				}));

			if (freeModels.length === 0) {
				_logger.warn(
					"[openrouter] No free models available from existing auth",
				);
				return;
			}

			stored.free = freeModels;
			stored.all = existingModels;

			// Create re-register function using ctx
			const ctxReRegister = createCtxReRegister(ctx as any, OPENROUTER_CONFIG);
			ctxReRegister(freeModels);
			return;
		}

		// Use our extension's key to fetch fresh models
		let models: ProviderModelConfig[] = [];

		try {
			fetchResult = await fetchOpenRouterModels(apiKey);
			models = OPENROUTER_SHOW_PAID ? fetchResult.all : fetchResult.free;
		} catch (error) {
			logWarning("openrouter", "Failed to fetch models at session start", error);
		}

		if (models.length === 0) return;

		// Update stored models
		stored.free = fetchResult!.free;
		stored.all = fetchResult!.all;

		// Create re-register function using ctx and register
		const ctxReRegister = createCtxReRegister(ctx as any, OPENROUTER_CONFIG);
		ctxReRegister(models);

		// Fetch and cache metrics (used internally, not displayed)
		await fetchOpenRouterMetrics();
	});
}
