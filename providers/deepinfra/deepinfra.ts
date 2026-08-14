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
import { getDeepinfraApiKey, getDeepinfraShowPaid } from "../../config.ts";
import {
	BASE_URL_DEEPINFRA,
	DEFAULT_FETCH_TIMEOUT_MS,
	PROVIDER_DEEPINFRA,
} from "../../constants.ts";
import { createLogger } from "../../lib/logger.ts";
import { safeEnrichModelsWithModelsDev } from "../../lib/model-metadata.ts";
import {
	getProxyModelCompat,
	isLikelyReasoningModel,
} from "../../lib/provider-compat.ts";
import { createOpenAIAvailabilityProbe } from "../../lib/provider-probe.ts";
import {
	registerNativeAvailabilityProbe,
	registerNativeOpenAIProvider,
} from "../../lib/native-provider.ts";
import { fetchWithRetry } from "../../lib/util.ts";
import { deepinfraAuth } from "./deepinfra-auth.ts";

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
	signal?: AbortSignal,
): Promise<ProviderModelConfig[]> {
	const response = await fetchWithRetry(
		`${BASE_URL_DEEPINFRA}/models`,
		{
			headers: {
				...(apiKey && { Authorization: `Bearer ${apiKey}` }),
				"Content-Type": "application/json",
			},
			signal,
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

	const mapped = models
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

	return safeEnrichModelsWithModelsDev(mapped, {
		providerId: PROVIDER_DEEPINFRA,
	});
}

// =============================================================================
// Extension Entry Point
// =============================================================================

export default function deepinfraProvider(pi: ExtensionAPI): Promise<void> {
	const handle = registerNativeOpenAIProvider(pi, {
		providerId: PROVIDER_DEEPINFRA,
		name: "DeepInfra",
		baseUrl: BASE_URL_DEEPINFRA,
		auth: deepinfraAuth,
		getApiKey: getDeepinfraApiKey,
		getShowPaid: getDeepinfraShowPaid,
		initialShowPaid: true,
		allowUnauthenticated: true,
		fetchModels: (apiKey, signal) =>
			fetchDeepinfraModels(apiKey, signal),
		tosUrl: "https://deepinfra.com/pricing",
	});

	const apiKey = getDeepinfraApiKey();
	if (apiKey) {
		const probe = createOpenAIAvailabilityProbe(
			PROVIDER_DEEPINFRA,
			BASE_URL_DEEPINFRA,
		);
		registerNativeAvailabilityProbe(pi, {
			providerId: PROVIDER_DEEPINFRA,
			label: "DeepInfra",
			apiKey,
			probe,
			handle,
		});
	}
	return Promise.resolve();
}
