/**
 * Ollama Cloud Provider Extension
 *
 * Provides access to Ollama's cloud-hosted models via ollama.com/api.
 * Free tier available with usage limits (resets every 5 hours + 7 days).
 * Requires OLLAMA_API_KEY from https://ollama.com/settings/keys
 *
 * Cloud models are tagged with '-cloud' suffix and include:
 * - gpt-oss (120b, 20b)
 * - qwen3-coder (480b, 32b, etc.)
 * - Gemma 3
 * - DeepSeek-R1
 * - And more
 *
 * Set OLLAMA_SHOW_PAID=true to show cloud models (required since
 * Ollama free tier has usage limits, not unlimited free models).
 */

import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@mariozechner/pi-coding-agent";
import {
	applyHidden,
	OLLAMA_API_KEY as CONFIG_API_KEY,
	OLLAMA_SHOW_PAID,
	PROVIDER_OLLAMA,
} from "../config.ts";
import { BASE_URL_OLLAMA, DEFAULT_FETCH_TIMEOUT_MS } from "../constants.ts";
import { createLogger } from "../lib/logger.ts";
import {
	type StoredModels,
	setupProvider,
	createReRegister,
} from "../provider-helper.ts";
import { fetchWithRetry, logWarning } from "../util.ts";

const _logger = createLogger("ollama");

const OLLAMA_CONFIG = {
	providerId: PROVIDER_OLLAMA,
	baseUrl: BASE_URL_OLLAMA,
	apiKey: "OLLAMA_API_KEY",
};

// Ollama Cloud models - fetched dynamically but cached here
interface OllamaModelTag {
	name: string;
	model: string;
	modified_at?: string;
	size?: number;
	digest?: string;
	details?: {
		format?: string;
		family?: string;
		families?: string[];
		parameter_size?: string;
		quantization_level?: string;
	};
}

// =============================================================================
// Fetch + map
// =============================================================================

async function fetchOllamaModels(): Promise<ProviderModelConfig[]> {
	if (!OLLAMA_SHOW_PAID) return [];

	const apiKey = CONFIG_API_KEY;
	if (!apiKey) {
		_logger.warn("No OLLAMA_API_KEY found");
		return [];
	}

	try {
		const response = await fetchWithRetry(
			`${BASE_URL_OLLAMA}/models`,
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
				`Failed to fetch Ollama models: ${response.status} ${response.statusText}`,
			);
		}

		const json = (await response.json()) as {
			data?: Array<{
				id: string;
				object?: string;
				created?: number;
				owned_by?: string;
			}>;
		};
		const models = json.data ?? [];

		// All models from ollama.com/v1 are cloud-hosted
		// Filter out very small models (< 30B parameters) to keep list focused
		return applyHidden(
			models
				.filter((m) => {
					// Try to extract parameter size from name (e.g., "qwen3:8b", "kimi-k2:1t")
					const sizeMatch = m.id.match(/:(\d+)([bmt])/i);
					if (sizeMatch) {
						const size = parseInt(sizeMatch[1], 10);
						const unit = sizeMatch[2].toLowerCase();
						// Filter out < 30B models (for 'b' unit)
						if (unit === 'b' && size < 30) return false;
					}
					return true;
				})
				.map(mapOllamaModel),
		);
	} catch (error) {
		logWarning("ollama", "Failed to fetch models", error);
		return [];
	}
}

function mapOllamaModel(m: {
	id: string;
	object?: string;
	created?: number;
	owned_by?: string;
}): ProviderModelConfig {
	// Extract context window from parameter size or default to 128k
	let contextWindow = 131072; // Default 128k

	// Larger models often have bigger context windows
	const sizeMatch = m.id.match(/:(\d+)([bmt])/i);
	if (sizeMatch) {
		const size = parseInt(sizeMatch[1], 10);
		const unit = sizeMatch[2].toLowerCase();
		if (unit === "b" && size >= 100) {
			contextWindow = 200000; // 200k for large models
		}
	}

	// Clean up the name (convert colons and dashes to spaces for display)
	const displayName = m.id
		.replace(/:/g, " ")
		.replace(/-/g, " ")
		.split(" ")
		.filter((w) => w.length > 0)
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(" ");

	return {
		id: m.id,
		name: displayName,
		reasoning: m.id.includes("deepseek") || m.id.includes("r1"),
		input: ["text"], // Ollama cloud models are text-only for now
		cost: {
			// Ollama uses GPU-time based pricing, not per-token
			// Mark as 0 since actual cost depends on usage plan
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
		},
		contextWindow,
		maxTokens: Math.min(contextWindow / 2, 131072), // Conservative default
	};
}

// =============================================================================
// Extension Entry Point
// =============================================================================

export default async function (pi: ExtensionAPI) {
	const apiKey = CONFIG_API_KEY;

	// Inject into process.env so Pi's apiKey lookup finds it even when loaded from ~/.pi/free.json.
	if (apiKey) process.env.OLLAMA_API_KEY = apiKey;

	if (!apiKey) {
		_logger.warn(
			"No API key found — set OLLAMA_API_KEY or add ollama_api_key to ~/.pi/free.json. Get a key at https://ollama.com/settings/keys",
		);
		return;
	}

	// Skip if SHOW_PAID is not enabled
	if (!OLLAMA_SHOW_PAID) {
		_logger.info(
			"Ollama cloud models disabled. Set OLLAMA_SHOW_PAID=true or ollama_show_paid: true in ~/.pi/free.json to enable.",
		);
		return;
	}

	let models: ProviderModelConfig[] = [];
	try {
		models = await fetchOllamaModels();
	} catch (error) {
		logWarning("ollama", "Failed to fetch models", error);
	}

	if (models.length === 0) {
		_logger.warn(
			"No Ollama cloud models available. This may be due to API issues or no models being available.",
		);
		return;
	}

	// Shared model storage (single set — Ollama has no free/all split)
	const stored: StoredModels = { free: models, all: models };

	pi.registerProvider(PROVIDER_OLLAMA, {
		baseUrl: BASE_URL_OLLAMA,
		apiKey: "OLLAMA_API_KEY",
		api: "openai-completions" as const,
		headers: {
			"User-Agent": "pi-free-providers",
		},
		models,
	});

	// Wire up shared boilerplate (commands, model_select, turn_end)
	const reRegister = createReRegister(pi, OLLAMA_CONFIG);
	setupProvider(
		pi,
		{
			providerId: PROVIDER_OLLAMA,
			reRegister: (m) => {
				stored.free = m;
				stored.all = m;
				reRegister(m);
			},
		},
		stored,
	);
}
