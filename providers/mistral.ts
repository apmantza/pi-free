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
// with 422 Unprocessable Entity. Supported fields: stop, top_p,
// frequency_penalty, presence_penalty, response_format, tool_choice,
// parallel_tool_calls. NOT supported: seed, user, metadata, prediction.

const MISTRAL_UNSUPPORTED_FIELDS = new Set([
	"seed",
	"user",
	"metadata",
	"prediction",
]);

// Known Mistral model IDs for detection - covers all our registered models
const MISTRAL_MODEL_IDS = new Set([
	"mistral-small-latest",
	"mistral-medium-latest",
	"mistral-large-latest",
	"mistral-large-2411",
	"mistral-small-2503",
	"mistral-small-2505",
	"mistral-medium-2505",
	"mistral-large-2505",
	"open-mistral-nemo",
	"mistral-tiny",
	"mistral-embed",
]);

function isMistralPayload(payload: Record<string, unknown>): boolean {
	const modelId = payload.model as string | undefined;
	const isMistral = !!modelId && modelId.includes("mistral");
	// Debug logging to help diagnose issues
	if (isMistral) {
		_logger.info(`Detected Mistral payload for model: ${modelId}`);
	}
	return isMistral;
}

function filterMistralPayload(payload: Record<string, unknown>): Record<string, unknown> {
	const filtered: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(payload)) {
		if (!MISTRAL_UNSUPPORTED_FIELDS.has(key)) {
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
	pi.on("before_provider_request", (event) => {
		const payload = event.payload as Record<string, unknown>;
		// Log payload keys for debugging
		_logger.info(`before_provider_request payload keys: ${Object.keys(payload).join(", ")}`);
		_logger.info(`before_provider_request payload.model: ${payload.model}`);
		if (isMistralPayload(payload)) {
			_logger.info(`Filtering Mistral payload, removing fields: ${Object.keys(payload).filter(k => MISTRAL_UNSUPPORTED_FIELDS.has(k)).join(", ")}`);
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
