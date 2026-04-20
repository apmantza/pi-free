/**
 * Fireworks AI Provider Extension
 *
 * Provides access to Fireworks AI hosted models via api.fireworks.ai.
 * Uses OpenAI-compatible API - requires FIREWORKS_API_KEY.
 * Get a key at: https://app.fireworks.ai/settings/users/api-keys
 *
 * All models are credit-based (no free tier).
 */

import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@mariozechner/pi-coding-agent";
import { FIREWORKS_API_KEY, PROVIDER_FIREWORKS } from "../../config.ts";
import { BASE_URL_FIREWORKS } from "../../constants.ts";
import { enhanceWithCI } from "../../provider-helper.ts";

// =============================================================================
// Static model list (Fireworks doesn't have a models API)
// =============================================================================

function getFireworksModels(): ProviderModelConfig[] {
	return [
		{
			id: "accounts/fireworks/routers/kimi-k2p5-turbo",
			name: "Kimi K2.5 Turbo",
			reasoning: true,
			input: ["text"],
			// Actual pricing (per 1M tokens): $0.50 input, $2.00 output
			cost: { input: 0.0005, output: 0.002, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 262144,
			maxTokens: 131072,
		},
	];
}

// =============================================================================
// Extension Entry Point
// =============================================================================

export default function (pi: ExtensionAPI): void {
	// Skip if no API key configured
	if (!FIREWORKS_API_KEY) {
		console.log(
			"[fireworks] No API key found — set FIREWORKS_API_KEY to enable",
		);
		return;
	}

	// Inject key into env for Pi's lookup
	process.env.FIREWORKS_API_KEY = FIREWORKS_API_KEY;

	// Register provider directly (no toggle since all models are paid)
	const models = getFireworksModels();
	pi.registerProvider(PROVIDER_FIREWORKS, {
		baseUrl: BASE_URL_FIREWORKS,
		apiKey: "FIREWORKS_API_KEY",
		api: "openai-completions" as const,
		headers: {
			"User-Agent": "pi-free-providers",
		},
		models: enhanceWithCI(models),
	});

	console.log(`[fireworks] Registered ${models.length} paid models`);
}
