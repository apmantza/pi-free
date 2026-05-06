/**
 * SambaNova Provider Extension
 *
 * SambaNova Cloud offers fast inference on custom RDU hardware with an
 * OpenAI-compatible API. Known for running Llama 3.3 70B faster than
 * competitors.
 *
 * Free tier (no credit card, no payment method):
 *   - Production models: 20-480 RPM, 400-9600 RPD
 *   - Preview models: 10-150 RPM, 200-3000 RPD
 *   - Forever free, no token pricing
 *
 * Developer tier (add payment method):
 *   - Higher rate limits, same models
 *
 * Endpoint:
 *   Chat: https://api.sambanova.ai/v1/chat/completions
 *
 * Setup:
 *   1. Sign up at https://cloud.sambanova.ai/
 *   2. Get API key from https://cloud.sambanova.ai/apis
 *   3. Set SAMBANOVA_API_KEY env var (or add to ~/.pi/free.json)
 *
 * Usage:
 *   pi install git:github.com/apmantza/pi-free
 *   # Set SAMBANOVA_API_KEY env var
 *   # Models appear in /model selector as "sambanova/Meta-Llama-3.3-70B-Instruct"
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getSambanovaApiKey, getSambanovaShowPaid } from "../../config.ts";
import { BASE_URL_SAMBANOVA, PROVIDER_SAMBANOVA } from "../../constants.ts";
import { createLogger } from "../../lib/logger.ts";
import { registerWithGlobalToggle } from "../../lib/registry.ts";
import { fetchOpenAICompatibleModels } from "../../lib/util.ts";
import { createReRegister, setupProvider } from "../../provider-helper.ts";

const _logger = createLogger("sambanova");

// =============================================================================
// Extension Entry Point
// =============================================================================

export default async function sambanovaProvider(pi: ExtensionAPI) {
	const apiKey = getSambanovaApiKey();

	if (!apiKey) {
		_logger.info(
			"[sambanova] Skipping — SAMBANOVA_API_KEY not set. Sign up at https://cloud.sambanova.ai/",
		);
		return;
	}

	// Fetch models via shared OpenAI-compatible helper
	const allModels = await fetchOpenAICompatibleModels(
		"sambanova",
		BASE_URL_SAMBANOVA,
		apiKey,
		{ maxTokens: 8_192 },
	);

	if (allModels.length === 0) {
		_logger.warn("[sambanova] No models available");
		return;
	}

	// All SambaNova models are free-tier (no payment method required).
	// Rate limits are lower on free tier but all models are accessible.
	const freeModels = allModels;
	const stored = { free: freeModels, all: allModels };

	_logger.info(
		`[sambanova] Registered ${allModels.length} models (all free tier)`,
	);

	// Create re-register function
	const reRegister = createReRegister(pi, {
		providerId: PROVIDER_SAMBANOVA,
		baseUrl: BASE_URL_SAMBANOVA,
		apiKey,
	});

	// Register with global toggle
	registerWithGlobalToggle(PROVIDER_SAMBANOVA, stored, reRegister, true);

	// Setup provider with toggle command
	setupProvider(
		pi,
		{
			providerId: PROVIDER_SAMBANOVA,
			initialShowPaid: getSambanovaShowPaid(),
			tosUrl: "https://sambanova.ai/terms",
			reRegister: (models, _stored) => {
				if (_stored) {
					stored.free = _stored.free;
					stored.all = _stored.all;
				}
				reRegister(models);
			},
		},
		stored,
	);

	// Initial registration — respect persisted toggle state
	const showPaid = getSambanovaShowPaid();
	const initialModels =
		showPaid && stored.all.length > 0 ? stored.all : freeModels;
	reRegister(initialModels);
}
