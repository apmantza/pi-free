/**
 * DeepInfra Provider Extension
 *
 * DeepInfra is an AI inference cloud with an OpenAI-compatible API for
 * 100+ open-source models (Llama, DeepSeek, Mistral, Qwen, Mixtral, etc.).
 *
 * Free tier:
 *   - $5 one-time credit on signup (no credit card)
 *   - ~5M tokens, expires after 90 days
 *   - 60 RPM (varies by model)
 *
 * Paid: pay-per-token after credits exhaust
 *
 * Endpoint:
 *   Chat: https://api.deepinfra.com/v1/openai/chat/completions
 *
 * Setup:
 *   1. Sign up at https://deepinfra.com/ (GitHub or email)
 *   2. Get API key from https://deepinfra.com/dash/api_keys
 *   3. Set DEEPINFRA_TOKEN env var (or add to ~/.pi/free.json)
 *
 * Usage:
 *   pi install git:github.com/apmantza/pi-free
 *   # Set DEEPINFRA_TOKEN env var
 *   # Models appear in /model selector as "deepinfra/meta-llama/..."
 */

import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@mariozechner/pi-coding-agent";
import { getDeepinfraApiKey, getDeepinfraShowPaid } from "../../config.ts";
import {
	BASE_URL_DEEPINFRA,
	DEFAULT_FETCH_TIMEOUT_MS,
	PROVIDER_DEEPINFRA,
} from "../../constants.ts";
import { createLogger } from "../../lib/logger.ts";
import {
	getProxyModelCompat,
	isLikelyReasoningModel,
} from "../../lib/provider-compat.ts";
import { registerWithGlobalToggle } from "../../lib/registry.ts";
import { fetchWithRetry } from "../../lib/util.ts";
import { createReRegister, setupProvider } from "../../provider-helper.ts";

const _logger = createLogger("deepinfra");

// =============================================================================
// Fetch DeepInfra models
// =============================================================================

interface DeepinfraModel {
	id: string;
	object?: string;
	created?: number;
	owned_by?: string;
}

async function fetchDeepinfraModels(
	apiKey: string,
): Promise<ProviderModelConfig[]> {
	_logger.info("[deepinfra] Fetching models from DeepInfra API...");

	try {
		const response = await fetchWithRetry(
			`${BASE_URL_DEEPINFRA}/models`,
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
			throw new Error(`DeepInfra API error: ${response.status}`);
		}

		const data = (await response.json()) as {
			data?: DeepinfraModel[];
		};
		const models = data.data ?? [];

		_logger.info(`[deepinfra] Fetched ${models.length} models`);

		return models
			.filter((m) => m.id)
			.map((m) => {
				const name = m.id.split("/").pop() || m.id;
				return {
					id: m.id,
					name,
					reasoning: isLikelyReasoningModel({ id: m.id, name }),
					input: ["text"],
					cost: {
						input: 0.3, // Default — real pricing varies per model
						output: 0.9,
						cacheRead: 0,
						cacheWrite: 0,
					},
					contextWindow: 128_000, // Default, varies by model
					maxTokens: 4_096,
					compat: getProxyModelCompat({ id: m.id, name }),
				} satisfies ProviderModelConfig;
			});
	} catch (error) {
		_logger.error("[deepinfra] Failed to fetch models:", {
			error: error instanceof Error ? error.message : String(error),
		});
		return [];
	}
}

// =============================================================================
// Extension Entry Point
// =============================================================================

export default async function deepinfraProvider(pi: ExtensionAPI) {
	const apiKey = getDeepinfraApiKey();

	if (!apiKey) {
		_logger.info(
			"[deepinfra] Skipping — DEEPINFRA_TOKEN not set. Sign up at https://deepinfra.com/",
		);
		return;
	}

	// Fetch models
	const allModels = await fetchDeepinfraModels(apiKey);

	if (allModels.length === 0) {
		_logger.warn("[deepinfra] No models available");
		return;
	}

	// DeepInfra is a trial credit provider — $5 one-time credit, no truly free models.
	// All models are marked as paid. When free-only mode is ON, no models are shown.
	// Toggle free-only OFF to see all models.
	const freeModels: ProviderModelConfig[] = [];
	const stored = { free: freeModels, all: allModels };

	_logger.info(
		`[deepinfra] Registered ${allModels.length} models (trial credit, 0 free)`,
	);

	// Create re-register function
	const reRegister = createReRegister(pi, {
		providerId: PROVIDER_DEEPINFRA,
		baseUrl: BASE_URL_DEEPINFRA,
		apiKey,
	});

	// Register with global toggle
	registerWithGlobalToggle(PROVIDER_DEEPINFRA, stored, reRegister, true);

	// Setup provider with toggle command
	setupProvider(
		pi,
		{
			providerId: PROVIDER_DEEPINFRA,
			initialShowPaid: getDeepinfraShowPaid(),
			tosUrl: "https://deepinfra.com/pricing",
			reRegister: (models, _stored) => {
				if (_stored) {
					stored.free = _stored.free;
					stored.all = _stored.all;
				}
				reRegister(models);
			},
		},
		stored,
	);

	// Initial registration — register as "all" (paid) since there are no free models
	reRegister(allModels);
}
