/**
 * Fireworks AI Provider Extension
 *
 * Provides access to Fireworks AI hosted models via api.fireworks.ai.
 * Uses OpenAI-compatible API - requires FIREWORKS_API_KEY.
 * Get a key at: https://app.fireworks.ai/settings/users/api-keys
 *
 * Fetches all available models dynamically from /v1/models endpoint.
 */

import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@mariozechner/pi-coding-agent";
import { FIREWORKS_API_KEY, PROVIDER_FIREWORKS } from "../../config.ts";
import { BASE_URL_FIREWORKS, DEFAULT_FETCH_TIMEOUT_MS } from "../../constants.ts";
import { enhanceWithCI } from "../../provider-helper.ts";
import { fetchWithRetry } from "../../lib/util.ts";
import { createLogger } from "../../lib/logger.ts";

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
// Model ID to display name mapping
// =============================================================================

/**
 * Extracts a readable name from the Fireworks model ID.
 * e.g., "accounts/fireworks/models/deepseek-v3p2" -> "DeepSeek V3.2"
 * e.g., "accounts/cogito/models/cogito-671b-v2-p1" -> "Cogito 671B v2.1"
 */
function formatModelName(id: string): string {
	// Extract the model name from the path
	const match = id.match(/\/models\/(.+)$/);
	if (!match) return id;

	let name = match[1];

	// Replace hyphens with spaces and clean up version notation
	name = name
		.replace(/-/g, " ")
		.replace(/v(\d+)p(\d+)/gi, "v$1.$2") // v3p2 -> v3.2
		.replace(/(\d+)b/gi, " $1B") // 671b -> 671B
		.replace(/fp\d+/gi, (m) => m.toUpperCase()) // fp8 -> FP8
		.replace(/oss/gi, "OSS");

	// Capitalize first letter of each word
	return name
		.split(" ")
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ");
}

/**
 * Determines if a model supports reasoning based on its ID/name.
 */
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

async function fetchFireworksModels(apiKey: string): Promise<ProviderModelConfig[]> {
	_logger.info("Fetching Fireworks models from API...");

	const response = await fetchWithRetry(
		`${BASE_URL_FIREWORKS}/models`,
		{
			headers: {
				"Authorization": `Bearer ${apiKey}`,
				"User-Agent": "pi-free-providers",
			},
		},
		3, // retries
		1000, // initial delay
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
	const chatModels = json.data?.filter((m) => m.supports_chat) ?? [];
	_logger.info(`Found ${chatModels.length} chat-capable models`);

	return chatModels.map((model): ProviderModelConfig => {
		const hasVision = model.supports_image_input;

		return {
			id: model.id,
			name: formatModelName(model.id),
			reasoning: supportsReasoning(model.id),
			input: hasVision ? ["text", "image"] : ["text"],
			// Fireworks uses their own credit system - costs are handled via their dashboard
			// We use placeholder values here; actual billing is credit-based
			cost: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
			},
			contextWindow: model.context_length ?? 32768,
			// Estimate max tokens as half of context window or 8192, whichever is smaller
			maxTokens: Math.min(Math.floor((model.context_length ?? 32768) / 2), 8192),
		};
	});
}

// =============================================================================
// Extension Entry Point
// =============================================================================

export default async function (pi: ExtensionAPI): Promise<void> {
	// Skip if no API key configured
	if (!FIREWORKS_API_KEY) {
		_logger.info("No API key found — set FIREWORKS_API_KEY to enable");
		return;
	}

	// Inject key into env for Pi's lookup
	process.env.FIREWORKS_API_KEY = FIREWORKS_API_KEY;

	try {
		// Fetch models dynamically from Fireworks API
		const models = await fetchFireworksModels(FIREWORKS_API_KEY);

		if (models.length === 0) {
			_logger.warn("No chat-capable models found from Fireworks API");
			return;
		}

		// Register provider with fetched models
		pi.registerProvider(PROVIDER_FIREWORKS, {
			baseUrl: BASE_URL_FIREWORKS,
			apiKey: "FIREWORKS_API_KEY",
			api: "openai-completions" as const,
			headers: {
				"User-Agent": "pi-free-providers",
			},
			models: enhanceWithCI(models),
		});

		_logger.info(`Registered ${models.length} models from Fireworks AI`);

		// Log available model categories for debugging
		const visionModels = models.filter((m) => m.input?.includes("image"));
		const reasoningModels = models.filter((m) => m.reasoning);
		_logger.info(`Models breakdown: ${visionModels.length} vision, ${reasoningModels.length} reasoning`);
	} catch (error) {
		_logger.error("Failed to initialize Fireworks provider", {
			error: error instanceof Error ? error.message : String(error),
		});
		// Don't throw - allow other providers to load
	}
}
