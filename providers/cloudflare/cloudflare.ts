/**
 * Cloudflare Workers AI Provider Extension
 *
 * Provides access to 50+ open-source models via Cloudflare's serverless GPU network.
 * All models use Cloudflare's "Neurons" pricing system:
 *   - 10,000 Neurons per day FREE (resets daily at 00:00 UTC)
 *   - $0.011 per 1,000 Neurons beyond free allocation
 *
 * Requires:
 *   1. CLOUDFLARE_API_TOKEN with Workers AI permission
 *      Get at: https://dash.cloudflare.com/profile/api-tokens
 *      Create token with "Cloudflare AI" > "Read" permission
 *   2. CLOUDFLARE_ACCOUNT_ID (RECOMMENDED - see below)
 *
 * IMPORTANT: Set CLOUDFLARE_ACCOUNT_ID to avoid permission issues
 *   - Your API token needs "Account:Read" permission to auto-fetch accounts
 *   - Most AI-only tokens lack this permission, causing "No accounts found" errors
 *   - Set via: CLOUDFLARE_ACCOUNT_ID env var OR cloudflare_account_id in ~/.pi/free.json
 *   - Find your Account ID at: https://dash.cloudflare.com (right sidebar)
 *
 * API Reference:
 *   List models:   GET /client/v4/accounts/{account_id}/ai/models
 *   Run model:     POST /client/v4/accounts/{account_id}/ai/run/{model_name}
 *   curl example:
 *     curl https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/ai/run/$MODEL_NAME \
 *       -X POST \
 *       -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
 *
 * Responds to global /free toggle (shows models but warns they're freemium).
 *
 * Usage:
 *   pi install git:github.com/apmantza/pi-free
 *   # Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID
 *   # Models appear in /model selector
 *   # Use /cloudflare-toggle to show all vs limited set
 */

import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@mariozechner/pi-coding-agent";
import {
	applyHidden,
	CLOUDFLARE_ACCOUNT_ID,
	CLOUDFLARE_API_TOKEN,
	CLOUDFLARE_SHOW_PAID,
} from "../../config.ts";
import {
	BASE_URL_CLOUDFLARE,
	DEFAULT_FETCH_TIMEOUT_MS,
	PROVIDER_CLOUDFLARE,
} from "../../constants.ts";
import { registerWithGlobalToggle } from "../../index.ts";
import { createLogger } from "../../lib/logger.ts";
import { fetchWithRetry } from "../../lib/util.ts";
import { createReRegister, enhanceWithCI } from "../../provider-helper.ts";

const _logger = createLogger("cloudflare");

// =============================================================================
// Verified free-tier models from https://free-llm.com/provider/cloudflare-workers-ai
// =============================================================================

// =============================================================================
// Fallback model list (when API fails)
// Source: https://free-llm.com/provider/cloudflare-workers-ai
// =============================================================================

/**
 * Verified free models from Cloudflare Workers AI.
 * All models use the 10K neurons/day free allocation.
 */
const FALLBACK_CLOUDFLARE_MODELS: ProviderModelConfig[] = [
	// Meta Llama Models (128K context)
	{
		id: "@cf/meta/llama-3.1-8b-instruct",
		name: "Llama 3.1 8B Instruct",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 4096,
	},
	{
		id: "@cf/meta/llama-3.2-3b-instruct",
		name: "Llama 3.2 3B Instruct",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 4096,
	},
	// Mistral via Hugging Face (32K context, multilingual)
	{
		id: "@hf/mistral/mistral-7b-instruct-v0.2",
		name: "Mistral 7B Instruct v0.2",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 32000,
		maxTokens: 4096,
	},
	// Alibaba Qwen (32K context, Chinese)
	{
		id: "@cf/qwen/qwen1.5-7b-chat-awq",
		name: "Qwen 1.5 7B Chat (AWQ)",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 32000,
		maxTokens: 4096,
	},
	// DeepSeek Coder via Hugging Face (16K context, code-focused)
	{
		id: "@hf/thebloke/deepseek-coder-6.7b-instruct-awq",
		name: "DeepSeek Coder 6.7B Instruct (AWQ)",
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 16000,
		maxTokens: 4096,
	},
	// Microsoft Phi-2 (2K context, reasoning)
	{
		id: "@cf/microsoft/phi-2",
		name: "Microsoft Phi-2",
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 2048,
		maxTokens: 1024,
	},
];

// =============================================================================
// Get models (static list - no API calls)
// =============================================================================

/**
 * Return the static list of verified free-tier models.
 * No API calls needed - these are known working models from free-llm.com
 */
async function getCloudflareModels(): Promise<ProviderModelConfig[]> {
	_logger.info(
		`[cloudflare] Using ${FALLBACK_CLOUDFLARE_MODELS.length} verified free-tier models`,
	);
	return applyHidden(FALLBACK_CLOUDFLARE_MODELS);
}

// =============================================================================
// Extension Entry Point
// =============================================================================

export default async function (pi: ExtensionAPI) {
	const apiToken = CLOUDFLARE_API_TOKEN;

	if (!apiToken) {
		_logger.info(
			"[cloudflare] Skipping - CLOUDFLARE_API_TOKEN not set (env var or ~/.pi/free.json)",
		);
		return;
	}

	// Inject into process.env so Pi's apiKey lookup finds it
	process.env.CLOUDFLARE_API_TOKEN = apiToken;

	// Use configured account ID (required)
	if (!CLOUDFLARE_ACCOUNT_ID) {
		_logger.error(
			"[cloudflare] CLOUDFLARE_ACCOUNT_ID not set. Add to ~/.pi/free.json or set env var.",
		);
		return;
	}
	const accountId = CLOUDFLARE_ACCOUNT_ID;

	// Get models (static list - no API calls needed)
	const allModels = await getCloudflareModels();

	// For Cloudflare, all models share the same free tier
	// So "free" and "all" are the same set
	const freeModels = allModels;
	const stored = { free: freeModels, all: allModels };
	const hasKey = true; // We have the key since we checked above

	// Create re-register function
	const reRegister = createReRegister(pi, {
		providerId: PROVIDER_CLOUDFLARE,
		baseUrl: `${BASE_URL_CLOUDFLARE}/accounts/${accountId}/ai/v1`,
		apiKey: "CLOUDFLARE_API_TOKEN",
	});

	// Register with global toggle system
	registerWithGlobalToggle(PROVIDER_CLOUDFLARE, stored, reRegister, hasKey);

	// Register initial models
	// Note: CLOUDFLARE_SHOW_PAID doesn't change the model list since all models
	// use the same free tier pool. It's kept for consistency with other providers.
	const initialModels = CLOUDFLARE_SHOW_PAID ? allModels : freeModels;
	pi.registerProvider(PROVIDER_CLOUDFLARE, {
		baseUrl: `${BASE_URL_CLOUDFLARE}/accounts/${accountId}/ai/v1`,
		apiKey: "CLOUDFLARE_API_TOKEN",
		api: "openai-completions" as const,
		models: enhanceWithCI(initialModels),
	});

	_logger.info(
		`[cloudflare] Registered ${initialModels.length} models (10K Neurons/day free tier)`,
	);
}
