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
// Mistral payload filter
// =============================================================================
// Mistral's API is OpenAI-compatible but stricter — it rejects unknown fields
// with 422 Unprocessable Entity. 
//
// Supported: stop, top_p, frequency_penalty, presence_penalty, response_format,
// tool_choice, parallel_tool_calls, max_tokens, temperature
//
// NOT supported: store, stream_options, seed, user, metadata, prediction,
// max_completion_tokens (use max_tokens instead)

// WHITELIST: Only include fields that Mistral explicitly supports
const MISTRAL_ALLOWED_FIELDS = new Set([
	"model",
	"messages",
	"tools",
	"stream",
	"stop",
	"top_p",
	"frequency_penalty",
	"presence_penalty",
	"response_format",
	"tool_choice",
	"parallel_tool_calls",
	"temperature",
	"max_tokens",
]);

function isMistralPayload(payload: Record<string, unknown>): boolean {
	const modelId = payload.model as string | undefined;
	// Check if this is a Mistral model (broader match to catch all variants)
	return !!modelId && (modelId.includes("mistral") || modelId.includes("nemo"));
}

function filterMistralPayload(payload: Record<string, unknown>): Record<string, unknown> {
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

	// Filter out unsupported fields from requests to Mistral
	// Using whitelist approach: only allow fields Mistral supports
	// Note: before_provider_request is a runtime event not in SDK types
	(pi.on as Function)("before_provider_request", (event: { type: string; payload: unknown }) => {
		const payload = event.payload as Record<string, unknown>;
		if (isMistralPayload(payload)) {
			return filterMistralPayload(payload);
		}
		return undefined;
	});

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
