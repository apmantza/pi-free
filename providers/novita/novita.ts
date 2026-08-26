/**
 * Novita AI Provider Extension
 *
 * Novita AI deploys 100+ open-source models with an OpenAI-compatible API.
 * Known for competitive pricing, globally distributed GPU infrastructure,
 * and support for chat, vision, and Anthropic-compatible endpoints.
 *
 * API: https://api.novita.ai/openai/v1
 * Models: /v1/models returns non-standard pricing fields (input_token_price_per_m,
 * output_token_price_per_m) plus rich metadata (context_size, max_output_tokens,
 * features for reasoning, input_modalities for vision).
 *
 * Setup:
 *   1. Sign up at https://novita.ai
 *   2. Get API key from dashboard
 *   3. Set NOVITA_API_KEY env var or add to ~/.pi/free.json
 *
 * Usage:
 *   pi install git:github.com/apmantza/pi-free
 *   # Set NOVITA_API_KEY env var
 *   # Models appear in /model selector
 */

import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import { getNovitaApiKey, getNovitaShowPaid } from "../../config.ts";
import {
	BASE_URL_NOVITA,
	DEFAULT_FETCH_TIMEOUT_MS,
	PROVIDER_NOVITA,
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
import { novitaAuth } from "./novita-auth.ts";

const _logger = createLogger("novita");

// =============================================================================
// Types
// =============================================================================

interface NovitaModel {
	id: string;
	display_name?: string;
	description?: string;
	input_token_price_per_m?: number;
	output_token_price_per_m?: number;
	context_size?: number;
	max_output_tokens?: number;
	features?: string[];
	input_modalities?: string[];
	output_modalities?: string[];
	model_type?: string;
	endpoints?: string[];
	status?: number;
}

/**
 * Internal Novita smoke-test models (`ai_infer_test_1..3`) are zero-priced and
 * typed `chat`, but are not real inference endpoints. They carry no
 * distinguishing structured metadata, so the id pattern is the only signal.
 */
const INTERNAL_TEST_MODEL_PATTERN = /^ai_infer_test/;

// =============================================================================
// Fetch
// =============================================================================

export async function fetchNovitaModels(
	apiKey: string,
	signal?: AbortSignal,
): Promise<ProviderModelConfig[]> {
	_logger.info("[novita] Fetching models from Novita API...");

	try {
		const response = await fetchWithRetry(
			`${BASE_URL_NOVITA}/models`,
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
			throw new Error(`Novita API error: ${response.status}`);
		}

		const json = (await response.json()) as { data?: NovitaModel[] };
		const models = (json.data ?? [])
			.filter((m) => m.status === 1 && m.model_type === "chat")
			// Novita exposes internal smoke-test entries (`ai_infer_test_1..3`)
			// as zero-priced chat models; they are not usable endpoints.
			.filter((m) => !INTERNAL_TEST_MODEL_PATTERN.test(m.id));

		_logger.info(`[novita] Fetched ${models.length} models`);

		const mapped = models.map((m): ProviderModelConfig => {
			const name = m.display_name || m.id.split("/").pop() || m.id;
			const reasoning =
				(m.features ?? []).includes("reasoning") ||
				isLikelyReasoningModel({ id: m.id, name });
			const hasVision = m.input_modalities?.includes("image") ?? false;

			// Novita pricing is per-MILLION tokens. Divide for per-token (Pi convention).
			const inputCost = (m.input_token_price_per_m ?? 0) / 1_000_000;
			const outputCost = (m.output_token_price_per_m ?? 0) / 1_000_000;
			const hasPricing =
				m.input_token_price_per_m !== undefined ||
				m.output_token_price_per_m !== undefined;

			return {
				id: m.id,
				name,
				reasoning,
				input: hasVision ? ["text", "image"] : ["text"],
				cost: {
					input: inputCost,
					output: outputCost,
					cacheRead: 0,
					cacheWrite: 0,
				},
				contextWindow: m.context_size ?? 128_000,
				maxTokens: m.max_output_tokens ?? 16_384,
				compat: getProxyModelCompat({ id: m.id, name }),
				_pricingKnown: hasPricing,
			} as ProviderModelConfig & { _pricingKnown?: boolean };
		});

		return await safeEnrichModelsWithModelsDev(mapped, {
			providerId: PROVIDER_NOVITA,
		});
	} catch (error) {
		// Pi may abort a superseded refresh; cancellation is not a provider error.
		if (signal?.aborted) return [];
		_logger.error("[novita] Failed to fetch models:", {
			error: error instanceof Error ? error.message : String(error),
		});
		return [];
	}
}

export default function novitaProvider(pi: ExtensionAPI): Promise<void> {
	const handle = registerNativeOpenAIProvider(pi, {
		providerId: PROVIDER_NOVITA,
		name: "Novita AI",
		baseUrl: BASE_URL_NOVITA,
		auth: novitaAuth,
		getApiKey: getNovitaApiKey,
		getShowPaid: getNovitaShowPaid,
		allowUnauthenticated: true,
		fetchModels: (apiKey, signal) => fetchNovitaModels(apiKey, signal),
		tosUrl: "https://novita.ai/terms",
	});
	const apiKey = getNovitaApiKey();
	if (!apiKey) return Promise.resolve();

	const probe = createOpenAIAvailabilityProbe(PROVIDER_NOVITA, BASE_URL_NOVITA);
	registerNativeAvailabilityProbe(pi, {
		providerId: PROVIDER_NOVITA,
		label: "Novita AI",
		apiKey,
		probe,
		handle,
	});
	return Promise.resolve();
}
