import type { Model } from "@earendil-works/pi-ai/compat";
import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { applyHidden } from "../../config.ts";
import {
	BASE_URL_ZENMUX,
	DEFAULT_FETCH_TIMEOUT_MS,
	PROVIDER_ZENMUX,
} from "../../constants.ts";
import { safeEnrichModelsWithModelsDev } from "../../lib/model-metadata.ts";
import { getProxyModelCompat } from "../../lib/provider-compat.ts";
import { isFreeModel } from "../../lib/registry.ts";
import { fetchWithRetry } from "../../lib/util.ts";
import { createLogger } from "../../lib/logger.ts";

const _logger = createLogger("zenmux-models");

export interface ZenMuxModel {
	id: string;
	display_name?: string;
	context_length?: number;
	input_modalities?: string[];
	output_modalities?: string[];
	capabilities?: {
		reasoning?: boolean;
	};
	pricings?: {
		prompt?: Array<{ value: number }>;
		completion?: Array<{ value: number }>;
		input_cache_read?: Array<{ value: number }>;
	};
}

/** Extract ZenMux's per-million-token price as a per-token Pi cost. */
export function extractZenmuxPrice(
	pricings: ZenMuxModel["pricings"],
	key: "prompt" | "completion" | "input_cache_read",
): number {
	const entries = pricings?.[key];
	if (!entries || entries.length === 0) return 0;
	return (entries[0].value ?? 0) / 1_000_000;
}

/**
 * Fetch and convert the ZenMux catalog. The catalog endpoint is public, so a
 * missing token fetches anonymously (no Authorization header); a configured
 * token is sent when present.
 */
export async function fetchZenmuxCatalog(options: {
	token?: string;
	signal?: AbortSignal;
}): Promise<{ all: ProviderModelConfig[]; free: ProviderModelConfig[] }> {
	if (options.signal?.aborted) {
		return { all: [], free: [] };
	}

	try {
		const response = await fetchWithRetry(
			`${BASE_URL_ZENMUX}/models`,
			{
				headers: {
					...(options.token && {
						Authorization: `Bearer ${options.token}`,
					}),
					"Content-Type": "application/json",
				},
				signal: options.signal,
			},
			3,
			1000,
			DEFAULT_FETCH_TIMEOUT_MS,
		);

		if (!response.ok) {
			throw new Error(`ZenMux API error: ${response.status}`);
		}

		const data = (await response.json()) as { data?: ZenMuxModel[] };
		const mapped = (data.data ?? []).map((model) => {
			const hasPricings = model.pricings !== undefined;
			return {
				id: model.id,
				name: model.display_name || model.id,
				reasoning: model.capabilities?.reasoning ?? false,
				input: model.input_modalities?.includes("image")
					? ["text", "image"]
					: ["text"],
				cost: {
					input: extractZenmuxPrice(model.pricings, "prompt"),
					output: extractZenmuxPrice(model.pricings, "completion"),
					cacheRead: extractZenmuxPrice(model.pricings, "input_cache_read"),
					cacheWrite: 0,
				},
				contextWindow: model.context_length || 128000,
				maxTokens: model.context_length
					? Math.floor(model.context_length / 2)
					: 4096,
				compat: getProxyModelCompat(model),
				_pricingKnown: hasPricings,
			} as ProviderModelConfig & { _pricingKnown?: boolean };
		});

		const visible = applyHidden(mapped, PROVIDER_ZENMUX);
		const all = await safeEnrichModelsWithModelsDev(visible, {
			providerId: PROVIDER_ZENMUX,
		});
		const free = all.filter((model) =>
			isFreeModel({ ...model, provider: PROVIDER_ZENMUX }, all),
		);
		return { all, free };
	} catch (error) {
		// Pi may abort a superseded refresh; cancellation is not a provider error.
		if (options.signal?.aborted) {
			return { all: [], free: [] };
		}
		_logger.error("Failed to fetch ZenMux models", {
			error: error instanceof Error ? error.message : String(error),
		});
		return { all: [], free: [] };
	}
}

export function toZenmuxModel(
	model: ProviderModelConfig,
): Model<"openai-completions"> {
	return {
		...model,
		api: "openai-completions",
		provider: PROVIDER_ZENMUX,
		baseUrl: model.baseUrl ?? BASE_URL_ZENMUX,
	} as Model<"openai-completions">;
}

export function toZenmuxModels(
	models: ProviderModelConfig[],
): Model<"openai-completions">[] {
	return models.map(toZenmuxModel);
}
