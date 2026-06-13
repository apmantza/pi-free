import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { DEFAULT_FETCH_TIMEOUT_MS, URL_MODELS_DEV } from "../constants.ts";
import { getProxyModelCompat } from "./provider-compat.ts";
import type {
	CostConfig,
	ModelIdentity,
	ModelMatchHints,
	ModelsDevEnrichedMetadata,
	ModelsDevModel,
	ModelsDevProvider,
} from "./types.ts";

const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 16_384;
const MODELS_DEV_PROVIDER_ALIASES: Record<string, string> = {
	together: "togetherai",
	novita: "novita-ai",
};

type ThinkingLevelMap = NonNullable<ProviderModelConfig["thinkingLevelMap"]>;
type ModelCompat = NonNullable<ProviderModelConfig["compat"]>;

function collectAllModels(
	catalog: Record<string, ModelsDevProvider>,
): Record<string, ModelsDevModel> {
	const allModels: Record<string, ModelsDevModel> = {};
	for (const [providerKey, provider] of Object.entries(catalog)) {
		for (const [modelId, model] of Object.entries(provider.models ?? {})) {
			allModels[`${provider.id ?? providerKey}/${modelId}`] = model;
		}
	}
	return allModels;
}

export async function fetchModelsDevMeta(
	providerId?: string,
): Promise<Record<string, ModelsDevModel>> {
	const response = await fetch(URL_MODELS_DEV, {
		headers: { "User-Agent": "pi-free-providers" },
		signal: AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS),
	});
	if (!response.ok) return {};

	const catalog = (await response.json()) as Record<string, ModelsDevProvider>;
	if (providerId) {
		const catalogProviderId =
			MODELS_DEV_PROVIDER_ALIASES[providerId] ?? providerId;
		const scopedModels = catalog[catalogProviderId]?.models;
		if (scopedModels && Object.keys(scopedModels).length > 0) {
			return scopedModels;
		}
	}

	return collectAllModels(catalog);
}

function normalizeModelKey(id: string): string {
	return id
		.toLowerCase()
		.replace(/^~/, "")
		.replace(/:free$/, "")
		.replace(/-free$/, "");
}

function buildModelMetaIndex(
	meta: Record<string, ModelsDevModel>,
): Map<string, ModelsDevModel> {
	const index = new Map<string, ModelsDevModel>();
	for (const [key, model] of Object.entries(meta)) {
		for (const value of [key, model.id, key.split("/").pop()]) {
			if (value) index.set(normalizeModelKey(value), model);
		}
	}
	return index;
}

function findModelDevMeta(
	index: Map<string, ModelsDevModel>,
	modelId: string,
): ModelsDevModel | undefined {
	const id = normalizeModelKey(modelId);
	return index.get(id) ?? index.get(id.split("/").pop() ?? id);
}

function isTextOnly(input: ProviderModelConfig["input"]): boolean {
	return input.length === 1 && input[0] === "text";
}

function costLooksLikeFallback(cost: CostConfig): boolean {
	return (
		cost.input === 0 &&
		cost.output === 0 &&
		cost.cacheRead === 0 &&
		cost.cacheWrite === 0
	);
}

function costFromModelsDev(
	cost: ModelsDevModel["cost"],
): CostConfig | undefined {
	if (!cost) return undefined;
	return {
		input: cost.input / 1_000_000,
		output: cost.output / 1_000_000,
		cacheRead: (cost.cache_read ?? 0) / 1_000_000,
		cacheWrite: (cost.cache_write ?? 0) / 1_000_000,
	};
}

function thinkingMapFromReasoningOptions(
	options: ModelsDevModel["reasoning_options"],
): ThinkingLevelMap | undefined {
	const effort = options?.find((option) => option.type === "effort");
	if (!effort?.values?.length) return undefined;

	const values = new Set(effort.values);
	return {
		off: values.has("none") ? "none" : null,
		minimal: values.has("minimal") ? "minimal" : null,
		low: values.has("low") ? "low" : null,
		medium: values.has("medium") ? "medium" : null,
		high: values.has("high") ? "high" : null,
		xhigh: values.has("xhigh") ? "xhigh" : values.has("max") ? "max" : null,
	};
}

function identityFromMeta(
	model: ProviderModelConfig,
	meta: ModelsDevModel,
): ModelIdentity {
	return {
		id: [model.id, meta.id, meta.family, meta.provider]
			.filter(Boolean)
			.join(" "),
		name: [model.name, meta.name].filter(Boolean).join(" "),
		family: meta.family,
		provider: meta.provider,
	};
}

