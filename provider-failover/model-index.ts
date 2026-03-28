/**
 * Model Index - Cross-provider model aggregation and family grouping
 * Builds an index of all available models grouped by model family
 */

import type { ProviderModelConfig } from "@mariozechner/pi-coding-agent";

// Pi's registry models include provider field
type ModelWithProvider = ProviderModelConfig & { provider: string };

export interface IndexedModel {
	provider: string;
	id: string;
	name: string;
	cost: {
		input: number;
		output: number;
		cacheRead?: number;
		cacheWrite?: number;
	};
	contextWindow: number;
	maxTokens: number;
	reasoning: boolean;
	input: ("text" | "image")[];
}

export interface ModelFamily {
	family: string; // Normalized family name (e.g., "llama-3.3-70b")
	variants: IndexedModel[]; // Same model from different providers
}

// Model family extraction patterns
const MODEL_FAMILY_PATTERNS = [
	// DeepSeek
	{ pattern: /deepseek[-_]?(v3|r1|v3\.1|v3\.2)/i, family: "deepseek-$1" },
	// Llama
	{
		pattern: /llama[-_]?(3\.?3|3\.?1|3|2)[-_]?(70b|405b|8b|7b|13b)/i,
		family: "llama-$1-$2",
	},
	// Qwen
	{
		pattern: /qwen[-_]?(2\.?5|2|3)[-_]?(72b|32b|14b|7b)/i,
		family: "qwen-$1-$2",
	},
	// Mixtral
	{ pattern: /mixtral[-_]?(8x22b|8x7b)/i, family: "mixtral-$1" },
	// GPT/Claude direct matches
	{ pattern: /(gpt-4|gpt-3\.5|claude-3|claude-2)/i, family: "$1" },
	// Kimi
	{ pattern: /kimi[-_]?(k2|k1\.5)/i, family: "kimi-$1" },
	// Gemini
	{
		pattern: /gemini[-_]?(1\.5|2|2\.5)[-_]?(pro|flash|ultra)/i,
		family: "gemini-$1-$2",
	},
];

/**
 * Extract normalized model family from model ID or name
 */
export function extractModelFamily(
	modelId: string,
	modelName: string,
): string | null {
	const searchText = `${modelId} ${modelName}`;

	for (const { pattern, family } of MODEL_FAMILY_PATTERNS) {
		const match = searchText.match(pattern);
		if (match) {
			// Replace $1, $2 with captured groups
			let result = family;
			match.forEach((group, index) => {
				if (index > 0) {
					result = result.replace(`$${index}`, group.toLowerCase());
				}
			});
			return result.toLowerCase().replace(/[\s_]+/g, "-");
		}
	}

	return null;
}

/**
 * Build model index from all registered providers
 */
export function buildModelIndex(
	allModels: ModelWithProvider[],
	availableModels: ModelWithProvider[],
): Map<string, ModelFamily> {
	const index = new Map<string, ModelFamily>();

	for (const model of allModels) {
		const family = extractModelFamily(model.id, model.name);
		if (!family) continue;

		// Check if this model is available (has auth)
		const isAvailable = availableModels.some(
			(m) => m.provider === model.provider && m.id === model.id,
		);

		if (!isAvailable) continue;

		const indexedModel: IndexedModel = {
			provider: model.provider,
			id: model.id,
			name: model.name,
			cost: model.cost,
			contextWindow: model.contextWindow,
			maxTokens: model.maxTokens,
			reasoning: model.reasoning,
			input: model.input,
		};

		if (index.has(family)) {
			index.get(family)!.variants.push(indexedModel);
		} else {
			index.set(family, { family, variants: [indexedModel] });
		}
	}

	return index;
}

/**
 * Get all alternative providers for a given model
 */
export function getModelAlternatives(
	modelIndex: Map<string, ModelFamily>,
	currentProvider: string,
	modelId: string,
	modelName: string,
	isPaidMode: boolean,
	exhaustedPairs: Set<string>,
): IndexedModel[] {
	const family = extractModelFamily(modelId, modelName);
	if (!family) return [];

	const modelFamily = modelIndex.get(family);
	if (!modelFamily) return [];

	return modelFamily.variants
		.filter((m) => m.provider !== currentProvider) // Exclude current
		.filter((m) => isPaidMode || m.cost.input === 0) // Respect free mode
		.filter((m) => !exhaustedPairs.has(`${m.provider}:${m.id}`)) // Exclude exhausted
		.sort((a, b) => a.cost.input - b.cost.input); // Prefer cheaper
}

/**
 * Find model by family name in index
 */
export function findModelByFamily(
	modelIndex: Map<string, ModelFamily>,
	family: string,
): IndexedModel | null {
	const normalizedFamily = family.toLowerCase().replace(/[\s_]+/g, "-");
	const modelFamily = modelIndex.get(normalizedFamily);

	if (!modelFamily || modelFamily.variants.length === 0) return null;

	// Return cheapest available
	return modelFamily.variants.sort((a, b) => a.cost.input - b.cost.input)[0];
}
