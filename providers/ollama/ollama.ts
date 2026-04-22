/**
 * Ollama Cloud Provider Extension
 *
 * Provides access to Ollama's cloud-hosted models via ollama.com API.
 * All models use Ollama's usage-based pricing system:
 *   - Free tier: Unlimited public models (session limits reset every 5 hours,
 *     weekly limits reset every 7 days)
 *   - Pro tier: 50x more cloud usage than Free
 *   - Max tier: 5x more usage than Pro
 *
 * Requires OLLAMA_API_KEY with cloud access.
 * Get a free key at: https://ollama.com/settings/keys
 *
 * Responds to global /free toggle (shows models but warns they're freemium).
 *
 * Usage:
 *   pi install git:github.com/apmantza/pi-free
 *   # Set OLLAMA_API_KEY env var
 *   # Models appear in /model selector
 *   # Use /ollama-toggle to show all vs limited set
 */

import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@mariozechner/pi-coding-agent";
import {
	applyHidden,
	getOllamaApiKey,
	getOllamaShowPaid,
} from "../../config.ts";
import {
	BASE_URL_OLLAMA,
	DEFAULT_FETCH_TIMEOUT_MS,
	PROVIDER_OLLAMA,
} from "../../constants.ts";
import { createLogger } from "../../lib/logger.ts";
import { registerWithGlobalToggle } from "../../lib/registry.ts";
import { fetchWithRetry } from "../../lib/util.ts";
import { createReRegister, enhanceWithCI } from "../../provider-helper.ts";

const _logger = createLogger("ollama-cloud");

// =============================================================================
// Fetch + map
// =============================================================================

async function fetchOllamaModels(
	apiKey: string,
): Promise<ProviderModelConfig[]> {
	// Use OpenAI-compatible /v1/models endpoint for consistency
	// The native /api/tags returns :cloud suffixes that may not work with /v1/chat/completions
	const response = await fetchWithRetry(
		`${BASE_URL_OLLAMA}/v1/models`,
		{
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
		},
		3,
		1000,
		DEFAULT_FETCH_TIMEOUT_MS,
	);

	if (!response.ok) {
		throw new Error(
			`Failed to fetch Ollama models: ${response.status} ${response.statusText}`,
		);
	}

	const json = (await response.json()) as {
		data?: Array<{ id: string; owned_by?: string }>;
	};
	const models = json.data ?? [];

	_logger.info(
		`[ollama-cloud] Fetched ${models.length} models from Ollama Cloud`,
	);

	// Filter to chat/text generation models only
	const chatModels = models.filter((m) => {
		// Skip embedding-only models (typically have "embed" in name)
		const name = m.id.toLowerCase();
		if (name.includes("embed")) return false;
		return true;
	});

	const result = applyHidden(
		chatModels.map(
			(m): ProviderModelConfig => ({
				id: m.id,
				name: m.id,
				// Try to infer reasoning from model name
				reasoning:
					m.id.toLowerCase().includes("reasoning") ||
					m.id.toLowerCase().includes("r1") ||
					m.id.toLowerCase().includes("thinking"),
				input: ["text"],
				// Ollama Cloud uses usage-based pricing (GPU time), not per-token
				// Free tier has limits but no direct cost per token
				cost: {
					input: 0, // Freemium: usage-based, not per-token
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
				},
				// Default context window - Ollama doesn't expose this via /v1/models
				contextWindow: 32768,
				maxTokens: 4096, // Default, varies by model
			}),
		),
	);

	return result;
}

// =============================================================================
// Extension Entry Point
// =============================================================================

export default async function (pi: ExtensionAPI) {
	const apiKey = getOllamaApiKey();

	if (!apiKey) {
		_logger.info(
			"[ollama-cloud] Skipping - OLLAMA_API_KEY not set (env var or ~/.pi/free.json)",
		);
		return;
	}

	// Fetch models
	let allModels: ProviderModelConfig[] = [];

	try {
		allModels = await fetchOllamaModels(apiKey);
	} catch (error) {
		_logger.error("[ollama-cloud] Failed to fetch models at startup", {
			error: error instanceof Error ? error.message : String(error),
		});
		return;
	}

	// For Ollama, all models share the same free tier
	// So "free" and "all" are the same set
	const freeModels = allModels;
	const stored = { free: freeModels, all: allModels };
	const hasKey = true;

	// Create re-register function
	const reRegister = createReRegister(pi, {
		providerId: PROVIDER_OLLAMA,
		baseUrl: BASE_URL_OLLAMA,
		apiKey,
	});

	// Register with global toggle system
	registerWithGlobalToggle(PROVIDER_OLLAMA, stored, reRegister, hasKey);

	// Register initial models
	const initialModels = getOllamaShowPaid() ? allModels : freeModels;
	pi.registerProvider(PROVIDER_OLLAMA, {
		baseUrl: BASE_URL_OLLAMA,
		apiKey,
		api: "openai-completions" as const,
		models: enhanceWithCI(initialModels),
	});

	_logger.info(
		`[ollama-cloud] Registered ${initialModels.length} models (usage-based free tier)`,
	);
}
