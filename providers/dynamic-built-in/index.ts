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
import { OPENROUTER_SHOW_PAID, saveConfig } from "../../config.ts";
import {
	BASE_URL_OPENROUTER,
	DEFAULT_FETCH_TIMEOUT_MS,
} from "../../constants.ts";
import { isFreeModel, registerWithGlobalToggle } from "../../index.ts";
import { createLogger } from "../../lib/logger.ts";
import { fetchWithRetry } from "../../lib/util.ts";
import { fetchOpenRouterCompatibleModels } from "../model-fetcher.ts";

const _logger = createLogger("dynamic-built-in");

// =============================================================================
// OpenRouter Fetcher
// =============================================================================

async function fetchOpenRouterModels(
	apiKey: string,
): Promise<ProviderModelConfig[]> {
	const models = await fetchOpenRouterCompatibleModels({
		baseUrl: BASE_URL_OPENROUTER,
		apiKey: apiKey || undefined,
		freeOnly: false,
	});
	_logger.info(`[dynamic] Fetched ${models.length} models from OpenRouter`);
	return models;
}

// =============================================================================
// Provider Configurations
// =============================================================================

interface DynamicProviderConfig {
	providerId: string;
	apiKeyEnvVar: string;
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
		apiKeyEnvVar: "MISTRAL_API_KEY",
		baseUrl: "https://api.mistral.ai/v1",
		api: "openai-completions",
		defaultShowPaid: false,
	},
	{
		providerId: "groq",
		apiKeyEnvVar: "GROQ_API_KEY",
		baseUrl: "https://api.groq.com/openai/v1",
		api: "openai-completions",
		defaultShowPaid: false,
	},
	{
		providerId: "cerebras",
		apiKeyEnvVar: "CEREBRAS_API_KEY",
		baseUrl: "https://api.cerebras.ai/v1",
		api: "openai-completions",
		defaultShowPaid: false,
	},
	{
		providerId: "xai",
		apiKeyEnvVar: "XAI_API_KEY",
		baseUrl: "https://api.x.ai/v1",
		api: "openai-completions",
		defaultShowPaid: false,
	},
	{
		providerId: "huggingface",
		apiKeyEnvVar: "HF_TOKEN",
		baseUrl: "https://api-inference.huggingface.co",
		api: "openai-completions",
		defaultShowPaid: false,
	},
	{
		providerId: "openrouter",
		apiKeyEnvVar: "OPENROUTER_API_KEY",
		baseUrl: BASE_URL_OPENROUTER,
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
	openrouter: fetchOpenRouterModels,
};

// Providers that support free/paid toggling (have pricing info in API)
// OpenRouter exposes actual pricing
const TOGGLEABLE_PROVIDERS = new Set(["openrouter"]);

// Map provider IDs to their config show_paid flags
const PROVIDER_CONFIG_FLAGS: Record<string, boolean> = {
	openrouter: OPENROUTER_SHOW_PAID,
};

// =============================================================================
// Main Setup Function
// =============================================================================

export async function setupDynamicBuiltInProviders(
	pi: ExtensionAPI,
): Promise<void> {
	_logger.info("[dynamic] Setting up dynamic built-in providers...");

	for (const config of DYNAMIC_PROVIDERS) {
		const apiKey = process.env[config.apiKeyEnvVar];

		if (!apiKey) {
			_logger.info(
				`[dynamic] Skipping ${config.providerId} - no ${config.apiKeyEnvVar} found`,
			);
			continue;
		}

		try {
			_logger.info(`[dynamic] Fetching models for ${config.providerId}...`);

			// Fetch models
			const allModels = await FETCH_FUNCTIONS[config.providerId](apiKey);
			const freeModels = allModels.filter(isFreeModel);

			_logger.info(
				`[dynamic] ${config.providerId}: ${allModels.length} total, ${freeModels.length} free`,
			);

			// Create re-register function for global toggle
			const reRegister = (models: ProviderModelConfig[]) => {
				pi.registerProvider(config.providerId, {
					baseUrl: config.baseUrl,
					apiKey: config.apiKeyEnvVar,
					api: config.api,
					models,
				});
			};

			// Register with global toggle
			registerWithGlobalToggle(
				config.providerId,
				{ free: freeModels, all: allModels },
				reRegister,
				true, // hasKey
			);

			// Initial registration (default to free)
			const initialModels = config.defaultShowPaid ? allModels : freeModels;
			reRegister(initialModels);

			// Register toggle command only for providers with pricing info
			if (TOGGLEABLE_PROVIDERS.has(config.providerId)) {
				const initialShowPaid =
					PROVIDER_CONFIG_FLAGS[config.providerId] ?? false;
				setupProviderToggle(
					pi,
					config.providerId,
					freeModels,
					allModels,
					reRegister,
					initialShowPaid,
				);
			}

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

// =============================================================================
// Per-Provider Toggle Command
// =============================================================================

function setupProviderToggle(
	pi: ExtensionAPI,
	providerId: string,
	freeModels: ProviderModelConfig[],
	allModels: ProviderModelConfig[],
	reRegister: (models: ProviderModelConfig[]) => void,
	initialShowPaid = false,
): void {
	let showPaid = initialShowPaid;

	pi.registerCommand(`${providerId}-toggle`, {
		description: `Toggle free/paid ${providerId} models`,
		handler: async (_args, ctx) => {
			showPaid = !showPaid;
			const modelsToShow = showPaid ? allModels : freeModels;
			reRegister(modelsToShow);

			// Persist to config for openrouter
			if (providerId === "openrouter") {
				saveConfig({ openrouter_show_paid: showPaid });
			}

			const count = modelsToShow.length;
			const type = showPaid ? "paid" : "free";
			ctx.ui.notify(`${providerId}: ${count} ${type} models`, "info");
		},
	});
}
