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

export interface ModelsDevLimit {
	context: number;
	output: number;
}

export interface ModelsDevModalities {
	input?: string[];
	output?: string[];
}

export interface ModelsDevModel {
	id: string;
	name: string;
	reasoning: boolean;
	cost?: ModelsDevCost;
	limit: ModelsDevLimit;
	modalities?: ModelsDevModalities;
}

export interface ModelsDevProvider {
	id: string;
	api: string;
	models: Record<string, ModelsDevModel>;
}

// =============================================================================
// OpenRouter API response types
// =============================================================================

export interface OpenRouterPricing {
	prompt?: string | null;
	completion?: string | null;
	input_cache_write?: string | null;
	input_cache_read?: string | null;
}

export interface OpenRouterArchitecture {
	input_modalities?: string[] | null;
	output_modalities?: string[] | null;
}

export interface OpenRouterTopProvider {
	max_completion_tokens?: number | null;
}

export interface OpenRouterModel {
	id: string;
	name: string;
	context_length: number;
	max_completion_tokens?: number | null;
	pricing?: OpenRouterPricing;
	architecture?: OpenRouterArchitecture;
	top_provider?: OpenRouterTopProvider;
	supported_parameters?: string[];
}

// =============================================================================
// Zen gateway types
// =============================================================================

export interface ZenGatewayModel {
	id: string;
	object?: string;
}

// Test: LSP should handle new interface
export interface LspTestInterface {
	name: string;
	value: number;
	enabled: boolean;
}
