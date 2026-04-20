/**
 * Cloudflare Workers AI Provider Extension
 *
 * Provides access to 50+ open-source models via Cloudflare's serverless GPU network.
 * All models use Cloudflare's "Neurons" pricing system:
 *   - 10,000 Neurons per day FREE (resets daily at 00:00 UTC)
 *   - $0.011 per 1,000 Neurons beyond free allocation
 *
 * Requires CLOUDFLARE_API_TOKEN with Workers AI permission.
 * Get a free token at: https://dash.cloudflare.com/profile/api-tokens
 *   - Create token with "Cloudflare AI" > "Read" permission
 *   - Or use "My Account" > "Read" for all accounts
 *
 * The account ID is derived from the token automatically.
 * Alternatively, set CLOUDFLARE_ACCOUNT_ID explicitly.
 *
 * API Reference:
 *   Verify token: GET /user/tokens/verify
 *   List models:  GET /accounts/{account_id}/ai/models
 *   Run model:    POST /accounts/{account_id}/ai/run/{model_name}
 *   curl example:
 *     curl https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/ai/run/$MODEL_NAME \
 *       -X POST \
 *       -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
 *
 * Responds to global /free toggle (shows models but warns they're freemium).
 *
 * Usage:
 *   pi install git:github.com/apmantza/pi-free
 *   # Set CLOUDFLARE_API_TOKEN env var
 *   # Models appear in /model selector
 *   # Use /cloudflare-toggle to show all vs limited set
 */

import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@mariozechner/pi-coding-agent";
import {
	applyHidden,
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
// Types
// =============================================================================

interface CloudflareVerifyResponse {
	result?: {
		id: string;
		status: string;
		not_before?: string;
		expires_on?: string;
	};
	success: boolean;
	errors?: Array<{ code: number; message: string }>;
}

interface CloudflareModel {
	id: string;
	name: string;
	description?: string;
	capabilities: {
		text_generation?: boolean;
		image_generation?: boolean;
		speech_recognition?: boolean;
		text_to_speech?: boolean;
		translation?: boolean;
		image_classification?: boolean;
	};
	input_modalities?: string[];
	output_modalities?: string[];
	property?: {
		context_window?: number;
		max_output_tokens?: number;
	};
}

interface CloudflareModelsResponse {
	result?: CloudflareModel[];
	success: boolean;
	errors?: Array<{ code: number; message: string }>;
}

// =============================================================================
// Verify token and get account info
// =============================================================================

async function verifyCloudflareToken(
	apiToken: string,
): Promise<{ accountId: string }> {
	const response = await fetchWithRetry(
		`${BASE_URL_CLOUDFLARE}/user/tokens/verify`,
		{
			headers: {
				Authorization: `Bearer ${apiToken}`,
				"Content-Type": "application/json",
			},
		},
		3,
		1000,
		DEFAULT_FETCH_TIMEOUT_MS,
	);

	if (!response.ok) {
		throw new Error(
			`Failed to verify Cloudflare token: ${response.status} ${response.statusText}`,
		);
	}

	const json = (await response.json()) as CloudflareVerifyResponse;

	if (!json.success) {
		const errorMsg =
			json.errors?.map((e) => e.message).join(", ") || "Invalid token";
		throw new Error(`Cloudflare token verification failed: ${errorMsg}`);
	}

	// The token info includes the user, but we need to get the account ID
	// For now, we'll try to use the token's associated account
	// In practice, users with multiple accounts may need to specify one
	if (process.env.CLOUDFLARE_ACCOUNT_ID) {
		return { accountId: process.env.CLOUDFLARE_ACCOUNT_ID };
	}

	// If no account ID is set, we'll need the user to provide one
	// The verify endpoint doesn't return account IDs directly
	throw new Error(
		"CLOUDFLARE_ACCOUNT_ID is required. Get it from: https://dash.cloudflare.com",
	);
}

// =============================================================================
// Fetch + map
// =============================================================================

async function fetchCloudflareModels(
	accountId: string,
	apiToken: string,
): Promise<ProviderModelConfig[]> {
	const url = `${BASE_URL_CLOUDFLARE}/accounts/${accountId}/ai/models`;

	const response = await fetchWithRetry(
		url,
		{
			headers: {
				Authorization: `Bearer ${apiToken}`,
				"Content-Type": "application/json",
			},
		},
		3,
		1000,
		DEFAULT_FETCH_TIMEOUT_MS,
	);

	if (!response.ok) {
		throw new Error(
			`Failed to fetch Cloudflare models: ${response.status} ${response.statusText}`,
		);
	}

	const json = (await response.json()) as CloudflareModelsResponse;

	if (!json.success || !json.result) {
		const errorMsg =
			json.errors?.map((e) => e.message).join(", ") || "Unknown error";
		throw new Error(`Cloudflare API error: ${errorMsg}`);
	}

	// Filter to text-generation models only (chat models)
	const chatModels = json.result.filter(
		(m) => m.capabilities?.text_generation === true,
	);

	_logger.info(
		`[cloudflare] Fetched ${chatModels.length} text generation models`,
	);

	const result = applyHidden(
		chatModels.map(
			(m): ProviderModelConfig => ({
				id: m.id,
				name: m.name,
				// Cloudflare models don't explicitly declare reasoning
				reasoning: m.id.includes("qwq") || m.id.includes("deepseek-r1"),
				input: m.input_modalities?.includes("image")
					? ["text", "image"]
					: ["text"],
				// Cloudflare uses "Neurons" not per-token pricing
				// All models consume the same 10K Neurons/day free pool
				// Mark as "free" for display purposes (freemium model)
				cost: {
					input: 0, // Freemium: 10K Neurons/day free
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
				},
				contextWindow: m.property?.context_window ?? 8192,
				maxTokens: m.property?.max_output_tokens ?? 4096,
			}),
		),
	);

	return result;
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

	// Verify token and get account info
	let accountId: string;
	try {
		const tokenInfo = await verifyCloudflareToken(apiToken);
		accountId = tokenInfo.accountId;
	} catch (error) {
		_logger.error("[cloudflare] Token verification failed", {
			error: error instanceof Error ? error.message : String(error),
		});
		return;
	}

	// Fetch models
	let allModels: ProviderModelConfig[] = [];

	try {
		allModels = await fetchCloudflareModels(accountId, apiToken);
	} catch (error) {
		_logger.error("[cloudflare] Failed to fetch models at startup", {
			error: error instanceof Error ? error.message : String(error),
		});
		return;
	}

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
