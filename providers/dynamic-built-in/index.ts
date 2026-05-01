/**
 * Dynamic Built-in Provider Fetcher
 *
 * Fetches models dynamically from Pi's built-in providers
 * when the user has configured an API key.
 *
 * Providers handled:
 * - mistral (MISTRAL_API_KEY)
 * - groq (GROQ_API_KEY)
 * - cerebras (CEREBRAS_API_KEY)
 * - xai (XAI_API_KEY)
 * - huggingface (HF_TOKEN - optional)
 *
 * OpenAI is intentionally skipped per user request.
 */

import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@mariozechner/pi-coding-agent";
import {
	getCerebrasApiKey,
	getGroqApiKey,
	getHfToken,
	getMistralApiKey,
	getXaiApiKey,
} from "../../config.ts";
import { DEFAULT_FETCH_TIMEOUT_MS } from "../../constants.ts";
import { createLogger } from "../../lib/logger.ts";
import { isFreeModel, registerWithGlobalToggle } from "../../lib/registry.ts";
import { createToggleState } from "../../lib/toggle-state.ts";
import { fetchWithRetry } from "../../lib/util.ts";
import { enhanceWithCI } from "../../provider-helper.ts";

const _logger = createLogger("dynamic-built-in");

// =============================================================================
// Provider Configurations
// =============================================================================

interface DynamicProviderConfig {
	providerId: string;
	getApiKey: () => string | undefined;
	baseUrl: string;
	api: "openai-completions" | "mistral-conversations" | "anthropic-messages";
	fetchModels: (apiKey: string) => Promise<ProviderModelConfig[]>;
	defaultShowPaid: boolean;
}

// =============================================================================
// Fetch Functions for Each Provider
// =============================================================================

async function fetchMistralModels(
	apiKey: string,
): Promise<ProviderModelConfig[]> {
	const response = await fetchWithRetry(
		"https://api.mistral.ai/v1/models",
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
		throw new Error(`Mistral API error: ${response.status}`);
	}

	const json = (await response.json()) as {
		data?: Array<{
			id: string;
			name?: string;
			capabilities?: {
				completion_chat?: boolean;
				completion_fim?: boolean;
				function_calling?: boolean;
				vision?: boolean;
			};
			max_context_length?: number;
		}>;
	};

	const models = json.data ?? [];
	_logger.info(`[dynamic] Fetched ${models.length} models from Mistral`);

	return models
		.filter((m) => m.capabilities?.completion_chat) // Only chat models
		.map(
			(m): ProviderModelConfig => ({
				id: m.id,
				name: m.name || m.id,
				reasoning: false, // Mistral doesn't expose this
				input: m.capabilities?.vision ? ["text", "image"] : ["text"],
				cost: {
					// Mistral pricing not exposed via API, use defaults
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
				},
				contextWindow: m.max_context_length ?? 32768,
				maxTokens: m.max_context_length
					? Math.floor(m.max_context_length / 2)
					: 4096,
			}),
		);
}

async function fetchGroqModels(apiKey: string): Promise<ProviderModelConfig[]> {
	const response = await fetchWithRetry(
		"https://api.groq.com/openai/v1/models",
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
		throw new Error(`Groq API error: ${response.status}`);
	}

	const json = (await response.json()) as {
		data?: Array<{
			id: string;
			object: string;
			owned_by?: string;
			context_window?: number;
		}>;
	};

	const models = json.data?.filter((m) => m.object === "model") ?? [];
	_logger.info(`[dynamic] Fetched ${models.length} models from Groq`);

	return models.map(
		(m): ProviderModelConfig => ({
			id: m.id,
			name: m.id
				.split("-")
				.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
				.join(" "),
			reasoning: false,
			input: ["text"], // Groq models are text-only
			cost: {
				// Groq pricing not exposed via API
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
			},
			contextWindow: m.context_window ?? 8192,
			maxTokens: m.context_window ? Math.floor(m.context_window / 2) : 4096,
		}),
	);
}

async function fetchCerebrasModels(
	apiKey: string,
): Promise<ProviderModelConfig[]> {
	// Cerebras has limited model list, fetch from their API
	const response = await fetchWithRetry(
		"https://api.cerebras.ai/v1/models",
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
		throw new Error(`Cerebras API error: ${response.status}`);
	}

	const json = (await response.json()) as {
		data?: Array<{
			model?: string;
			model_type?: string;
			max_context_length?: number;
		}>;
	};

	const models = json.data ?? [];
	_logger.info(`[dynamic] Fetched ${models.length} models from Cerebras`);

	return models.map(
		(m): ProviderModelConfig => ({
			id: m.model || "unknown",
			name: m.model || "Unknown",
			reasoning: false,
			input: ["text"],
			cost: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
			},
			contextWindow: m.max_context_length ?? 8192,
			maxTokens: m.max_context_length
				? Math.floor(m.max_context_length / 2)
				: 4096,
		}),
	);
}

async function fetchXAIModels(apiKey: string): Promise<ProviderModelConfig[]> {
	const response = await fetchWithRetry(
		"https://api.x.ai/v1/models",
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
		throw new Error(`xAI API error: ${response.status}`);
	}

	const json = (await response.json()) as {
		data?: Array<{
			id: string;
			model?: string;
			input_modalities?: string[];
		}>;
	};

	const models = json.data ?? [];
	_logger.info(`[dynamic] Fetched ${models.length} models from xAI`);

	return models.map(
		(m): ProviderModelConfig => ({
			id: m.id,
			name: m.model || m.id,
			reasoning: false,
			input: m.input_modalities?.includes("image")
				? ["text", "image"]
				: ["text"],
			cost: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
			},
			contextWindow: 128000, // xAI default
			maxTokens: 4096,
		}),
	);
}

