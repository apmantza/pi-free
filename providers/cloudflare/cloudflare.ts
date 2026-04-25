/**
 * Cloudflare Workers AI Provider Extension
 *
 * Provides access to Cloudflare's serverless GPU network with 30+ models.
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
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@mariozechner/pi-coding-agent";
import { DEFAULT_FETCH_TIMEOUT_MS } from "../../constants.ts";
import { createLogger } from "../../lib/logger.ts";
import { fetchWithRetry } from "../../lib/util.ts";

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

const CLOUDFLARE_COMPAT = {
	supportsStore: false,
	supportsDeveloperRole: false,
	supportsReasoningEffort: false,
	supportsStrictMode: false,
	maxTokensField: "max_tokens" as const,
};

// =============================================================================
// Known non-chat model patterns (to filter out)
// =============================================================================

const NON_CHAT_PATTERNS = [
	// Embeddings
	/bge-/i,
	/embed/i,
	/embedding/i,
	/pfnet\/plamo-embedding/i,
	/qwen3-embedding/i,
	// Image generation
	/flux/i,
	/stable-diffusion/i,
	/dreamshaper/i,
	/lucid-origin/i,
	/phoenix/i,
	// Speech/audio
	/whisper/i,
	/aura-/i,
	/nova-/i,
	/melotts/i,
	// Translation (not chat)
	/indictrans/i,
	/m2m100/i,
	// Vision-only models
	/llava/i,
	/detr-/i,
	/resnet/i,
	/unum\/uform/i,
	// Code/SQL only
	/sqlcoder/i,
	// Classification/reranking
	/reranker/i,
	/distilbert/i,
	// Safety/moderation
	/llama-guard/i,
	// Turn detection
	/smart-turn/i,
];

// =============================================================================
// Fallback models (used if API fetch fails)
// =============================================================================

const FALLBACK_MODELS: ProviderModelConfig[] = [
	{
		id: "@cf/moonshotai/kimi-k2.5",
		name: "Kimi K2.5",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 0.6, output: 3.0, cacheRead: 0.1, cacheWrite: 0 },
		contextWindow: 256000,
		maxTokens: 8192,
		compat: { ...CLOUDFLARE_COMPAT, requiresThinkingAsText: true },
	},
	{
		id: "@cf/moonshotai/kimi-k2.6",
		name: "Kimi K2.6",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 0.8, output: 4.0, cacheRead: 0.1, cacheWrite: 0 },
		contextWindow: 256000,
		maxTokens: 8192,
		compat: { ...CLOUDFLARE_COMPAT, requiresThinkingAsText: true },
	},
	{
		id: "@cf/meta/llama-4-scout-17b-16e-instruct",
		name: "Llama 4 Scout 17B",
		reasoning: false,
		input: ["text", "image"],
		cost: { input: 0.27, output: 0.85, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 131072,
		maxTokens: 8192,
		compat: CLOUDFLARE_COMPAT,
	},
	{
		id: "@cf/nvidia/nemotron-3-120b-a12b",
		name: "Nemotron 3 Super 120B",
		reasoning: true,
		input: ["text"],
		cost: { input: 0.5, output: 1.5, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 256000,
		maxTokens: 8192,
		compat: { ...CLOUDFLARE_COMPAT, requiresThinkingAsText: true },
	},
	{
		id: "@cf/openai/gpt-oss-120b",
		name: "GPT-OSS 120B",
		reasoning: true,
		input: ["text"],
		cost: { input: 0.5, output: 1.5, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 8192,
		compat: { ...CLOUDFLARE_COMPAT, requiresThinkingAsText: true },
	},
	{
		id: "@cf/openai/gpt-oss-20b",
		name: "GPT-OSS 20B",
		reasoning: true,
		input: ["text"],
		cost: { input: 0.2, output: 0.6, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 8192,
		compat: { ...CLOUDFLARE_COMPAT, requiresThinkingAsText: true },
	},
	{
		id: "@cf/google/gemma-4-26b-a4b-it",
		name: "Gemma 4 26B",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 0.1, output: 0.3, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 256000,
		maxTokens: 8192,
		compat: { ...CLOUDFLARE_COMPAT, requiresThinkingAsText: true },
	},
	{
		id: "@cf/google/gemma-3-12b-it",
		name: "Gemma 3 12B",
		reasoning: false,
		input: ["text", "image"],
		cost: { input: 0.345, output: 0.556, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 80000,
		maxTokens: 8192,
		compat: CLOUDFLARE_COMPAT,
	},
	{
		id: "@cf/qwen/qwen3-30b-a3b-fp8",
		name: "Qwen3 30B A3B",
		reasoning: true,
		input: ["text"],
		cost: { input: 0.051, output: 0.34, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 32768,
		maxTokens: 8192,
		compat: { ...CLOUDFLARE_COMPAT, requiresThinkingAsText: true },
	},
	{
		id: "@cf/qwen/qwen2.5-coder-32b-instruct",
		name: "Qwen 2.5 Coder 32B",
		reasoning: false,
		input: ["text"],
		cost: { input: 0.3, output: 0.3, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 32768,
		maxTokens: 8192,
		compat: CLOUDFLARE_COMPAT,
	},
	{
		id: "@cf/qwen/qwq-32b",
		name: "QwQ 32B (Reasoning)",
		reasoning: true,
		input: ["text"],
		cost: { input: 0.3, output: 0.3, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 32768,
		maxTokens: 8192,
		compat: { ...CLOUDFLARE_COMPAT, requiresThinkingAsText: true },
	},
	{
		id: "@cf/zai-org/glm-4.7-flash",
		name: "GLM-4.7 Flash",
		reasoning: false,
		input: ["text"],
		cost: { input: 0.06, output: 0.4, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 131072,
		maxTokens: 8192,
		compat: CLOUDFLARE_COMPAT,
	},
	{
		id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
		name: "Llama 3.3 70B Fast",
		reasoning: false,
		input: ["text"],
		cost: { input: 0.5, output: 0.5, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 131072,
		maxTokens: 8192,
		compat: CLOUDFLARE_COMPAT,
	},
	{
		id: "@cf/meta/llama-3.1-405b-instruct",
		name: "Llama 3.1 405B",
		reasoning: false,
		input: ["text"],
		cost: { input: 2.0, output: 2.0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 131072,
		maxTokens: 8192,
		compat: CLOUDFLARE_COMPAT,
	},
	{
		id: "@cf/meta/llama-3.1-70b-instruct",
		name: "Llama 3.1 70B",
		reasoning: false,
		input: ["text"],
		cost: { input: 0.5, output: 0.5, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 131072,
		maxTokens: 8192,
		compat: CLOUDFLARE_COMPAT,
	},
	{
		id: "@cf/meta/llama-3.2-11b-vision-instruct",
		name: "Llama 3.2 11B Vision",
		reasoning: false,
		input: ["text", "image"],
		cost: { input: 0.2, output: 0.2, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 8192,
		compat: CLOUDFLARE_COMPAT,
	},
];

// =============================================================================
// Model metadata inference
// =============================================================================

interface CloudflareModel {
	id: string;
	name?: string;
	description?: string;
	task?: {
		id?: string;
		name?: string;
	};
}

function isChatModel(modelId: string): boolean {
	return !NON_CHAT_PATTERNS.some((pattern) => pattern.test(modelId));
}

function inferModelName(id: string): string {
	// Extract the model name part after the last /
	const namePart = id.split("/").pop() || id;

	// Remove common suffixes
	const clean = namePart
		.replace(/-instruct$/i, "")
		.replace(/-chat$/i, "")
		.replace(/-it$/i, "")
		.replace(/-awq$/i, " (AWQ)")
		.replace(/-fp8$/i, " (FP8)")
		.replace(/-fast$/i, " (Fast)")
		.replace(/-lora$/i, " (LoRA)")
		.replace(/-hf$/i, " (HF)")
		.replace(/-v\d+\.\d+$/i, "");

	// Convert to title case
	return clean
		.split("-")
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ")
		.replace(/\b(\d+(?:\.\d+)?)[bB]\b/g, "$1B");
}

function inferModelMetadata(id: string): Partial<ProviderModelConfig> {
	const hasVision = /vision|multimodal|vl|llava/i.test(id);
	const hasReasoning = /reason|r1|thinking|qwq|nemotron|oss/i.test(id);

	// Default context windows by model family
	let contextWindow = 32768;
	let maxTokens = 4096;

	if (/llama-3\.1|llama-3\.3|llama-4|gemma-4|kimi|nemotron/i.test(id)) {
		contextWindow = 128000;
		maxTokens = 8192;
	}
	if (/llama-3\.2-11b/i.test(id)) {
		contextWindow = 128000;
		maxTokens = 8192;
	}
	if (/gemma-3/i.test(id)) {
		contextWindow = 80000;
		maxTokens = 8192;
	}

	// Estimate costs based on model size (very rough approximation)
	let inputCost = 0.1;
	let outputCost = 0.3;

	const sizeMatch = id.match(/(\d+)(?:\.\d+)?[bB]/);
	if (sizeMatch) {
		const size = parseInt(sizeMatch[1], 10);
		if (size >= 100) {
			inputCost = 0.5;
			outputCost = 1.5;
		} else if (size >= 70) {
			inputCost = 0.5;
			outputCost = 0.5;
		} else if (size >= 30) {
			inputCost = 0.3;
			outputCost = 0.3;
		} else if (size >= 8) {
			inputCost = 0.2;
			outputCost = 0.2;
		}
	}

	// Override for specific known models
	if (id.includes("llama-3.1-405b")) {
		inputCost = 2.0;
		outputCost = 2.0;
	}
	if (id.includes("kimi-k2.5")) {
		inputCost = 0.6;
		outputCost = 3.0;
	}
	if (id.includes("kimi-k2.6")) {
		inputCost = 0.8;
		outputCost = 4.0;
	}

	return {
		name: inferModelName(id),
		reasoning: hasReasoning,
		input: hasVision ? (["text", "image"] as const) : (["text"] as const),
		cost: { input: inputCost, output: outputCost, cacheRead: 0, cacheWrite: 0 },
		contextWindow,
		maxTokens,
		compat: hasReasoning
			? { ...CLOUDFLARE_COMPAT, requiresThinkingAsText: true }
			: CLOUDFLARE_COMPAT,
	};
}

// =============================================================================
// Dynamic model fetching
// =============================================================================

async function fetchCloudflareModels(
	token: string,
	accountId: string,
): Promise<ProviderModelConfig[]> {
	const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}`;

	try {
		const response = await fetchWithRetry(
			`${baseUrl}/ai/models`,
			{
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
			},
			3,
			1000,
			DEFAULT_FETCH_TIMEOUT_MS,
		);

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}

		const json = (await response.json()) as {
			success?: boolean;
			result?: CloudflareModel[];
			errors?: Array<{ message: string }>;
		};

		if (!json.success || !json.result) {
			throw new Error(
				json.errors?.[0]?.message || "API returned unsuccessful response",
			);
		}

		// Filter to chat/text generation models only
		const chatModels = json.result.filter((m) => isChatModel(m.id));

		// Map to ProviderModelConfig
		const models = chatModels.map((m): ProviderModelConfig => {
			const inferred = inferModelMetadata(m.id);

			return {
				id: m.id,
				name: m.name || inferred.name || m.id,
				reasoning: inferred.reasoning || false,
				input: inferred.input || ["text"],
				cost: inferred.cost || {
					input: 0.1,
					output: 0.3,
					cacheRead: 0,
					cacheWrite: 0,
				},
				contextWindow: inferred.contextWindow || 32768,
				maxTokens: inferred.maxTokens || 4096,
				compat: inferred.compat || CLOUDFLARE_COMPAT,
			};
		});

		_logger.info(`[cloudflare] Fetched ${models.length} chat models from API`);
		return models;
	} catch (error) {
		_logger.warn(
			`[cloudflare] Failed to fetch models from API: ${error instanceof Error ? error.message : String(error)}`,
		);
		return [];
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

	// Try to fetch models dynamically, fall back to hardcoded list
	let models = await fetchCloudflareModels(apiToken, accountId);

	if (models.length === 0) {
		_logger.info("[cloudflare] Using fallback model list");
		models = FALLBACK_MODELS;
	}

	pi.registerProvider("cloudflare", {
		baseUrl: `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`,
		apiKey: apiToken,
		api: "openai-completions",
		authHeader: true,
		models,
	});

	_logger.info(
		`[cloudflare] Provider registered with account: ${accountId.slice(0, 8)}... (${models.length} models)`,
	);
}
