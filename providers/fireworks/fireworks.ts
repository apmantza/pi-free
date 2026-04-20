/**
 * Fireworks AI Provider Extension
 *
 * Provides access to Fireworks AI hosted models via api.fireworks.ai.
 * Uses OpenAI-compatible API - requires FIREWORKS_API_KEY.
 * Get a key at: https://app.fireworks.ai/settings/users/api-keys
 *
 * Fetches all available models dynamically from /v1/models endpoint.
 * Responds to global /free toggle for free/paid model filtering.
 */

import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@mariozechner/pi-coding-agent";
import { FIREWORKS_API_KEY, PROVIDER_FIREWORKS } from "../../config.ts";
import { BASE_URL_FIREWORKS, DEFAULT_FETCH_TIMEOUT_MS } from "../../constants.ts";
import { registerWithGlobalToggle } from "../../index.ts";
import { createLogger } from "../../lib/logger.ts";
import { fetchWithRetry } from "../../lib/util.ts";
import {
	createReRegister,
	enhanceWithCI,
} from "../../provider-helper.ts";

const _logger = createLogger("fireworks");

// =============================================================================
// Fireworks API Types
// =============================================================================

interface FireworksModel {
	id: string;
	object: string;
	owned_by: string;
	created: number;
	kind: string;
	supports_chat: boolean;
	supports_image_input: boolean;
	supports_tools: boolean;
	context_length?: number;
}

interface FireworksModelsResponse {
	object: string;
	data: FireworksModel[];
}

// =============================================================================
// Helpers
// =============================================================================

function formatModelName(id: string): string {
	const match = id.match(/\/models\/(.+)$/);
	if (!match) return id;

	let name = match[1];
	name = name
		.replace(/-/g, " ")
		.replace(/v(\d+)p(\d+)/gi, "v$1.$2")
		.replace(/(\d+)b/gi, " $1B")
		.replace(/fp\d+/gi, (m) => m.toUpperCase())
		.replace(/oss/gi, "OSS");

	return name
		.split(" ")
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ");
}

function supportsReasoning(id: string): boolean {
	const reasoningModels = [
		"deepseek-r1",
		"deepseek-v3p2",
		"kimi-k2-thinking",
		"qwen3-vl-thinking",
		"qwen3-thinking",
		"glm-5",
		"cogito",
	];
	return reasoningModels.some((r) => id.toLowerCase().includes(r));
}

// =============================================================================
// Fetch models from Fireworks API
// =============================================================================

async function fetchFireworksModels(
	apiKey: string,
	freeOnly = false,
): Promise<ProviderModelConfig[]> {
	_logger.info("Fetching Fireworks models from API...");

	const response = await fetchWithRetry(
		`${BASE_URL_FIREWORKS}/models`,
		{
			headers: {
				"Authorization": `Bearer ${apiKey}`,
				"User-Agent": "pi-free-providers",
			},
		},
		3,
		1000,
		DEFAULT_FETCH_TIMEOUT_MS,
	);

	if (!response.ok) {
		throw new Error(
			`Failed to fetch Fireworks models: ${response.status} ${response.statusText}`,
		);
	}

	const json = (await response.json()) as FireworksModelsResponse;
	_logger.info(`Fetched ${json.data?.length || 0} total models from Fireworks`);

	// Filter to chat-capable models only
	let chatModels = json.data?.filter((m) => m.supports_chat) ?? [];

	// Fireworks uses a credit system - we can't determine free vs paid from API
	// For now, consider all models as "all" (paid/credit-based)
	// In freeOnly mode, we return empty (no truly free models)
	if (freeOnly) {
		// Fireworks has $1 starter credits but no permanently free models
		// Return empty for free-only mode
		_logger.info("Fireworks: no permanently free models (uses credit system)");
		return [];
	}

	return chatModels.map((model): ProviderModelConfig => {
		const hasVision = model.supports_image_input;

		return {
			id: model.id,
			name: formatModelName(model.id),
			reasoning: supportsReasoning(model.id),
			input: hasVision ? ["text", "image"] : ["text"],
			cost: {
				input: 0, // Credit-based system
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
			},
			contextWindow: model.context_length ?? 32768,
			maxTokens: Math.min(Math.floor((model.context_length ?? 32768) / 2), 8192),
		};
	});
}

// =============================================================================
// Extension Entry Point
// =============================================================================

export default async function (pi: ExtensionAPI): Promise<void> {
	if (!FIREWORKS_API_KEY) {
		_logger.info("No API key found — set FIREWORKS_API_KEY to enable");
		return;
	}

	process.env.FIREWORKS_API_KEY = FIREWORKS_API_KEY;

	try {
		// Fireworks uses credit system - fetch once (no free/paid split)
		const allModels = await fetchFireworksModels(FIREWORKS_API_KEY, false);

		if (allModels.length === 0) {
			_logger.warn("No chat-capable models found from Fireworks API");
			return;
		}

		// Create re-register function for global toggle
		const reRegister = createReRegister(pi, {
			providerId: PROVIDER_FIREWORKS,
			baseUrl: BASE_URL_FIREWORKS,
			apiKey: "FIREWORKS_API_KEY",
		});

		// Register with global toggle (empty free list since Fireworks is credit-based)
		registerWithGlobalToggle(
			PROVIDER_FIREWORKS,
			{ free: [], all: allModels },
			reRegister,
			true, // hasKey
		);

		// Register initial models
		pi.registerProvider(PROVIDER_FIREWORKS, {
			baseUrl: BASE_URL_FIREWORKS,
			apiKey: "FIREWORKS_API_KEY",
			api: "openai-completions" as const,
			headers: {
				"User-Agent": "pi-free-providers",
			},
			models: enhanceWithCI(allModels),
		});

		_logger.info(`Registered ${allModels.length} models from Fireworks AI`);
	} catch (error) {
		_logger.error("Failed to initialize Fireworks provider", {
			error: error instanceof Error ? error.message : String(error),
		});
	}
}
