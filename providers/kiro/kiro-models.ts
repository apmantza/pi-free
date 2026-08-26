/**
 * Kiro bootstrap model catalog and management-cache integration.
 *
 * Simplified port of the reference implementation's models.ts.
 * Provides a static bootstrap catalog (~15 models, all free/zero-cost)
 * and a management-cache-based refresh mechanism.
 */
import { getKiroEndpoints, resolveApiRegion } from "./kiro-endpoints.js";
import { fetchKiroModelCatalog, type KiroCatalogModel, type KiroManagementAuth, type KiroListAvailableModelsResponse } from "./kiro-management.js";
import { getKiroEffortConfig, type KiroEffortConfig } from "./kiro-effort.js";
import type { Model, ThinkingLevelMap } from "@earendil-works/pi-ai";

const BASE_URL = getKiroEndpoints("us-east-1").runtime;
const ZERO_COST = Object.freeze({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

const OMP_THINKING_EFFORTS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type KiroThinkingEffort = (typeof OMP_THINKING_EFFORTS)[number];

export type KiroThinkingConfig = {
  mode: "effort";
  efforts: readonly KiroThinkingEffort[];
  supportsDisplay?: boolean;
};

export interface KiroModel extends Model<"kiro-api"> {
  kiroModelId: string;
  additionalModelRequestFieldsSchema?: Record<string, unknown>;
  tokenLimits?: { maxInputTokens?: number; maxOutputTokens?: number; [key: string]: unknown };
  firstTokenTimeout?: number;
  recoverTextToolCalls?: boolean;
  kiroRegion?: string;
  kiroProfileArn?: string;
  thinking?: KiroThinkingConfig;
  _pricingKnown?: boolean;
  _freeKnown?: boolean;
  _isFree?: boolean;
}

const bootstrapKiroModels: KiroModel[] = [
  {
    id: "claude-opus-4-8", kiroModelId: "claude-opus-4.8", name: "Claude Opus 4.8",
    api: "kiro-api", provider: "kiro", baseUrl: BASE_URL,
    reasoning: true, thinkingLevelMap: { xhigh: "xhigh", max: "max" },
    input: ["text", "image"], cost: ZERO_COST, contextWindow: 1000000, maxTokens: 128000, firstTokenTimeout: 180_000,
    _pricingKnown: true, _freeKnown: true, _isFree: true,
  },
  {
    id: "claude-opus-4-7", kiroModelId: "claude-opus-4.7", name: "Claude Opus 4.7",
    api: "kiro-api", provider: "kiro", baseUrl: BASE_URL,
    reasoning: true, thinkingLevelMap: { xhigh: "xhigh", max: "max" },
    input: ["text", "image"], cost: ZERO_COST, contextWindow: 1000000, maxTokens: 128000, firstTokenTimeout: 180_000,
    _pricingKnown: true, _freeKnown: true, _isFree: true,
  },
  {
    id: "claude-opus-4-6", kiroModelId: "claude-opus-4.6", name: "Claude Opus 4.6",
    api: "kiro-api", provider: "kiro", baseUrl: BASE_URL,
    reasoning: true, thinkingLevelMap: { max: "max" },
    input: ["text", "image"], cost: ZERO_COST, contextWindow: 1000000, maxTokens: 32768,
    _pricingKnown: true, _freeKnown: true, _isFree: true,
  },
  {
    id: "claude-sonnet-5", kiroModelId: "claude-sonnet-5", name: "Claude Sonnet 5",
    api: "kiro-api", provider: "kiro", baseUrl: BASE_URL,
    reasoning: true, thinkingLevelMap: { xhigh: "xhigh", max: "max" },
    input: ["text", "image"], cost: ZERO_COST, contextWindow: 1000000, maxTokens: 65536,
    _pricingKnown: true, _freeKnown: true, _isFree: true,
  },
  {
    id: "claude-sonnet-4-6", kiroModelId: "claude-sonnet-4.6", name: "Claude Sonnet 4.6",
    api: "kiro-api", provider: "kiro", baseUrl: BASE_URL,
    reasoning: true, thinkingLevelMap: { max: "max" },
    input: ["text", "image"], cost: ZERO_COST, contextWindow: 1000000, maxTokens: 65536,
    _pricingKnown: true, _freeKnown: true, _isFree: true,
  },
  {
    id: "claude-sonnet-4-5", kiroModelId: "claude-sonnet-4.5", name: "Claude Sonnet 4.5",
    api: "kiro-api", provider: "kiro", baseUrl: BASE_URL,
    reasoning: true, input: ["text", "image"], cost: ZERO_COST, contextWindow: 200000, maxTokens: 65536,
    _pricingKnown: true, _freeKnown: true, _isFree: true,
  },
  {
    id: "claude-sonnet-4", kiroModelId: "claude-sonnet-4", name: "Claude Sonnet 4",
    api: "kiro-api", provider: "kiro", baseUrl: BASE_URL,
    reasoning: true, input: ["text", "image"], cost: ZERO_COST, contextWindow: 200000, maxTokens: 65536,
    _pricingKnown: true, _freeKnown: true, _isFree: true,
  },
  {
    id: "claude-haiku-4-5", kiroModelId: "claude-haiku-4.5", name: "Claude Haiku 4.5",
    api: "kiro-api", provider: "kiro", baseUrl: BASE_URL,
    reasoning: false, input: ["text", "image"], cost: ZERO_COST, contextWindow: 200000, maxTokens: 65536,
    _pricingKnown: true, _freeKnown: true, _isFree: true,
  },
  {
    id: "claude-fable-5", kiroModelId: "claude-fable-5", name: "Claude Fable 5",
    api: "kiro-api", provider: "kiro", baseUrl: BASE_URL,
    reasoning: true, thinkingLevelMap: { xhigh: "xhigh", max: "max" },
    input: ["text", "image"], cost: ZERO_COST, contextWindow: 1000000, maxTokens: 65536,
    _pricingKnown: true, _freeKnown: true, _isFree: true,
  },
  {
    id: "deepseek-3-2", kiroModelId: "deepseek-3.2", name: "DeepSeek 3.2",
    api: "kiro-api", provider: "kiro", baseUrl: BASE_URL,
    reasoning: true, input: ["text"], cost: ZERO_COST, contextWindow: 164000, maxTokens: 8192,
    _pricingKnown: true, _freeKnown: true, _isFree: true,
  },
  {
    id: "minimax-m2-5", kiroModelId: "minimax-m2.5", name: "MiniMax M2.5",
    api: "kiro-api", provider: "kiro", baseUrl: BASE_URL,
    reasoning: false, input: ["text"], cost: ZERO_COST, contextWindow: 196000, maxTokens: 8192,
    _pricingKnown: true, _freeKnown: true, _isFree: true,
  },
  {
    id: "minimax-m2-1", kiroModelId: "minimax-m2.1", name: "MiniMax M2.1",
    api: "kiro-api", provider: "kiro", baseUrl: BASE_URL,
    reasoning: false, input: ["text"], cost: ZERO_COST, contextWindow: 196000, maxTokens: 8192,
    _pricingKnown: true, _freeKnown: true, _isFree: true,
  },
  {
    id: "glm-5", kiroModelId: "glm-5", name: "GLM 5",
    api: "kiro-api", provider: "kiro", baseUrl: BASE_URL,
    reasoning: true, input: ["text"], cost: ZERO_COST, contextWindow: 200000, maxTokens: 8192,
    _pricingKnown: true, _freeKnown: true, _isFree: true,
  },
  {
    id: "qwen3-coder-next", kiroModelId: "qwen3-coder-next", name: "Qwen3 Coder Next",
    api: "kiro-api", provider: "kiro", baseUrl: BASE_URL,
    reasoning: true, input: ["text"], cost: ZERO_COST, contextWindow: 256000, maxTokens: 8192,
    _pricingKnown: true, _freeKnown: true, _isFree: true,
  },
  {
    id: "auto", kiroModelId: "auto", name: "Auto",
    api: "kiro-api", provider: "kiro", baseUrl: BASE_URL,
    reasoning: true, input: ["text", "image"], cost: ZERO_COST, contextWindow: 1000000, maxTokens: 65536,
    _pricingKnown: true, _freeKnown: true, _isFree: true,
  },
];

// Derive effort configs and thinking for bootstrap models
export const kiroModels: KiroModel[] = bootstrapKiroModels.map((model) => {
  const effortConfig = model.reasoning ? getKiroEffortConfig(model.additionalModelRequestFieldsSchema, model.kiroModelId) : undefined;
  const thinking = deriveThinkingConfig(effortConfig);
  return {
    ...model,
    ...(thinking ? { thinking } : {}),
    ...(model.id.startsWith("claude-") ? { recoverTextToolCalls: false } : {}),
  };
});

export function deriveThinkingConfig(config: KiroEffortConfig | undefined): KiroThinkingConfig | undefined {
  if (!config || config.values.length === 0) return undefined;
  const efforts = OMP_THINKING_EFFORTS.filter((effort) => config.values.includes(effort));
  if (efforts.length === 0) return undefined;
  return { mode: "effort", efforts, ...(config.summarizedThinking ? { supportsDisplay: true } : {}) };
}

function toPiModelId(kiroModelId: string): string {
  return kiroModelId.replace(/(\d)\.(\d)/g, "$1-$2");
}

export function mapKiroCatalogModels(catalogModels: KiroCatalogModel[], region: string): KiroModel[] {
  if (catalogModels.length === 0) {
    throw new Error(`Kiro management catalog returned no models in ${region}`);
  }
  const seenPiIds = new Set<string>();
  return catalogModels.map((catalogModel) => {
    const kiroModelId = catalogModel.modelId;
    if (!kiroModelId || kiroModelId.trim() !== kiroModelId) {
      throw new Error(`Kiro management catalog returned an invalid model ID in ${region}`);
    }
    const id = toPiModelId(kiroModelId);
    if (seenPiIds.has(id)) {
      throw new Error(`Kiro management catalog contains conflicting model ID ${id} in ${region}`);
    }
    seenPiIds.add(id);
    const existing = kiroModels.find((model) => model.id === id);
    const catalogName = typeof catalogModel.displayName === "string" && catalogModel.displayName.length > 0
      ? catalogModel.displayName : undefined;
    return {
      id,
      kiroModelId,
      name: catalogName ?? existing?.name ?? id,
      api: "kiro-api",
      provider: "kiro",
      baseUrl: getKiroEndpoints(region).runtime,
      reasoning: existing?.reasoning ?? true,
      input: existing ? [...existing.input] : ["text"],
      recoverTextToolCalls: id.startsWith("claude-") ? false : undefined,
      cost: ZERO_COST,
      _pricingKnown: true,
      _freeKnown: true,
      _isFree: true,
      contextWindow: catalogModel.tokenLimits?.maxInputTokens ?? 200000,
      maxTokens: catalogModel.tokenLimits?.maxOutputTokens ?? 8192,
      ...(existing?.firstTokenTimeout ? { firstTokenTimeout: existing.firstTokenTimeout } : {}),
      ...(catalogModel.additionalModelRequestFieldsSchema ? { additionalModelRequestFieldsSchema: catalogModel.additionalModelRequestFieldsSchema as Record<string, unknown> } : {}),
      ...(catalogModel.tokenLimits ? { tokenLimits: catalogModel.tokenLimits } : {}),
    };
  });
}

export async function updateKiroModelsCache(accessToken: string, region: string, profileArn?: string): Promise<void> {
  const response = await fetchKiroModelCatalog({ accessToken, region }, profileArn);
  // We don't persist to a separate cache file - Pi's models store handles persistence
  // Instead, map the catalog models and return them through the refresh lifecycle
  const models = mapKiroCatalogModels(response.models, region);
  // Store in memory for the current session; Pi's store handles persistence
  _cachedModels[region] = { models, fetchedAt: Date.now() };
}

const _cachedModels: Record<string, { models: KiroModel[]; fetchedAt: number }> = {};

export function getCachedModels(region: string): KiroModel[] {
  return _cachedModels[region]?.models ?? kiroModels;
}

export function isCacheStale(region: string): boolean {
  const entry = _cachedModels[region];
  const CACHE_MAX_AGE_MS = 3600_000; // 1 hour
  return !entry || Date.now() - entry.fetchedAt > CACHE_MAX_AGE_MS;
}

export function resolveKiroModel(modelId: string, exactKiroModelId?: string): string {
  if (exactKiroModelId) return exactKiroModelId;
  const cachedModel = Object.values(_cachedModels).flatMap((entry) => entry.models).find((model) => model.id === modelId);
  if (cachedModel) return cachedModel.kiroModelId;
  const bootstrapModel = kiroModels.find((model) => model.id === modelId);
  if (bootstrapModel) return bootstrapModel.kiroModelId;
  const normalizedId = modelId.replace(/(\d)-(\d)/g, "$1.$2");
  return normalizedId;
}