import type { Model } from "@earendil-works/pi-ai/compat";
import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { applyHidden } from "../../config.ts";
import {
	BASE_URL_ZENMUX,
	DEFAULT_FETCH_TIMEOUT_MS,
	PROVIDER_ZENMUX,
} from "../../constants.ts";
import { firstPositiveLimit } from "../../lib/model-map.ts";
import { safeEnrichModelsWithModelsDev } from "../../lib/model-metadata.ts";
import { withGatewayCompat } from "../../lib/native-provider.ts";
import { getProxyModelCompat } from "../../lib/provider-compat.ts";
import { isFreeModel } from "../../lib/registry.ts";
import { fetchWithRetry, withSignal } from "../../lib/util.ts";
import { createLogger } from "../../lib/logger.ts";

const _logger = createLogger("zenmux-models");

interface ZenMuxModel {
	id: string;
	display_name?: string;
	context_length?: number;
	max_tokens?: number | null;
	input_modalities?: string[];
	output_modalities?: string[];
	capabilities?: {
		reasoning?: boolean;
	};
	pricings?: Partial<Record<ZenMuxPriceKey, Array<{ value: number }>>>;
}

type ZenMuxPriceKey =
	| "prompt"
	| "completion"
	| "input_cache_read"
	| "input_cache_write"
	| "input_cache_write_5_min"
	| "input_cache_write_1_h";

/** ZenMux's USD-per-million price (the `Model.cost` unit), if listed. */
function zenmuxPrice(
	pricings: ZenMuxModel["pricings"],
	key: ZenMuxPriceKey,
): number | undefined {
	return pricings?.[key]?.[0]?.value;
}

/**
 * The cache-write price. ZenMux lists one `input_cache_write`, or one per
 * cache lifetime (`_5_min` and `_1_h`, or `_1_h` only). pi-ai prices 1-hour
 * writes itself (2x input), so the 5-minute tier is the published rate; a
 * model listing only the 1-hour tier is billed at it.
 */
function zenmuxCacheWritePrice(pricings: ZenMuxModel["pricings"]): number {
	return (
		zenmuxPrice(pricings, "input_cache_write") ??
		zenmuxPrice(pricings, "input_cache_write_5_min") ??
		zenmuxPrice(pricings, "input_cache_write_1_h") ??
		0
	);
}

/**
 * Whether a catalog entry can produce chat text. ZenMux lists image/video
 * generation, speech/transcription, embeddings and rerank endpoints alongside
 * chat models; only text-output entries belong in the model picker. Entries
 * with no `output_modalities` are kept (older/partial rows) to avoid
 * over-filtering — the same rule the shared OpenRouter-compatible fetcher
 * applies.
 */
function isChatModel(model: ZenMuxModel): boolean {
	const outputModalities = model.output_modalities ?? [];
	return outputModalities.length === 0 || outputModalities.includes("text");
}

/**
 * Fetch and convert the ZenMux catalog. The catalog endpoint is public, so a
 * missing token fetches anonymously (no Authorization header); a configured
 * token is sent when present.
 */
export async function fetchZenmuxCatalog(options: {
	token?: string | undefined;
	signal?: AbortSignal;
}): Promise<{ all: ProviderModelConfig[]; free: ProviderModelConfig[] }> {
	if (options.signal?.aborted) {
		return { all: [], free: [] };
	}

	try {
		const response = await fetchWithRetry(
			`${BASE_URL_ZENMUX}/models`,
			withSignal(
				{
					headers: {
						...(options.token && {
							Authorization: `Bearer ${options.token}`,
						}),
						"Content-Type": "application/json",
					},
				},
				options.signal,
			),
			3,
			1000,
			DEFAULT_FETCH_TIMEOUT_MS,
		);

		if (!response.ok) {
			throw new Error(`ZenMux API error: ${response.status}`);
		}

		const data = (await response.json()) as { data?: ZenMuxModel[] };
		// Chat entries only; see isChatModel.
		const chatModels = (data.data ?? []).filter(isChatModel);
		const mapped = chatModels.map((model) => {
			const hasPricings = model.pricings !== undefined;
			return {
				id: model.id,
				name: model.display_name || model.id,
				reasoning: model.capabilities?.reasoning ?? false,
				input: model.input_modalities?.includes("image")
					? ["text", "image"]
					: ["text"],
				cost: {
					input: zenmuxPrice(model.pricings, "prompt") ?? 0,
					output: zenmuxPrice(model.pricings, "completion") ?? 0,
					cacheRead: zenmuxPrice(model.pricings, "input_cache_read") ?? 0,
					cacheWrite: zenmuxCacheWritePrice(model.pricings),
				},
				contextWindow: model.context_length || 128000,
				// The catalog's output limit; half the window only where none is
				// listed (3 live text models on 2026-11-15, e.g. openai/o4-mini).
				maxTokens:
					firstPositiveLimit(model.max_tokens) ??
					(model.context_length ? Math.floor(model.context_length / 2) : 4096),
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

function toZenmuxModel(
	model: ProviderModelConfig,
): Model<"openai-completions"> {
	return withGatewayCompat({
		...model,
		api: "openai-completions",
		provider: PROVIDER_ZENMUX,
		baseUrl: model.baseUrl ?? BASE_URL_ZENMUX,
	} as Model<"openai-completions">);
}

export function toZenmuxModels(
	models: ProviderModelConfig[],
): Model<"openai-completions">[] {
	return models.map(toZenmuxModel);
}
