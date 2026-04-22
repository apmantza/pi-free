/**
 * Cloudflare Workers AI Provider Extension
 *
 * Provides access to Cloudflare's serverless GPU network with 18+ models.
 * All models use Cloudflare's "Neurons" pricing system:
 *   - 10,000 Neurons per day FREE (resets daily at 00:00 UTC)
 *   - $0.011 per 1,000 Neurons beyond free allocation
 *
 * Setup:
 *   1. Create API token at https://dash.cloudflare.com/profile/api-tokens
 *      with "Cloudflare AI" > "Read" permission
 *   2. Get Account ID from https://dash.cloudflare.com (right sidebar)
 *   3. Add credentials to ~/.pi/agent/auth.json or set env vars
 *
 * Auth (in order of priority):
 *   - Environment: CF_API_TOKEN and CF_ACCOUNT_ID
 *   - Config file: ~/.pi/agent/auth.json
 *     { "cloudflare-ai": { "access": "token", "account_id": "id" } }
 *   - Legacy: CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID env vars
 *
 * Models can be customized via ~/.pi/cloudflare-models.json
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@mariozechner/pi-coding-agent";
import { createLogger } from "../../lib/logger.ts";

const _logger = createLogger("cloudflare");

// =============================================================================
// Auth Resolution
// =============================================================================

interface CloudflareAuth {
	token?: string;
	accountId?: string;
}

function getCloudflareAuth(): CloudflareAuth {
	const result: CloudflareAuth = {};

	// Check new env var names first
	if (process.env.CF_API_TOKEN) result.token = process.env.CF_API_TOKEN;
	if (process.env.CF_ACCOUNT_ID) result.accountId = process.env.CF_ACCOUNT_ID;

	// Check legacy env var names
	if (!result.token && process.env.CLOUDFLARE_API_TOKEN) {
		result.token = process.env.CLOUDFLARE_API_TOKEN;
	}
	if (!result.accountId && process.env.CLOUDFLARE_ACCOUNT_ID) {
		result.accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
	}

	if (result.token && result.accountId) return result;

	// Check ~/.pi/free.json (pi-free config)
	try {
		const configPath = join(homedir(), ".pi", "free.json");
		if (existsSync(configPath)) {
			const config = JSON.parse(readFileSync(configPath, "utf-8"));
			if (!result.token && config.cloudflare_api_token) {
				result.token = config.cloudflare_api_token;
			}
			if (!result.accountId && config.cloudflare_account_id) {
				result.accountId = config.cloudflare_account_id;
			}
		}
	} catch {
		// Ignore config file errors
	}

	return result;
}

// =============================================================================
// Compatibility Settings
// =============================================================================

/**
 * Cloudflare Workers AI compatibility settings.
 * Prevents 413 Payload Too Large errors by disabling unsupported parameters.
 */
const CLOUDFLARE_COMPAT: {
	supportsStore?: boolean;
	supportsDeveloperRole?: boolean;
	supportsReasoningEffort?: boolean;
	supportsStrictMode?: boolean;
	maxTokensField?: "max_tokens" | "max_completion_tokens";
	requiresThinkingAsText?: boolean;
} = {
	supportsStore: false,
	supportsDeveloperRole: false,
	supportsReasoningEffort: false,
	supportsStrictMode: false,
	maxTokensField: "max_tokens",
};

// =============================================================================
// Default Models (18 models from Cloudflare Workers AI)
// =============================================================================

interface ModelConfig extends ProviderModelConfig {
	compat?: { requiresThinkingAsText?: boolean };
	_remove?: boolean;
}

