/**
 * Mistral AI Provider Extension
 *
 * Provides access to Mistral's models via api.mistral.ai.
 * Free models available without account; paid models require MISTRAL_API_KEY.
 * Get a key at: https://console.mistral.ai/api-keys
 *
 * By default only free models are shown.
 * Set MISTRAL_SHOW_PAID=true to also include paid models.
 *
 * Note: Mistral has stricter field requirements than OpenAI —
 * only whitelisted fields are sent to avoid 400 errors.
 */

import type { ProviderModelConfig } from "@mariozechner/pi-coding-agent";
import { applyHidden, MISTRAL_SHOW_PAID, PROVIDER_MISTRAL } from "../config.ts";
import { BASE_URL_MISTRAL } from "../constants.ts";
import { createProvider } from "../provider-factory.ts";

// =============================================================================
// Static model list
// =============================================================================

function getMistralModels(): ProviderModelConfig[] {
	return applyHidden([
		// Free models
		{
			id: "mistral-small-latest",
			name: "Mistral Small",
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 32768,
			maxTokens: 32768,
		},
		{
			id: "open-mistral-nemo",
			name: "Mistral Nemo (Open)",
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128000,
			maxTokens: 128000,
		},
		// Paid models
		{
			id: "mistral-large-latest",
			name: "Mistral Large",
			reasoning: true,
			input: ["text"],
			cost: { input: 0.002, output: 0.006, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128000,
			maxTokens: 128000,
		},
		{
			id: "ministral-3b-latest",
			name: "Ministral 3B",
			reasoning: false,
			input: ["text"],
			cost: { input: 0.00004, output: 0.00004, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128000,
			maxTokens: 128000,
		},
		{
			id: "ministral-8b-latest",
			name: "Ministral 8B",
			reasoning: false,
			input: ["text"],
			cost: { input: 0.0001, output: 0.0001, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128000,
			maxTokens: 128000,
		},
		{
			id: "codestral-latest",
			name: "Codestral",
			reasoning: false,
			input: ["text"],
			cost: { input: 0.0003, output: 0.0009, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 256000,
			maxTokens: 256000,
		},
	]);
}

// =============================================================================
// Mistral-specific request filtering
// =============================================================================

const MISTRAL_ALLOWED_FIELDS = new Set([
	"model",
	"messages",
	"temperature",
	"max_tokens",
	"stream",
	"tools",
	"tool_choice",
	"stop",
	"top_p",
	"presence_penalty",
	"frequency_penalty",
]);

function isMistralPayload(payload: Record<string, unknown>): boolean {
	const modelId = payload.model as string | undefined;
	return !!modelId && (modelId.includes("mistral") || modelId.includes("nemo"));
}

function filterMistralPayload(
	payload: Record<string, unknown>,
): Record<string, unknown> {
	const filtered: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(payload)) {
		if (MISTRAL_ALLOWED_FIELDS.has(key)) {
			filtered[key] = value;
		}
	}
	return filtered;
}

// =============================================================================
// Extension Entry Point
// =============================================================================

export default function (pi: Parameters<typeof createProvider>[0]) {
	const allModels = getMistralModels();
	const models = MISTRAL_SHOW_PAID
		? allModels
		: allModels.filter((m) => (m.cost?.input ?? 0) === 0);

	// Override fetchModels to use our already-fetched models
	return createProvider(pi, {
		providerId: PROVIDER_MISTRAL,
		baseUrl: BASE_URL_MISTRAL,
		apiKeyEnvVar: "MISTRAL_API_KEY",
		apiKeyConfigKey: "mistral_api_key",
		fetchModels: async () => models,
		beforeProviderRequest: (payload) => {
			if (isMistralPayload(payload)) {
				return filterMistralPayload(payload);
			}
			return undefined;
		},
	});
}
