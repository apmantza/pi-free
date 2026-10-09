/**
 * Shared types for pi-free-providers.
 * Interfaces duplicated across providers consolidated here.
 */

import type { ProviderModelConfig as PiProviderModelConfig } from "@earendil-works/pi-coding-agent";
import type { AnyModel } from "@earendil-works/pi-ai/compat";

// =============================================================================
// Pi 1.x model-config union
// =============================================================================

/**
 * Chat member of Pi's ProviderModelConfig union (what pi-free registers).
 * Pi 1.x does not export the union members, so this is derived with Extract.
 */
export type ChatModelConfig = Extract<PiProviderModelConfig, { type?: "chat" }>;

/**
 * Pi 1.x split ProviderModelConfig into a chat/image/classifier union.
 * pi-free manages chat models; use this guard wherever a catalog entry's
 * chat-only fields (reasoning, contextWindow, maxTokens, compat,
 * thinkingLevelMap) are read. Chat entries carry `type: "chat"` or omit
 * `type` entirely, so untagged entries count as chat.
 */
export function isChatModelConfig(
	model: PiProviderModelConfig,
): model is ChatModelConfig {
	return model.type === undefined || model.type === "chat";
}

/**
 * Chat narrow for pi-ai runtime models (AnyModel union). Mirrors pi-ai's
 * own isModelType(model, "chat") without a static value import: eager
 * pi-ai/compat value imports cost ~1s of startup (#423), and this is one
 * line (untagged models are chat, per pi-ai's documented default).
 */
export function isChatModel(model: AnyModel): boolean {
	return (model.type ?? "chat") === "chat";
}

// =============================================================================
// Provider model configuration (matches Pi's ProviderModelConfig)
// =============================================================================

export interface CostConfig {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
}

export interface ModelIdentity {
	id: string;
	name?: string | undefined;
	family?: string | undefined;
	provider?: string | undefined;
}

export type ModelMatchHints = Partial<ModelIdentity>;

export interface ModelsDevEnrichedMetadata {
	modelsDev?: ModelMatchHints;
}

export interface ProviderModelConfig {
	id: string;
	name: string;
	reasoning: boolean;
	input: ("text" | "image")[];
	cost: CostConfig;
	contextWindow: number;
	maxTokens: number;
}

// =============================================================================
// models.dev schema types
// =============================================================================

interface ModelsDevCost {
	input: number;
	output: number;
	cache_read?: number;
	cache_write?: number;
}

interface ModelsDevReasoningOption {
	type: "effort" | "toggle" | "budget_tokens";
	values?: string[];
	min?: number;
	max?: number;
}

interface ModelsDevLimit {
	context: number;
	output: number;
}

interface ModelsDevModalities {
	input?: string[];
	output?: string[];
}

export interface ModelsDevModel extends ModelIdentity {
	name: string;
	reasoning: boolean;
	reasoning_options?: ModelsDevReasoningOption[];
	cost?: ModelsDevCost;
	limit: ModelsDevLimit;
	modalities?: ModelsDevModalities;
}

export interface ModelsDevProvider {
	id: string;
	api: string;
	models: Record<string, ModelsDevModel>;
}
