/**
 * Mistral AI Provider Extension
 *
 * Provides access to Mistral's models via api.mistral.ai.
 * Uses OpenAI-compatible API - requires MISTRAL_API_KEY.
 * Get a free key at: https://console.mistral.ai/api-keys
 *
 * Mistral offers:
 * - Mistral Small (free tier available)
 * - Mistral Medium (paid)
 * - Mistral Large (paid)
 * - Mistral Nemo (free tier)
 *
 * Free tier includes limited requests to small/nemo models.
 */

import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@mariozechner/pi-coding-agent";
import {
	MISTRAL_API_KEY as CONFIG_API_KEY,
	MISTRAL_SHOW_PAID,
	PROVIDER_MISTRAL,
} from "../config.ts";
import { BASE_URL_MISTRAL } from "../constants.ts";
import { createLogger } from "../lib/logger.ts";
import {
	type StoredModels,
	setupProvider,
	createReRegister,
} from "../provider-helper.ts";

const _logger = createLogger("mistral");

const MISTRAL_CONFIG = {
	providerId: PROVIDER_MISTRAL,
	baseUrl: BASE_URL_MISTRAL,
	apiKey: "MISTRAL_API_KEY",
};

// =============================================================================
// Mistral models - hardcoded with pricing
// =============================================================================

function getMistralModels(): ProviderModelConfig[] {
	return [
		// Free tier models
		{
			id: "mistral-small-latest",
			name: "Mistral Small (Free Tier)",
			reasoning: false,
			input: ["text", "image"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 32768,
			maxTokens: 8192,
		},
		{
			id: "open-mistral-nemo",
			name: "Mistral Nemo (Free Tier)",
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128000,
			maxTokens: 8192,
		},
		// Paid models (shown when MISTRAL_SHOW_PAID=true)
		{
			id: "mistral-medium-latest",
			name: "Mistral Medium",
			reasoning: false,
			input: ["text", "image"],
			cost: { input: 2.7, output: 8.1, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 32768,
			maxTokens: 8192,
		},
		{
			id: "mistral-large-latest",
			name: "Mistral Large",
			reasoning: true,
			input: ["text", "image"],
			cost: { input: 2, output: 6, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128000,
			maxTokens: 128000,
		},
		{
			id: "mistral-small-2503",
			name: "Mistral Small 2503",
			reasoning: false,
			input: ["text", "image"],
			cost: { input: 0.1, output: 0.3, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 32768,
			maxTokens: 8192,
		},
		{
			id: "mistral-medium-2505",
			name: "Mistral Medium 2505",
			reasoning: false,
			input: ["text", "image"],
			cost: { input: 0.4, output: 1.2, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 32768,
			maxTokens: 8192,
		},
		{
			id: "mistral-large-2505",
			name: "Mistral Large 2505",
			reasoning: true,
			input: ["text", "image"],
			cost: { input: 0.4, output: 1.2, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128000,
			maxTokens: 128000,
		},
	];
}

// =============================================================================
// Extension Entry Point
// =============================================================================

export default async function (pi: ExtensionAPI) {
	const apiKey = CONFIG_API_KEY;

	// Inject into process.env so Pi's apiKey lookup finds it
	if (apiKey) process.env.MISTRAL_API_KEY = apiKey;

	if (!apiKey) {
		_logger.warn(
			"No API key found — set MISTRAL_API_KEY or add mistral_api_key to ~/.pi/free.json. Get a key at https://console.mistral.ai/api-keys",
		);
		return;
	}

	const allModels = getMistralModels();

	// Filter to free models unless paid mode is enabled
	const models = MISTRAL_SHOW_PAID
		? allModels
		: allModels.filter((m) => (m.cost?.input ?? 0) === 0);

	if (models.length === 0) {
		_logger.warn("No models available");
		return;
	}

	// Shared model storage
	const stored: StoredModels = { free: models, all: allModels };

	// Register provider
	pi.registerProvider(PROVIDER_MISTRAL, {
		baseUrl: BASE_URL_MISTRAL,
		apiKey: "MISTRAL_API_KEY",
		api: "openai-completions" as const,
		headers: { "User-Agent": "pi-free-providers" },
		models,
	});

	// Wire up shared boilerplate (commands, model_select, turn_end)
	const reRegister = createReRegister(pi, MISTRAL_CONFIG);
	setupProvider(
		pi,
		{
			providerId: PROVIDER_MISTRAL,
			isPaidMode: MISTRAL_SHOW_PAID,
			reRegister: (m) => {
				stored.free = m;
				stored.all = m;
				reRegister(m);
			},
		},
		stored,
	);
}
