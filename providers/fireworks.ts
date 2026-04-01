/**
 * Fireworks AI Provider Extension
 *
 * Provides access to Fireworks AI hosted models via api.fireworks.ai.
 * Uses OpenAI-compatible API - requires FIREWORKS_API_KEY.
 * Get a key at: https://app.fireworks.ai/settings/users/api-keys
 *
 * All models are credit-based (no free tier).
 * Set FIREWORKS_SHOW_PAID=true to enable.
 */

import type { ProviderModelConfig } from "@mariozechner/pi-coding-agent";
import { PROVIDER_FIREWORKS } from "../config.ts";
import { BASE_URL_FIREWORKS } from "../constants.ts";
import { createProvider } from "../provider-factory.ts";

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

export default function (pi: Parameters<typeof createProvider>[0]) {
	return createProvider(pi, {
		providerId: PROVIDER_FIREWORKS,
		baseUrl: BASE_URL_FIREWORKS,
		apiKeyEnvVar: "FIREWORKS_API_KEY",
		apiKeyConfigKey: "fireworks_api_key",
		showPaidFlag: "FIREWORKS_SHOW_PAID",
		fetchModels: async () => getFireworksModels(),
	});
}