async function fetchHuggingFaceModels(
	apiKey?: string,
): Promise<ProviderModelConfig[]> {
	// Hugging Face has a public model list, no auth required for listing
	// But with auth we get better rate limits
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};
	if (apiKey) {
		headers.Authorization = `Bearer ${apiKey}`;
	}

	// Hugging Face inference API models endpoint
	const response = await fetchWithRetry(
		"https://api-inference.huggingface.co/models?pipeline_tag=text-generation&limit=100",
		{ headers },
		3,
		1000,
		DEFAULT_FETCH_TIMEOUT_MS,
	);

	if (!response.ok) {
		throw new Error(`Hugging Face API error: ${response.status}`);
	}

	const json = (await response.json()) as Array<{
		id: string;
		modelId?: string;
	}>;

	const models = Array.isArray(json) ? json.slice(0, 50) : []; // Limit to 50
	_logger.info(`[dynamic] Fetched ${models.length} models from Hugging Face`);

	return models.map(
		(m): ProviderModelConfig => ({
			id: m.id || m.modelId || "unknown",
			name: (m.id || m.modelId || "unknown").split("/").pop() || "Unknown",
			reasoning: false,
			input: ["text"],
			cost: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
			},
			contextWindow: 4096,
			maxTokens: 2048,
		}),
	);
}

// =============================================================================
// Provider Configurations Map
// =============================================================================

const DYNAMIC_PROVIDERS: Omit<DynamicProviderConfig, "fetchModels">[] = [
	{
		providerId: "mistral",
		getApiKey: getMistralApiKey,
		baseUrl: "https://api.mistral.ai/v1",
		api: "openai-completions",
		defaultShowPaid: false,
	},
	{
		providerId: "groq",
		getApiKey: getGroqApiKey,
		baseUrl: "https://api.groq.com/openai/v1",
		api: "openai-completions",
		defaultShowPaid: false,
	},
	{
		providerId: "cerebras",
		getApiKey: getCerebrasApiKey,
		baseUrl: "https://api.cerebras.ai/v1",
		api: "openai-completions",
		defaultShowPaid: false,
	},
	{
		providerId: "xai",
		getApiKey: getXaiApiKey,
		baseUrl: "https://api.x.ai/v1",
		api: "openai-completions",
		defaultShowPaid: false,
	},
	{
		providerId: "huggingface",
		getApiKey: getHfToken,
		baseUrl: "https://api-inference.huggingface.co",
		api: "openai-completions",
		defaultShowPaid: false,
	},
];

// Map provider IDs to their fetch functions
const FETCH_FUNCTIONS: Record<
	string,
	(apiKey: string) => Promise<ProviderModelConfig[]>
> = {
	mistral: fetchMistralModels,
	groq: fetchGroqModels,
	cerebras: fetchCerebrasModels,
	xai: fetchXAIModels,
	huggingface: fetchHuggingFaceModels,
};

// =============================================================================
// Main Setup Function
// =============================================================================

export async function setupDynamicBuiltInProviders(
	pi: ExtensionAPI,
): Promise<void> {
	_logger.info("[dynamic] Setting up dynamic built-in providers...");

	for (const config of DYNAMIC_PROVIDERS) {
		const apiKey = config.getApiKey();

		if (!apiKey) {
			_logger.info(
				`[dynamic] Skipping ${config.providerId} - no API key configured`,
			);
			continue;
		}

		try {
			_logger.info(`[dynamic] Fetching models for ${config.providerId}...`);

			// Fetch models
			const allModels = await FETCH_FUNCTIONS[config.providerId](apiKey);
			const freeModels = allModels.filter((m) =>
				isFreeModel({ ...m, provider: config.providerId }, allModels),
			);

			_logger.info(
				`[dynamic] ${config.providerId}: ${allModels.length} total, ${freeModels.length} free`,
			);

			// Create re-register function for global toggle
			const reRegister = (models: ProviderModelConfig[]) => {
				pi.registerProvider(config.providerId, {
					baseUrl: config.baseUrl,
					apiKey,
					api: config.api,
					models: enhanceWithCI(models, config.providerId),
				});
			};

			// Create per-provider toggle state
			const toggleState = createToggleState({
				providerId: config.providerId,
				initialShowPaid: config.defaultShowPaid,
				initialModels: { free: freeModels, all: allModels },
			});

			// Register toggle command for this provider
			pi.registerCommand(`toggle-${config.providerId}`, {
				description: `Toggle between free and all ${config.providerId} models`,
				handler: async (_args, ctx) => {
					const applied = toggleState.toggle(reRegister);
					if (applied.mode === "all") {
						ctx.ui.notify(
							`${config.providerId}: showing all ${allModels.length} models`,
							"info",
						);
					} else {
						ctx.ui.notify(
							`${config.providerId}: showing ${freeModels.length} free models`,
							"info",
						);
					}
				},
			});

			// Register with global toggle
			registerWithGlobalToggle(
				config.providerId,
				{ free: freeModels, all: allModels },
				reRegister,
				true, // hasKey
			);

			// Initial registration (respect config state)
			toggleState.applyCurrent(reRegister);

			_logger.info(`[dynamic] ${config.providerId}: registered successfully`);
		} catch (error) {
			_logger.error(
				`[dynamic] Failed to setup ${config.providerId}`,
				error instanceof Error
					? { error: error.message }
					: { error: String(error) },
			);
		}
	}
}