function mergeCompat(
	existing: ProviderModelConfig["compat"],
	derived: ProviderModelConfig["compat"],
): ProviderModelConfig["compat"] | undefined {
	if (!existing) return derived;
	if (!derived) return existing;
	return { ...(derived as ModelCompat), ...(existing as ModelCompat) };
}

export interface ModelsDevEnrichmentOptions {
	/** Provider id to scope models.dev lookup. Omit to search all providers. */
	providerId?: string;
	/** Values treated as provider defaults and safe to replace from models.dev. */
	fallbackContextWindows?: number[];
	fallbackMaxTokens?: number[];
	/** Fill image modality when the provider exposed text-only fallback. */
	enrichInput?: boolean;
	/** Fill reasoning flag and effort map from models.dev. */
	enrichReasoning?: boolean;
	/** Fill cost only when explicitly enabled and current cost is all-zero fallback. */
	enrichCost?: "never" | "fallback-only";
	/** Add model/family compat without overwriting existing compat keys. */
	enrichCompat?: boolean;
}

/**
 * Fill Pi-usable model fields from models.dev when provider APIs only expose
 * generic defaults. Fail-open: network/API failures leave models unchanged.
 */
export async function enrichModelsWithModelsDev<T extends ProviderModelConfig>(
	models: T[],
	options: ModelsDevEnrichmentOptions = {},
): Promise<Array<T & ModelsDevEnrichedMetadata>> {
	if (models.length === 0) return models;

	let meta: Record<string, ModelsDevModel>;
	try {
		meta = await fetchModelsDevMeta(options.providerId);
	} catch {
		return models;
	}
	if (Object.keys(meta).length === 0) return models;

	const index = buildModelMetaIndex(meta);
	const fallbackContextWindows = new Set(
		options.fallbackContextWindows ?? [DEFAULT_CONTEXT_WINDOW, 4096],
	);
	const fallbackMaxTokens = new Set(
		options.fallbackMaxTokens ?? [DEFAULT_MAX_TOKENS, 4096],
	);
	const enrichInput = options.enrichInput ?? true;
	const enrichReasoning = options.enrichReasoning ?? true;
	const enrichCost = options.enrichCost ?? "never";
	const enrichCompat = options.enrichCompat ?? true;

	try {
		return models.map((model) => {
			const modelMeta = findModelDevMeta(index, model.id);
			if (!modelMeta) return model;

			const contextWindow =
				modelMeta.limit && fallbackContextWindows.has(model.contextWindow)
					? modelMeta.limit.context
					: model.contextWindow;
			const maxTokens =
				modelMeta.limit && fallbackMaxTokens.has(model.maxTokens)
					? modelMeta.limit.output
					: model.maxTokens;
			const input =
				enrichInput &&
				isTextOnly(model.input) &&
				modelMeta.modalities?.input?.includes("image")
					? (["text", "image"] as const)
					: model.input;
			const reasoning =
				enrichReasoning && modelMeta.reasoning === true
					? true
					: model.reasoning;
			const thinkingLevelMap =
				enrichReasoning && model.thinkingLevelMap === undefined
					? thinkingMapFromReasoningOptions(modelMeta.reasoning_options)
					: model.thinkingLevelMap;
			const cost =
				enrichCost === "fallback-only" && costLooksLikeFallback(model.cost)
					? (costFromModelsDev(modelMeta.cost) ?? model.cost)
					: model.cost;
			const compat = enrichCompat
				? mergeCompat(
						model.compat,
						getProxyModelCompat(identityFromMeta(model, modelMeta)),
					)
				: model.compat;

			const modelsDevMetadata: ModelMatchHints = {
				id: modelMeta.id,
				name: modelMeta.name,
				...(modelMeta.family ? { family: modelMeta.family } : {}),
				...(modelMeta.provider ? { provider: modelMeta.provider } : {}),
			};

			return {
				...model,
				contextWindow,
				maxTokens,
				input,
				reasoning,
				...(thinkingLevelMap ? { thinkingLevelMap } : {}),
				cost,
				...(compat ? { compat } : {}),
				modelsDev: modelsDevMetadata,
			};
		});
	} catch {
		return models;
	}
}

export async function safeEnrichModelsWithModelsDev<
	T extends ProviderModelConfig,
>(
	models: T[],
	options: ModelsDevEnrichmentOptions = {},
): Promise<Array<T & ModelsDevEnrichedMetadata>> {
	try {
		return await enrichModelsWithModelsDev(models, options);
	} catch {
		return models;
	}
}
