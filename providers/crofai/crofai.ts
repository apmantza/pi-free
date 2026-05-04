/**
 * CrofAI Provider Extension
 *
 * Provides access to CrofAI API - OpenAI-compatible LLM inference service.
 *
 * Setup:
 *   1. Get API key from https://ai.nahcrof.com
 *   2. Set CROFAI_API_KEY env var or add to ~/.pi/free.json
 *
 * Responds to global free-only filter.
 *
 * Usage:
 *   pi install git:github.com/apmantza/pi-free
 *   # Set CROFAI_API_KEY env var
 *   # Models appear in /model selector
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getCrofaiApiKey, getCrofaiShowPaid } from "../../config.ts";
import {
	BASE_URL_CROFAI,
	PROVIDER_CROFAI,
} from "../../constants.ts";
import { createLogger } from "../../lib/logger.ts";
import { isFreeModel, registerWithGlobalToggle } from "../../lib/registry.ts";
import { fetchOpenAICompatibleModels } from "../../lib/util.ts";
import { createReRegister, setupProvider } from "../../provider-helper.ts";

const _logger = createLogger("crofai");

// =============================================================================
// Extension Entry Point
// =============================================================================

export default async function crofaiProvider(pi: ExtensionAPI) {
	const apiKey = getCrofaiApiKey();

	if (!apiKey) {
		_logger.info(
			"[crofai] Skipping - CROFAI_API_KEY not set (env var or ~/.pi/free.json)",
		);
		return;
	}

	// Fetch models via shared OpenAI-compatible helper
	const allModels = await fetchOpenAICompatibleModels(
		"crofai",
		BASE_URL_CROFAI,
		apiKey,
	);

	if (allModels.length === 0) {
		_logger.warn("[crofai] No models available");
		return;
	}

	// Use isFreeModel with allModels for proper detection
	// CrofAI doesn't expose pricing (all costs are $0), so Route B will be used:
	// FREE only if "free" in name
	const freeModels = allModels.filter((m) =>
		isFreeModel({ ...m, provider: PROVIDER_CROFAI }, allModels),
	);

	const stored = { free: freeModels, all: allModels };

	_logger.info(
		`[crofai] Registered ${allModels.length} models (${freeModels.length} free)`,
	);

	// Create re-register function
	const reRegister = createReRegister(pi, {
		providerId: PROVIDER_CROFAI,
		baseUrl: BASE_URL_CROFAI,
		apiKey,
	});

	// Register with global toggle
	registerWithGlobalToggle(PROVIDER_CROFAI, stored, reRegister, true);

	// Setup provider with toggle command
	setupProvider(
		pi,
		{
			providerId: PROVIDER_CROFAI,
			initialShowPaid: getCrofaiShowPaid(),
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

	// Initial registration
	reRegister(freeModels);
}
