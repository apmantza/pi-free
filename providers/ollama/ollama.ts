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
 * Responds to global free-only filter (shows models but warns they're freemium).
 *
 * Usage:
 *   pi install git:github.com/apmantza/pi-free
 *   # Set OLLAMA_API_KEY env var
 *   # Models appear in /model selector
 *   # Use /toggle-ollama to show all vs limited set
 */

import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@mariozechner/pi-coding-agent";
import {
	applyHidden,
	getOllamaApiKey,
	getOllamaShowPaid,
	loadConfigFile,
	saveConfig,
} from "../../config.ts";
import {
	BASE_URL_OLLAMA,
	DEFAULT_FETCH_TIMEOUT_MS,
	PROVIDER_OLLAMA,
} from "../../constants.ts";
import { createLogger } from "../../lib/logger.ts";
import { registerWithGlobalToggle } from "../../lib/registry.ts";
import { fetchWithRetry } from "../../lib/util.ts";
import { createReRegister, enhanceWithCI } from "../../provider-helper.ts";

const _logger = createLogger("ollama-cloud");

// =============================================================================
// Known 403 models (listed but return "access denied" on /v1/chat/completions)
// These are models that appear in /v1/models but aren't provisioned for chat.
// Add new IDs here as they surface via /probe-ollama command.
// =============================================================================
const OLLAMA_KNOWN_403_MODELS: ReadonlySet<string> = new Set([
	// Example entries - populate via probe-ollama.mjs
	// "model-id-that-403s",
]);

// =============================================================================
// Fetch + map
// =============================================================================

async function fetchOllamaModels(
	apiKey: string,
): Promise<ProviderModelConfig[]> {
	// Use OpenAI-compatible /v1/models endpoint for consistency
	// The native /api/tags returns :cloud suffixes that may not work with /v1/chat/completions
	const response = await fetchWithRetry(
		`${BASE_URL_OLLAMA}/models`,
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

	const json = (await response.json()) as {
		data?: Array<{ id: string; owned_by?: string }>;
	};
	const models = json.data ?? [];

	_logger.info(
		`[ollama-cloud] Fetched ${models.length} models from Ollama Cloud`,
	);

	// Filter to chat/text generation models only
	const chatModels = models
		.filter((m) => {
			// Skip embedding-only models (typically have "embed" in name)
			const name = m.id.toLowerCase();
			if (name.includes("embed")) return false;
			return true;
		})
		// Filter out known 403 models (listed but not provisioned for chat)
		.filter((m) => {
			if (OLLAMA_KNOWN_403_MODELS.has(m.id)) {
				return false;
			}
			return true;
		});

	const result = applyHidden(
		chatModels.map(
			(m): ProviderModelConfig => ({
				id: m.id,
				name: m.id,
				// Try to infer reasoning from model name
				reasoning:
					m.id.toLowerCase().includes("reasoning") ||
					m.id.toLowerCase().includes("r1") ||
					m.id.toLowerCase().includes("thinking"),
				input: ["text"],
				// Ollama Cloud uses usage-based pricing (GPU time), not per-token
				// Free tier has limits but no direct cost per token
				cost: {
					input: 0, // Freemium: usage-based, not per-token
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
				},
				// Default context window - Ollama doesn't expose this via /v1/models
				contextWindow: 32768,
				maxTokens: 4096, // Default, varies by model
			}),
		),
	);

	return result;
}

// =============================================================================
// Extension Entry Point
// =============================================================================

export default async function (pi: ExtensionAPI) {
	const apiKey = getOllamaApiKey();

	if (!apiKey) {
		_logger.info(
			"[ollama-cloud] Skipping - OLLAMA_API_KEY not set (env var or ~/.pi/free.json)",
		);
		return;
	}

	// Fetch models
	let allModels: ProviderModelConfig[] = [];

	try {
		allModels = await fetchOllamaModels(apiKey);
	} catch (error) {
		_logger.error("[ollama-cloud] Failed to fetch models at startup", {
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
		apiKey,
	});

	// Register with global toggle system
	registerWithGlobalToggle(PROVIDER_OLLAMA, stored, reRegister, hasKey);

	// Register initial models
	const initialModels = getOllamaShowPaid() ? allModels : freeModels;
	pi.registerProvider(PROVIDER_OLLAMA, {
		baseUrl: BASE_URL_OLLAMA,
		apiKey,
		api: "openai-completions" as const,
		models: enhanceWithCI(initialModels),
	});

	_logger.info(
		`[ollama-cloud] Registered ${initialModels.length} models (usage-based free tier)`,
	);

	// ── Probe command: test all registered models for 403s ─────────────
	pi.registerCommand("probe-ollama", {
		description: "Test all Ollama Cloud models for 403 'access denied' errors",
		handler: async (_args, ctx) => {
			if (!apiKey) {
				ctx.ui.notify("OLLAMA_API_KEY not set", "error");
				return;
			}

			const modelsToTest = allModels;
			ctx.ui.notify(`Probing ${modelsToTest.length} Ollama models…`, "info");

			const notFound: string[] = [];
			const batchSize = 5;

			for (let i = 0; i < modelsToTest.length; i += batchSize) {
				const batch = modelsToTest.slice(i, i + batchSize);
				const results = await Promise.all(
					batch.map(async (m) => {
						const ok = await probeOllamaModel(apiKey, m.id);
						return { id: m.id, ok };
					}),
				);
				for (const r of results) {
					if (!r.ok) notFound.push(r.id);
				}
			}

			if (notFound.length === 0) {
				ctx.ui.notify("All Ollama models are accessible ✅", "info");
				return;
			}

			// Auto-hide 403 models in config
			const config = loadConfigFile();
			const existingHidden = new Set(config.hidden_models ?? []);
			for (const id of notFound) existingHidden.add(id);
			saveConfig({ hidden_models: Array.from(existingHidden) });

			// Re-register so hidden models disappear immediately
			const filtered = await fetchOllamaModels(apiKey);
			stored.free = filtered;
			stored.all = filtered;
			reRegister(filtered);

			ctx.ui.notify(
				`Found ${notFound.length} broken models (auto-hidden):\n${notFound.join("\n")}`,
				"warning",
			);
		},
	});
}

/**
 * Probe a single Ollama model with a minimal chat request.
 * Returns true if the model is accessible (not 403), false if it 403s.
 */
async function probeOllamaModel(
	apiKey: string,
	modelId: string,
): Promise<boolean> {
	try {
		const response = await fetch(`${BASE_URL_OLLAMA}/chat/completions`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
				"User-Agent": "pi-free-providers",
			},
			body: JSON.stringify({
				model: modelId,
				messages: [{ role: "user", content: "hi" }],
				max_tokens: 1,
			}),
		});
		// 403 = access denied (model not provisioned)
		// 200/400/401/etc = at least accessible
		return response.status !== 403;
	} catch {
		return true; // Network errors are not "access denied"
	}
}
