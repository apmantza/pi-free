/**
 * InferX Provider Extension
 *
 * InferX exposes an OpenAI-compatible API at
 * https://model.inferx.net/endpoints/v1
 *
 * Setup:
 *   INFERX_API_KEY=...
 *   # or add inferx_api_key to ~/.pi/free.json
 */

import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import {
	applyHidden,
	getInferxApiKey,
	getInferxShowPaid,
} from "../../config.ts";
import {
	BASE_URL_INFERX,
	DEFAULT_FETCH_TIMEOUT_MS,
	PROVIDER_INFERX,
} from "../../constants.ts";
import { createLogger } from "../../lib/logger.ts";
import { safeEnrichModelsWithModelsDev } from "../../lib/model-metadata.ts";
import {
	getProxyModelCompat,
	isLikelyReasoningModel,
} from "../../lib/provider-compat.ts";
import { cleanModelName, fetchWithRetry, withSignal } from "../../lib/util.ts";
import { createOpenAIAvailabilityProbe } from "../../lib/provider-probe.ts";
import {
	registerNativeAvailabilityProbe,
	registerNativeOpenAIProvider,
} from "../../lib/native-provider.ts";
import { inferxAuth } from "./inferx-auth.ts";

const _logger = createLogger("inferx");

interface InferxModel {
	id: string;
	object?: string;
	created?: number;
	owned_by?: string;
}

async function fetchInferxModels(
	apiKey: string,
	signal?: AbortSignal,
): Promise<ProviderModelConfig[]> {
	_logger.info("[inferx] Fetching models from InferX API...");

	try {
		const response = await fetchWithRetry(
			`${BASE_URL_INFERX}/models`,
			withSignal(
				{
					headers: {
						...(apiKey && { Authorization: `Bearer ${apiKey}` }),
						Accept: "application/json",
						"Content-Type": "application/json",
					},
				},
				signal,
			),
			3,
			1000,
			DEFAULT_FETCH_TIMEOUT_MS,
		);

		if (!response.ok) {
			throw new Error(`InferX API error: ${response.status}`);
		}

		const json = (await response.json()) as { data?: InferxModel[] };
		const models = json.data ?? [];

		_logger.info(`[inferx] Fetched ${models.length} models`);

		const mapped: ProviderModelConfig[] = models
			.filter((m) => m?.id)
			.map((m) => {
				const id = m.id;
				const name = cleanModelName(id);
				const reasoning = isLikelyReasoningModel({ id, name });

				return {
					id,
					name: `${name} (InferX)`,
					reasoning,
					input: ["text"],
					cost: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
					},
					contextWindow: 128_000,
					maxTokens: 16_384,
					compat: getProxyModelCompat({ id, name }),
					_pricingKnown: false,
				} as ProviderModelConfig & { _pricingKnown?: boolean };
			});

		const enriched = await safeEnrichModelsWithModelsDev(mapped, {
			providerId: PROVIDER_INFERX,
		});
		return applyHidden(enriched, PROVIDER_INFERX);
	} catch (error) {
		if (signal?.aborted) return [];
		_logger.error("[inferx] Failed to fetch models:", {
			error: error instanceof Error ? error.message : String(error),
		});
		return [];
	}
}

export default function inferxProvider(pi: ExtensionAPI): Promise<void> {
	const handle = registerNativeOpenAIProvider(pi, {
		providerId: PROVIDER_INFERX,
		name: "InferX",
		baseUrl: BASE_URL_INFERX,
		auth: inferxAuth,
		getApiKey: getInferxApiKey,
		getShowPaid: getInferxShowPaid,
		fetchModels: (apiKey, signal) => fetchInferxModels(apiKey, signal),
		tosUrl: "https://inferx.net/",
	});

	const apiKey = getInferxApiKey();
	if (apiKey) {
		const probe = createOpenAIAvailabilityProbe(
			PROVIDER_INFERX,
			BASE_URL_INFERX,
		);
		registerNativeAvailabilityProbe(pi, {
			providerId: PROVIDER_INFERX,
			label: "InferX",
			apiKey,
			probe,
			handle,
		});
	}
	return Promise.resolve();
}