const DEFAULT_MODELS: ModelConfig[] = [
	// Frontier models
	{
		id: "@cf/moonshotai/kimi-k2.5",
		name: "Kimi K2.5",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 0.6, output: 3.0, cacheRead: 0.1, cacheWrite: 0 },
		contextWindow: 256000,
		maxTokens: 8192,
	},
	{
		id: "@cf/meta/llama-4-scout-17b-16e-instruct",
		name: "Llama 4 Scout 17B",
		reasoning: false,
		input: ["text", "image"],
		cost: { input: 0.27, output: 0.85, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 131072,
		maxTokens: 8192,
	},
	{
		id: "@cf/nvidia/nemotron-3-120b-a12b",
		name: "Nemotron 3 Super 120B",
		reasoning: true,
		input: ["text"],
		cost: { input: 0.5, output: 1.5, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 256000,
		maxTokens: 8192,
		compat: { requiresThinkingAsText: true },
	},
	{
		id: "@cf/google/gemma-4-26b-a4b-it",
		name: "Gemma 4 26B",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 0.1, output: 0.3, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 256000,
		maxTokens: 8192,
		compat: { requiresThinkingAsText: true },
	},
	{
		id: "@cf/google/gemma-3-12b-it",
		name: "Gemma 3 12B",
		reasoning: false,
		input: ["text", "image"],
		cost: { input: 0.345, output: 0.556, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 80000,
		maxTokens: 8192,
	},
	{
		id: "@cf/qwen/qwen3-30b-a3b-fp8",
		name: "Qwen3 30B A3B",
		reasoning: true,
		input: ["text"],
		cost: { input: 0.051, output: 0.34, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 32768,
		maxTokens: 8192,
		compat: { requiresThinkingAsText: true },
	},
	{
		id: "@cf/zai-org/glm-4.7-flash",
		name: "GLM-4.7 Flash",
		reasoning: false,
		input: ["text"],
		cost: { input: 0.06, output: 0.4, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 131072,
		maxTokens: 8192,
	},
	// Popular models
	{
		id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
		name: "Llama 3.3 70B (Fast)",
		reasoning: false,
		input: ["text"],
		cost: { input: 0.5, output: 0.5, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 131072,
		maxTokens: 8192,
	},
	{
		id: "@cf/meta/llama-3.1-8b-instruct",
		name: "Llama 3.1 8B",
		reasoning: false,
		input: ["text"],
		cost: { input: 0.1, output: 0.1, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 131072,
		maxTokens: 8192,
	},
	{
		id: "@cf/meta/llama-3.1-70b-instruct",
		name: "Llama 3.1 70B",
		reasoning: false,
		input: ["text"],
		cost: { input: 0.5, output: 0.5, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 131072,
		maxTokens: 8192,
	},
	{
		id: "@cf/meta/llama-3.1-405b-instruct",
		name: "Llama 3.1 405B",
		reasoning: false,
		input: ["text"],
		cost: { input: 2.0, output: 2.0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 131072,
		maxTokens: 8192,
	},
	{
		id: "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
		name: "DeepSeek R1 Distill Qwen 32B",
		reasoning: true,
		input: ["text"],
		cost: { input: 0.3, output: 0.3, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 32768,
		maxTokens: 8192,
		compat: { requiresThinkingAsText: true },
	},
	{
		id: "@cf/deepseek-ai/deepseek-math-7b-instruct",
		name: "DeepSeek Math 7B",
		reasoning: true,
		input: ["text"],
		cost: { input: 0.1, output: 0.1, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 16384,
		maxTokens: 4096,
	},
	// Mistral models
	{
		id: "@cf/mistral/mistral-small-3.1-24b-instruct",
		name: "Mistral Small 3.1 24B",
		reasoning: false,
		input: ["text", "image"],
		cost: { input: 0.3, output: 0.3, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 32768,
		maxTokens: 8192,
	},
	{
		id: "@cf/mistral/mistral-7b-instruct-v0.2-lora",
		name: "Mistral 7B Instruct",
		reasoning: false,
		input: ["text"],
		cost: { input: 0.1, output: 0.1, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 32768,
		maxTokens: 4096,
	},
	{
		id: "@cf/mistral/mixtral-8x7b-instruct-v0.1-awq",
		name: "Mixtral 8x7B Instruct",
		reasoning: false,
		input: ["text"],
		cost: { input: 0.3, output: 0.3, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 32768,
		maxTokens: 4096,
	},
	// Qwen and Gemma
	{
		id: "@cf/qwen/qwen1.5-14b-chat-awq",
		name: "Qwen 1.5 14B Chat",
		reasoning: false,
		input: ["text"],
		cost: { input: 0.2, output: 0.2, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 32768,
		maxTokens: 8192,
	},
	{
		id: "@cf/google/gemma-2b-it-lora",
		name: "Gemma 2B",
		reasoning: false,
		input: ["text"],
		cost: { input: 0.05, output: 0.05, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 8192,
		maxTokens: 2048,
	},
	{
		id: "@cf/google/gemma-7b-it-lora",
		name: "Gemma 7B",
		reasoning: false,
		input: ["text"],
		cost: { input: 0.1, output: 0.1, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 8192,
		maxTokens: 2048,
	},
];

// =============================================================================
// Model Customization (user overrides)
// =============================================================================

function getModels(): ProviderModelConfig[] {
	// Apply Cloudflare compat settings to all default models
	const defaults = DEFAULT_MODELS.map((m) => ({
		...m,
		compat: { ...CLOUDFLARE_COMPAT, ...m.compat },
	})) as ProviderModelConfig[];

	// Check for user overrides
	const overridePath = join(homedir(), ".pi", "cloudflare-models.json");
	if (!existsSync(overridePath)) return defaults;

	try {
		const override = JSON.parse(
			readFileSync(overridePath, "utf-8"),
		) as ModelConfig[];
		const modelMap = new Map<string, any>(defaults.map((m) => [m.id, m]));

		for (const model of override) {
			if (model._remove) {
				modelMap.delete(model.id);
			} else {
				// Apply Cloudflare compat settings to user overrides
				model.compat = { ...CLOUDFLARE_COMPAT, ...model.compat };
				modelMap.set(model.id, model);
			}
		}

		return Array.from(modelMap.values()) as ProviderModelConfig[];
	} catch (e) {
		_logger.warn(
			`[cloudflare] Failed to load ~/.pi/cloudflare-models.json: ${e instanceof Error ? e.message : String(e)}`,
		);
		return defaults;
	}
}

// =============================================================================
// Extension Entry Point
// =============================================================================

export default async function cloudflareProvider(pi: ExtensionAPI) {
	const { token: apiToken, accountId } = getCloudflareAuth();

	if (!apiToken) {
		_logger.info(
			"[cloudflare] CF_API_TOKEN or CLOUDFLARE_API_TOKEN not set. Provider will not be available.",
		);
		return;
	}

	if (!accountId) {
		_logger.info(
			"[cloudflare] CF_ACCOUNT_ID or CLOUDFLARE_ACCOUNT_ID not set. Provider will not be available.",
		);
		return;
	}

	// Also inject into process.env for pi's API key lookup
	process.env.CLOUDFLARE_API_TOKEN = apiToken;

	const models = getModels();

	pi.registerProvider("cloudflare", {
		baseUrl: `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`,
		apiKey: "CLOUDFLARE_API_TOKEN",
		api: "openai-completions",
		authHeader: true,
		models,
	});

	_logger.info(
		`[cloudflare] Provider registered with account: ${accountId.slice(0, 8)}... (${models.length} models)`,
	);
}
