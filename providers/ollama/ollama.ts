/**
 * Ollama Cloud Provider Extension
 *
 * Provides access to Ollama's cloud-hosted models via ollama.com API.
 * All models use Ollama's usage-based pricing system:
 *   - Free tier: Unlimited public models (session limits reset every 5 hours,
 *     weekly limits reset every 7 days)
 *   - Pro tier: 50x more cloud usage than Free
 *   - Max tier: 5x more usage than Pro
 *
 * Requires OLLAMA_API_KEY with cloud access.
 * Get a free key at: https://ollama.com/settings/keys
 *
 * Responds to global /free toggle (shows models but warns they're freemium).
 *
 * Usage:
 *   pi install git:github.com/apmantza/pi-free
 *   # Set OLLAMA_API_KEY env var
 *   # Models appear in /model selector
 *   # Use /ollama-toggle to show all vs limited set
 */

import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@mariozechner/pi-coding-agent";
import { applyHidden, OLLAMA_API_KEY, OLLAMA_SHOW_PAID } from "../../config.ts";
import {
	BASE_URL_OLLAMA,
	DEFAULT_FETCH_TIMEOUT_MS,
	PROVIDER_OLLAMA,
} from "../../constants.ts";
import { registerWithGlobalToggle } from "../../index.ts";
import { createLogger } from "../../lib/logger.ts";
import { fetchWithRetry } from "../../lib/util.ts";
import { createReRegister, enhanceWithCI } from "../../provider-helper.ts";

const _logger = createLogger("ollama");

// =============================================================================
// Types
// =============================================================================

interface OllamaModel {
	name: string;
	model: string;
	modified_at: string;
	size: number;
	digest: string;
	details?: {
		parent_model?: string;
		format?: string;
		family?: string;
		families?: string[];
		parameter_size?: string;
		quantization_level?: string;
	};
}

interface OllamaTagsResponse {
	models?: OllamaModel[];
}

// =============================================================================
// Fetch + map
// =============================================================================

async function fetchOllamaModels(
	apiKey: string,
): Promise<ProviderModelConfig[]> {
	const response = await fetchWithRetry(
		`${BASE_URL_OLLAMA}/api/tags`,
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
		throw new Error(
			`Failed to fetch Ollama models: ${response.status} ${response.statusText}`,
		);
	}

	const json = (await response.json()) as OllamaTagsResponse;
	const models = json.models ?? [];

	_logger.info(`[ollama] Fetched ${models.length} models from Ollama Cloud`);

	// Filter to chat/text generation models only
	const chatModels = models.filter((m) => {
		// Ollama models don't have explicit capabilities, but we can infer
		// Most models in ollama library are text generation models
		// Skip embedding-only models (typically have "embed" in name)
		const name = m.name.toLowerCase();
		if (name.includes("embed")) return false;
		return true;
	});

	const result = applyHidden(
		chatModels.map(
			(m): ProviderModelConfig => ({
				id: m.name,
				name: m.name,
				// Try to infer reasoning from model name/family
				reasoning:
					m.name.toLowerCase().includes("reasoning") ||
					m.name.toLowerCase().includes("r1") ||
					!!m.details?.families?.some((f) =>
						f.toLowerCase().includes("reasoning"),
					),
				input: ["text"],
				// Ollama Cloud uses usage-based pricing (GPU time), not per-token
				// Free tier has limits but no direct cost per token
				cost: {
					input: 0, // Freemium: usage-based, not per-token
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
				},
				// Extract context window from parameter size if available
				contextWindow: parseContextWindow(m.details?.parameter_size),
				maxTokens: 4096, // Default, varies by model
			}),
		),
	);

	return result;
}

/**
 * Parse parameter size string (e.g., "7B", "70B") to estimate context window
 */
function parseContextWindow(paramSize?: string): number {
	if (!paramSize) return 8192;

	const match = paramSize.match(/(\d+(?:\.\d+)?)\s*([KMGT]?)/i);
	if (!match) return 8192;

	const size = parseFloat(match[1]);
	const unit = match[2].toUpperCase();

	// Rough heuristic: larger models tend to have larger context windows
	// This is a simplification - actual context varies by model architecture
	if (unit === "T" || size >= 100) return 128000; // 100B+ models
	if (size >= 70) return 128000; // 70B models
	if (size >= 30) return 32768; // 30B+ models
	if (size >= 7) return 32768; // 7B+ models
	return 8192; // Smaller models
}

// =============================================================================
// Extension Entry Point
// =============================================================================

export default async function (pi: ExtensionAPI) {
	const apiKey = OLLAMA_API_KEY;

	if (!apiKey) {
		_logger.info(
			"[ollama] Skipping - OLLAMA_API_KEY not set (env var or ~/.pi/free.json)",
		);
		return;
	}

	// Inject into process.env so Pi's apiKey lookup finds it
	process.env.OLLAMA_API_KEY = apiKey;

	// Fetch models
	let allModels: ProviderModelConfig[] = [];

	try {
		allModels = await fetchOllamaModels(apiKey);
	} catch (error) {
		_logger.error("[ollama] Failed to fetch models at startup", {
			error: error instanceof Error ? error.message : String(error),
		});
		return;
	}

	// For Ollama, all models share the same free tier
	// So "free" and "all" are the same set
	const freeModels = allModels;
	const stored = { free: freeModels, all: allModels };
	const hasKey = true;

	// Create re-register function
	const reRegister = createReRegister(pi, {
		providerId: PROVIDER_OLLAMA,
		baseUrl: BASE_URL_OLLAMA,
		apiKey: "OLLAMA_API_KEY",
	});

	// Register with global toggle system
	registerWithGlobalToggle(PROVIDER_OLLAMA, stored, reRegister, hasKey);

	// Register initial models
	const initialModels = OLLAMA_SHOW_PAID ? allModels : freeModels;
	pi.registerProvider(PROVIDER_OLLAMA, {
		baseUrl: BASE_URL_OLLAMA,
		apiKey: "OLLAMA_API_KEY",
		api: "openai-completions" as const,
		models: enhanceWithCI(initialModels),
	});

	_logger.info(
		`[ollama] Registered ${initialModels.length} models (usage-based free tier)`,
	);
}
