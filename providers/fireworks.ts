/**
 * Fireworks AI Provider Extension
 *
 * Provides access to Fireworks AI hosted models via api.fireworks.ai.
 * Uses OpenAI-compatible API - requires FIREWORKS_API_KEY.
 * Get a free key at: https://app.fireworks.ai/settings/users/api-keys
 *
 * Fireworks offers fast inference for open-source models including:
 * - DeepSeek V3/R1
 * - Llama models
 * - Qwen models
 * - Mixtral models
 * - And many more
 *
 * All models are credit-based (no free tier).
 */

import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@mariozechner/pi-coding-agent";
import {
	FIREWORKS_API_KEY as CONFIG_API_KEY,
	PROVIDER_FIREWORKS,
} from "../config.ts";
import { BASE_URL_FIREWORKS } from "../constants.ts";
import { createLogger } from "../lib/logger.ts";
import { type StoredModels, setupProvider } from "../provider-helper.ts";

const _logger = createLogger("fireworks");

// =============================================================================
// Fireworks models - hardcoded (models.dev doesn't have Fireworks data yet)
// =============================================================================

function getFireworksModels(): ProviderModelConfig[] {
	return [
		{
			id: "accounts/fireworks/routers/kimi-k2p5-turbo",
			name: "Kimi K2.5 Turbo",
			reasoning: true,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 262144,
			maxTokens: 131072,
		},
	];
}

// =============================================================================
// Extension Entry Point
// =============================================================================

export default async function (pi: ExtensionAPI) {
	const apiKey = CONFIG_API_KEY;

	// Inject into process.env so Pi's apiKey lookup finds it even when loaded from ~/.pi/free.json.
	if (apiKey) process.env.FIREWORKS_API_KEY = apiKey;

	if (!apiKey) {
		_logger.warn(
			"No API key found — set FIREWORKS_API_KEY or add fireworks_api_key to ~/.pi/free.json. Get a key at https://app.fireworks.ai/settings/users/api-keys",
		);
		return;
	}

	const models = getFireworksModels();

	if (models.length === 0) return;

	// Shared model storage (single set - Fireworks has no free/all split)
	const stored: StoredModels = { free: models, all: models };

	pi.registerProvider(PROVIDER_FIREWORKS, {
		baseUrl: BASE_URL_FIREWORKS,
		apiKey: "FIREWORKS_API_KEY",
		api: "openai-completions" as const,
		headers: { "User-Agent": "pi-free-providers" },
		models,
	});

	// Wire up shared boilerplate (commands, model_select, turn_end)
	setupProvider(
		pi,
		{
			providerId: PROVIDER_FIREWORKS,
			reRegister: (m) => {
				stored.free = m;
				stored.all = m;
				pi.registerProvider(PROVIDER_FIREWORKS, {
					baseUrl: BASE_URL_FIREWORKS,
					apiKey: "FIREWORKS_API_KEY",
					api: "openai-completions" as const,
					headers: { "User-Agent": "pi-free-providers" },
					models: m,
				});
			},
		},
		stored,
	);
}
