/**
 * ZenMux Provider Extension
 *
 * Provides access to ZenMux AI gateway - unified API for 200+ models from
 * OpenAI, Anthropic, Google, and other providers.
 *
 * Setup:
 *   1. Get API key from https://zenmux.ai
 *   2. Set ZENMUX_API_KEY env var or add to ~/.pi/free.json
 *
 * Responds to global free-only filter.
 *
 * Usage:
 *   pi install git:github.com/apmantza/pi-free
 *   # Set ZENMUX_API_KEY env var
 *   # Models appear in /model selector
 */

import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import { getZenmuxApiKey, getZenmuxShowPaid } from "../../config.ts";
import {
	BASE_URL_ZENMUX,
	DEFAULT_FETCH_TIMEOUT_MS,
	PROVIDER_ZENMUX,
} from "../../constants.ts";
import { createLogger } from "../../lib/logger.ts";
import { getProxyModelCompat } from "../../lib/provider-compat.ts";
import { isFreeModel, registerWithGlobalToggle } from "../../lib/registry.ts";
import { fetchWithRetry } from "../../lib/util.ts";
import { createReRegister, setupProvider } from "../../provider-helper.ts";

const _logger = createLogger("zenmux");

// =============================================================================
// Fetch ZenMux models
// =============================================================================

interface ZenMuxModel {
	id: string;
	display_name?: string;
	context_length?: number;
	input_modalities?: string[];
	output_modalities?: string[];
	capabilities?: {
		reasoning?: boolean;
	};
	pricings?: {
		prompt?: Array<{ value: number }>;
		completion?: Array<{ value: number }>;
		input_cache_read?: Array<{ value: number }>;
	};
}

/**
 * Extract the first pricing value from a ZenMux pricings array.
 * ZenMux uses a structured format: pricings.prompt[0].value (per-million-tokens).
 * We divide by 1_000_000 to convert to per-token price (Pi's convention).
 * Returns 0 if pricing is missing or empty.
 */
function extractZenmuxPrice(
	pricings: ZenMuxModel["pricings"],
	key: "prompt" | "completion" | "input_cache_read",
): number {
	const entries = pricings?.[key];
	if (!entries || entries.length === 0) return 0;
	return (entries[0].value ?? 0) / 1_000_000;
}

async function fetchZenmuxModels(
	apiKey: string,
): Promise<ProviderModelConfig[]> {
	_logger.info("[zenmux] Fetching models from ZenMux API...");

	try {
		const response = await fetchWithRetry(
			`${BASE_URL_ZENMUX}/models`,
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
			throw new Error(`ZenMux API error: ${response.status}`);
		}

		const data = (await response.json()) as { data?: ZenMuxModel[] };
		const models = data.data ?? [];

		_logger.info(`[zenmux] Fetched ${models.length} models`);

		return models.map(
			(m): ProviderModelConfig => ({
				id: m.id,
				name: m.display_name || m.id,
				reasoning: m.capabilities?.reasoning ?? false,
				input: m.input_modalities?.includes("image")
					? ["text", "image"]
					: ["text"],
				cost: {
					input: extractZenmuxPrice(m.pricings, "prompt"),
					output: extractZenmuxPrice(m.pricings, "completion"),
					cacheRead: extractZenmuxPrice(m.pricings, "input_cache_read"),
					cacheWrite: 0,
				},
				contextWindow: m.context_length || 128000,
				maxTokens: m.context_length ? Math.floor(m.context_length / 2) : 4096,
				compat: getProxyModelCompat(m),
			}),
		);
	} catch (error) {
		_logger.error("[zenmux] Failed to fetch models:", {
			error: error instanceof Error ? error.message : String(error),
		});
		return [];
	}
}

// =============================================================================
// Extension Entry Point
// =============================================================================

export default async function zenmuxProvider(pi: ExtensionAPI) {
	const apiKey = getZenmuxApiKey();

	if (!apiKey) {
		_logger.info(
			"[zenmux] Skipping - ZENMUX_API_KEY not set (env var or ~/.pi/free.json)",
		);
		return;
	}

	// Fetch models
	const allModels = await fetchZenmuxModels(apiKey);

	if (allModels.length === 0) {
		_logger.warn("[zenmux] No models available");
		return;
	}

	// Use isFreeModel with allModels for proper detection
	// ZenMux exposes pricing, so Route A (OR logic) will be used:
	// FREE if cost=0 OR "free" in name
	const freeModels = allModels.filter((m) =>
		isFreeModel({ ...m, provider: PROVIDER_ZENMUX }, allModels),
	);

	const stored = { free: freeModels, all: allModels };

	_logger.info(
		`[zenmux] Registered ${allModels.length} models (${freeModels.length} free)`,
	);

	// Create re-register function
	const reRegister = createReRegister(pi, {
		providerId: PROVIDER_ZENMUX,
		baseUrl: BASE_URL_ZENMUX,
		apiKey,
	});

	// Register with global toggle
	registerWithGlobalToggle(PROVIDER_ZENMUX, stored, reRegister, true);

	// Setup provider with toggle command
	setupProvider(
		pi,
		{
			providerId: PROVIDER_ZENMUX,
			initialShowPaid: getZenmuxShowPaid(),
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
	const showPaid = getZenmuxShowPaid();
	const initialModels =
		showPaid && stored.all.length > 0 ? stored.all : freeModels;
	reRegister(initialModels);
}
