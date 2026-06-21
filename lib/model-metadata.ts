import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { DEFAULT_FETCH_TIMEOUT_MS, URL_MODELS_DEV } from "../constants.ts";
import { createLogger } from "./logger.ts";
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
const MODELS_DEV_CACHE_TTL_MS = 5 * 60 * 1000;
const MODELS_DEV_RETRIES = 3;
const MODELS_DEV_RETRY_DELAY_MS = 250;
const MODELS_DEV_PROVIDER_ALIASES: Record<string, string> = {
	together: "togetherai",
	novita: "novita-ai",
};

const _logger = createLogger("model-metadata");

type ThinkingLevelMap = NonNullable<ProviderModelConfig["thinkingLevelMap"]>;
type ModelCompat = NonNullable<ProviderModelConfig["compat"]>;

let catalogCache:
	| {
			expiresAt: number;
			promise: Promise<Record<string, ModelsDevProvider>>;
	  }
	| undefined;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export function clearModelsDevMetaCache(): void {
	catalogCache = undefined;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function fetchModelsDevCatalog(): Promise<
	Record<string, ModelsDevProvider>
> {
	let lastError: unknown;

	for (let attempt = 1; attempt <= MODELS_DEV_RETRIES; attempt++) {
		try {
			const response = await fetch(URL_MODELS_DEV, {
				headers: { "User-Agent": "pi-free-providers" },
				signal: AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS),
			});
			if (response.ok) {
				return (await response.json()) as Record<string, ModelsDevProvider>;
			}

			lastError = new Error(
				`HTTP ${response.status} ${response.statusText}`.trim(),
			);
		} catch (error) {
			lastError = error;
		}

		if (attempt < MODELS_DEV_RETRIES) {
			await sleep(MODELS_DEV_RETRY_DELAY_MS);
		}
	}

	_logger.warn("Failed to fetch models.dev metadata", {
		error: errorMessage(lastError),
	});
	return {};
}

function getModelsDevCatalog(): Promise<Record<string, ModelsDevProvider>> {
	const now = Date.now();
	if (catalogCache && catalogCache.expiresAt > now) {
		return catalogCache.promise;
	}

	const promise = fetchModelsDevCatalog().catch((error) => {
		catalogCache = undefined;
		_logger.warn("Failed to load models.dev metadata", {
			error: errorMessage(error),
		});
		return {};
	});
	catalogCache = {
		expiresAt: now + MODELS_DEV_CACHE_TTL_MS,
		promise,
	};
	return promise;
}

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

function hasModels(
	models: Record<string, ModelsDevModel> | undefined,
): models is Record<string, ModelsDevModel> {
	return models !== undefined && Object.keys(models).length > 0;
}

function findProviderModels(
	catalog: Record<string, ModelsDevProvider>,
	providerId: string,
): Record<string, ModelsDevModel> | undefined {
	const ids = new Set(
		[providerId, MODELS_DEV_PROVIDER_ALIASES[providerId]].filter(
			(id): id is string => Boolean(id),
		),
	);

	for (const id of ids) {
		const directModels = catalog[id]?.models;
		if (hasModels(directModels)) return directModels;
	}

	for (const provider of Object.values(catalog)) {
		if (provider?.id && ids.has(provider.id) && hasModels(provider.models)) {
			return provider.models;
		}
	}

	return undefined;
}

export async function fetchModelsDevMeta(
	providerId?: string,
): Promise<Record<string, ModelsDevModel>> {
	const catalog = await getModelsDevCatalog();
	if (providerId) {
		const scopedModels = findProviderModels(catalog, providerId);
		if (scopedModels) return scopedModels;
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

interface EnrichmentContext {
	index: Map<string, ModelsDevModel>;
	fallbackContextWindows: Set<number>;
	fallbackMaxTokens: Set<number>;
	enrichInput: boolean;
	enrichReasoning: boolean;
	enrichCost: "never" | "fallback-only";
	enrichCompat: boolean;
}

function enrichModel<T extends ProviderModelConfig>(
	model: T,
	ctx: EnrichmentContext,
): T & ModelsDevEnrichedMetadata {
	const modelMeta = findModelDevMeta(ctx.index, model.id);
	if (!modelMeta) return model;

	const contextWindow =
		modelMeta.limit && ctx.fallbackContextWindows.has(model.contextWindow)
			? modelMeta.limit.context
			: model.contextWindow;
	const maxTokens =
		modelMeta.limit && ctx.fallbackMaxTokens.has(model.maxTokens)
			? modelMeta.limit.output
			: model.maxTokens;
	const input =
		ctx.enrichInput &&
		isTextOnly(model.input) &&
		modelMeta.modalities?.input?.includes("image")
			? (["text", "image"] as const)
			: model.input;
	const reasoning =
		ctx.enrichReasoning && modelMeta.reasoning === true
			? true
			: model.reasoning;
	const thinkingLevelMap =
		ctx.enrichReasoning && model.thinkingLevelMap === undefined
			? thinkingMapFromReasoningOptions(modelMeta.reasoning_options)
			: model.thinkingLevelMap;
	const cost =
		ctx.enrichCost === "fallback-only" && costLooksLikeFallback(model.cost)
			? (costFromModelsDev(modelMeta.cost) ?? model.cost)
			: model.cost;
	const compat = ctx.enrichCompat
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
	} catch (error) {
		_logger.warn("Failed to load models.dev metadata", {
			providerId: options.providerId,
			error: errorMessage(error),
		});
		return models;
	}
	if (Object.keys(meta).length === 0) return models;

	const ctx: EnrichmentContext = {
		index: buildModelMetaIndex(meta),
		fallbackContextWindows: new Set(
			options.fallbackContextWindows ?? [DEFAULT_CONTEXT_WINDOW, 4096],
		),
		fallbackMaxTokens: new Set(
			options.fallbackMaxTokens ?? [DEFAULT_MAX_TOKENS, 4096],
		),
		enrichInput: options.enrichInput ?? true,
		enrichReasoning: options.enrichReasoning ?? true,
		enrichCost: options.enrichCost ?? "never",
		enrichCompat: options.enrichCompat ?? true,
	};

	return models.map((model) => {
		try {
			return enrichModel(model, ctx);
		} catch (error) {
			_logger.warn("Failed to enrich model from models.dev metadata", {
				modelId: model.id,
				error: errorMessage(error),
			});
			return model;
		}
	});
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
