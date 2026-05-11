/**
 * DeepInfra Provider Extension
 *
 * DeepInfra is an AI inference cloud with an OpenAI-compatible API for
 * 100+ open-source models (Llama, DeepSeek, Mistral, Qwen, Mixtral, etc.).
 *
 * NOTE: DeepInfra's /v1/openai/models buries real model data in a "metadata"
 * field (context_length, max_tokens, pricing, tags). We extract it here.
 * Pricing is per-MILLION tokens.
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
} from "@earendil-works/pi-coding-agent";
import { getDeepinfraApiKey } from "../../config.ts";
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
import { isFreeModel, registerWithGlobalToggle } from "../../lib/registry.ts";
import { fetchWithRetry } from "../../lib/util.ts";
import { createReRegister, setupProvider } from "../../provider-helper.ts";

const _logger = createLogger("deepinfra");

// =============================================================================
// Types
// =============================================================================

interface DeepInfraModel {
	id: string;
	metadata?: {
		context_length?: number;
		max_tokens?: number;
		description?: string;
		pricing?: {
			input_tokens?: number;
			output_tokens?: number;
		};
		tags?: string[];
	};
}

// =============================================================================
// Fetch
// =============================================================================

async function fetchDeepinfraModels(
	apiKey: string,
): Promise<ProviderModelConfig[]> {
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
		throw new Error(
			`DeepInfra API error: ${response.status} ${response.statusText}`,
		);
	}

	const json = (await response.json()) as { data?: DeepInfraModel[] };
	const models = json.data ?? [];

	_logger.info(`[deepinfra] Fetched ${models.length} models`);

	return models
		.filter((m) => {
			const id = m.id.toLowerCase();
			// Filter out non-chat models
			if (id.includes("embed")) return false;
			if (id.includes("rerank")) return false;
			if (id.includes("whisper")) return false;
			if (id.includes("speech")) return false;
			return true;
		})
		.map((m): ProviderModelConfig => {
			const meta = m.metadata;
			const name = m.id.split("/").pop() || m.id;

			// Reasoning: check tags first, fall back to name heuristic
			const reasoning =
				meta?.tags?.includes("reasoning") ??
				isLikelyReasoningModel({ id: m.id, name });

			// Pricing is per-MILLION tokens. Divide to get per-token (Pi convention).
			const inputCost = (meta?.pricing?.input_tokens ?? 0.3) / 1_000_000;
			const outputCost = (meta?.pricing?.output_tokens ?? 0.9) / 1_000_000;

			return {
				id: m.id,
				name,
				reasoning,
				input: ["text"],
				cost: {
					input: inputCost,
					output: outputCost,
					cacheRead: 0,
					cacheWrite: 0,
				},
				contextWindow: meta?.context_length ?? 128_000,
				maxTokens: meta?.max_tokens ?? 16_384,
				compat: getProxyModelCompat({ id: m.id, name }),
				_pricingKnown: meta?.pricing !== undefined,
			} as ProviderModelConfig & { _pricingKnown?: boolean };
		});
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
		_logger.warn("[deepinfra] No chat models available");
		return;
	}

	// DeepInfra is a trial credit provider — $5 one-time credit, no truly free models.
	// Use isFreeModel for consistent detection across all providers.
	const freeModels = allModels.filter((m) =>
		isFreeModel({ ...m, provider: PROVIDER_DEEPINFRA }, allModels),
	);
	const stored = { free: freeModels, all: allModels };

	_logger.info(
		`[deepinfra] Registered ${allModels.length} chat models (trial credit, 0 free)`,
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
			initialShowPaid: true, // trial credit: default to showing all models
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

	// Initial registration — DeepInfra is a trial-credit provider,
	// so always show all models. Users see them immediately on setup.
	reRegister(allModels);
}
