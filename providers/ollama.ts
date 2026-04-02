/**
 * Ollama Cloud Provider Extension
 *
 * Provides access to Ollama's cloud-hosted models via ollama.com/v1.
 * Free tier available with usage limits (resets every 5 hours + 7 days).
 * Requires OLLAMA_API_KEY from https://ollama.com/settings/keys
 *
 * Set OLLAMA_SHOW_PAID=true to enable (required since Ollama has usage limits).
 */

import type { ProviderModelConfig } from "@mariozechner/pi-coding-agent";
import { OLLAMA_API_KEY, PROVIDER_OLLAMA } from "../config.ts";
import { BASE_URL_OLLAMA, DEFAULT_FETCH_TIMEOUT_MS } from "../constants.ts";
import { fetchWithRetry } from "../lib/util.ts";
import { createProvider } from "../provider-factory.ts";

// =============================================================================
// Fetch + map
// =============================================================================

async function fetchOllamaModels(): Promise<ProviderModelConfig[]> {
	const apiKey = OLLAMA_API_KEY;
	if (!apiKey) return [];

	const response = await fetchWithRetry(
		`${BASE_URL_OLLAMA}/models`,
		{
			headers: {
				Authorization: `Bearer ${apiKey}`,
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

	// Filter out small models (< 30B) to keep list focused
	return models
		.filter((m) => {
			const sizeMatch = m.id.match(/:(\d+)([bmt])/i);
			if (sizeMatch) {
				const size = parseInt(sizeMatch[1], 10);
				const unit = sizeMatch[2].toLowerCase();
				if (unit === "b" && size < 30) return false;
			}
			return true;
		})
		.map(mapOllamaModel);
}

function mapOllamaModel(m: { id: string }): ProviderModelConfig {
	// Extract context window from parameter size
	let contextWindow = 131072; // Default 128k
	const sizeMatch = m.id.match(/:(\d+)([bmt])/i);
	if (sizeMatch) {
		const size = parseInt(sizeMatch[1], 10);
		const unit = sizeMatch[2].toLowerCase();
		if (unit === "b" && size >= 100) {
			contextWindow = 200000;
		}
	}

	// Clean up name for display
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
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow,
		maxTokens: Math.min(contextWindow / 2, 131072),
	};
}

// =============================================================================
// Extension Entry Point
// =============================================================================

export default function (pi: Parameters<typeof createProvider>[0]) {
	return createProvider(pi, {
		providerId: PROVIDER_OLLAMA,
		baseUrl: BASE_URL_OLLAMA,
		apiKeyEnvVar: "OLLAMA_API_KEY",
		apiKeyConfigKey: "ollama_api_key",
		showPaidFlag: "OLLAMA_SHOW_PAID",
		fetchModels: fetchOllamaModels,
	});
}
