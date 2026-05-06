/**
 * Codestral Provider Extension
 *
 * Codestral is Mistral AI's code-focused model. This provider registers it
 * through the Codestral-specific endpoint (codestral.mistral.ai) using
 * the Mistral SDK (api: "mistral-conversations") — separate from the built-in
 * "mistral" provider which uses api.mistral.ai.
 *
 * NOTE: Do NOT use api: "openai-completions" here. Codestral's API is
 * Mistral-format (camelCase fields, maxTokens, no stream_options/store).
 * The OpenAI completions adapter sends OpenAI-specific fields that Mistral
 * rejects with HTTP 422 "Extra inputs are not permitted".
 *
 * Free tier (Experiment plan):
 *   - 2 req/min, 500K tokens/min, 1B tokens/month
 *   - No credit card — phone verification only
 *   - Sign up at https://console.mistral.ai/codestral
 *
 * Endpoints:
 *   Chat:  https://codestral.mistral.ai/v1/chat/completions
 *   FIM:   https://codestral.mistral.ai/v1/fim/completions (not used by pi)
 *
 * Setup:
 *   1. Get API key from https://console.mistral.ai/codestral
 *   2. Set CODESTRAL_API_KEY env var (or MISTRAL_API_KEY as fallback)
 *
 * Usage:
 *   pi install git:github.com/apmantza/pi-free
 *   # Set CODESTRAL_API_KEY env var
 *   # Models appear in /model selector as "codestral/codestral-latest"
 */

import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@mariozechner/pi-coding-agent";
import {
	getCodestralApiKey,
	getCodestralShowPaid,
	getMistralApiKey,
} from "../../config.ts";
import { BASE_URL_CODESTRAL, PROVIDER_CODESTRAL } from "../../constants.ts";
import { createLogger } from "../../lib/logger.ts";
import { registerWithGlobalToggle } from "../../lib/registry.ts";
import { enhanceWithCI, setupProvider } from "../../provider-helper.ts";

const _logger = createLogger("codestral");

// =============================================================================
// Model Definition
// =============================================================================

const CODESTRAL_MODEL: ProviderModelConfig = {
	id: "codestral-latest",
	name: "Codestral",
	reasoning: false,
	input: ["text"],
	cost: {
		input: 0.3,
		output: 0.9,
		cacheRead: 0,
		cacheWrite: 0,
	},
	contextWindow: 256_000,
	maxTokens: 4_096,
};

// =============================================================================
// Extension Entry Point
// =============================================================================

export default async function codestralProvider(pi: ExtensionAPI) {
	// Try CODESTRAL_API_KEY first, fall back to MISTRAL_API_KEY
	const apiKey = getCodestralApiKey() || getMistralApiKey();

	if (!apiKey) {
		_logger.info(
			"[codestral] Skipping — neither CODESTRAL_API_KEY nor MISTRAL_API_KEY set",
		);
		return;
	}

	const keySource = getCodestralApiKey()
		? "CODESTRAL_API_KEY"
		: "MISTRAL_API_KEY";
	_logger.info(`[codestral] Using key from ${keySource}`);

	const allModels = [CODESTRAL_MODEL];
	const freeModels = allModels; // All $0.30/$0.90 — still accessible via Experiment free tier
	const stored = { free: freeModels, all: allModels };

	// Re-register function — uses mistral-conversations API (Mistral SDK)
	// NOT openai-completions: Codestral uses the same API format as Mistral
	// and rejects OpenAI-specific fields (stream_options, store, max_completion_tokens) with 422.
	const reRegister = (models: typeof freeModels) => {
		pi.registerProvider(PROVIDER_CODESTRAL, {
			baseUrl: BASE_URL_CODESTRAL,
			apiKey,
			api: "mistral-conversations" as const,
			models: enhanceWithCI(models, PROVIDER_CODESTRAL),
		});
	};

	// Register with global toggle
	registerWithGlobalToggle(PROVIDER_CODESTRAL, stored, reRegister, true);

	// Setup provider (toggle command, status bar, error handling)
	setupProvider(
		pi,
		{
			providerId: PROVIDER_CODESTRAL,
			initialShowPaid: getCodestralShowPaid(),
			skipToggle: true, // Only one model, no toggle needed
			reRegister: (models) => {
				stored.free = models;
				stored.all = models;
				reRegister(models);
			},
		},
		stored,
	);

	// Initial registration — uses mistral-conversations API (Mistral SDK)
	reRegister(freeModels);

	_logger.info(`[codestral] Registered codestral-latest via ${keySource}`);

	// Status bar
	pi.on("model_select", (_event, ctx) => {
		if (_event.model?.provider !== PROVIDER_CODESTRAL) {
			ctx.ui.setStatus(`${PROVIDER_CODESTRAL}-status`, undefined);
			return;
		}
		ctx.ui.setStatus(
			`${PROVIDER_CODESTRAL}-status`,
			`codestral: 1 model (free tier) 🔑`,
		);
	});
}
