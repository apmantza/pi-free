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

import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@mariozechner/pi-coding-agent";
import { getCrofaiApiKey } from "../../config.ts";
import {
	BASE_URL_CROFAI,
	DEFAULT_FETCH_TIMEOUT_MS,
	PROVIDER_CROFAI,
} from "../../constants.ts";
import { createLogger } from "../../lib/logger.ts";
import { isFreeModel, registerWithGlobalToggle } from "../../lib/registry.ts";
import { fetchWithRetry } from "../../lib/util.ts";
import {
	createReRegister,
	enhanceWithCI,
	setupProvider,
} from "../../provider-helper.ts";

const _logger = createLogger("crofai");

// =============================================================================
// Fetch CrofAI models
// =============================================================================

interface CrofaiModel {
	id: string;
	object?: string;
	created?: number;
	owned_by?: string;
}

async function fetchCrofaiModels(
	apiKey: string,
): Promise<ProviderModelConfig[]> {
	_logger.info("[crofai] Fetching models from CrofAI API...");

	try {
		const response = await fetchWithRetry(
			`${BASE_URL_CROFAI}/models`,
			{
				headers: {
					Authorization: `Bearer ${apiKey}`,
					"Content-Type": "application/json",
				},
			},
			3,
			1000,
			DEFAULT_FETCH_TIMEOUT_MS,
		);

		if (!response.ok) {
			throw new Error(`CrofAI API error: ${response.status}`);
		}

		const data = (await response.json()) as { data?: CrofaiModel[] };
		const models = data.data ?? [];

		_logger.info(`[crofai] Fetched ${models.length} models`);

		return models
			.filter((m) => m.id) // Filter out any empty entries
			.map(
				(m): ProviderModelConfig => ({
					id: m.id,
					name: m.id.split("/").pop() || m.id, // Use last part of ID as name
					reasoning: m.id.includes("reasoning") || m.id.includes("think"),
					input: ["text"],
					cost: {
						input: 0, // CrofAI doesn't expose pricing via API
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
					},
					contextWindow: 128000, // Default, varies by model
					maxTokens: 4096,
				}),
			);
	} catch (error) {
		_logger.error(
			"[crofai] Failed to fetch models:",
			{ error: error instanceof Error ? error.message : String(error) },
		);
		return [];
	}
}

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

	// Fetch models
	const allModels = await fetchCrofaiModels(apiKey);

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
			initialShowPaid: false,
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
