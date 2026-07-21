/**
 * Shared types for pi-free-providers.
 * Interfaces duplicated across providers consolidated here.
 */

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
	name?: string;
	family?: string;
	provider?: string;
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

export interface ModelsDevCost {
	input: number;
	output: number;
	cache_read?: number;
	cache_write?: number;
}

export interface ModelsDevReasoningOption {
	type: "effort" | "toggle" | "budget_tokens";
	values?: string[];
	min?: number;
	max?: number;
}

export interface ModelsDevLimit {
	context: number;
	output: number;
}

export interface ModelsDevModalities {
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

