/**
 * Dynamic Model Index - Hierarchical model matching without hardcoded patterns
 *
 * Priority order:
 * 1. Exact same model ID on different provider
 * 2. Same provider, similar model (same family)
 * 3. User's preferred_models from config
 * 4. Same model family across other providers
 * 5. Any available model (last resort)
 */

import type { ProviderModelConfig } from "@mariozechner/pi-coding-agent";

// Pi's registry models include provider field
type ModelWithProvider = ProviderModelConfig & { provider: string };

export interface IndexedModel extends ModelWithProvider {
	// Additional metadata for matching
	tokens: string[]; // Tokenized model ID for fuzzy matching
	family: string; // Extracted family name
}

// Track exhausted (provider, model) pairs
const exhaustedPairs = new Map<
	string,
	{ exhaustedAt: number; cooldownMs: number }
>();
const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Smart model ID tokenization
 * Extracts meaningful parts for matching
 */
export function tokenizeModelId(id: string): string[] {
	// Normalize: lowercase, remove common prefixes/suffixes
	let normalized = id.toLowerCase();

	// Remove provider-specific prefixes
	const providerPrefixes = [
		/^accounts\/[^/]+\/models\//, // Fireworks: accounts/fireworks/models/
		/^[^/]+\//, // Provider prefixes like openrouter/, kilo/, etc.
	];
	for (const prefix of providerPrefixes) {
		normalized = normalized.replace(prefix, "");
	}

	// Remove common suffixes
	normalized = normalized
		.replace(/-instruct$/, "")
		.replace(/-chat$/, "")
		.replace(/-preview$/, "")
		.replace(/-free$/, "")
		.replace(/-pro$/, "")
		.replace(/-flash$/, "")
		.replace(/-latest$/, "");

	// Tokenize by separators
	const tokens = normalized
		.split(/[-_/:]+/)
		.filter((t) => t.length > 0 && !/^\d{8}$/.test(t)); // Skip date tokens

	return tokens;
}

/**
 * Extract model family from tokens
 * Looks for: name + size pattern, or version numbers
 */
export function extractFamily(tokens: string[]): string {
	// Look for name + size pattern (e.g., "llama", "3.3", "70b")
	const sizeIndex = tokens.findIndex((t) => /^\d+(\.\d+)?[bkm]$/i.test(t));
	if (sizeIndex > 0) {
		// Include name parts + size
		return tokens.slice(0, sizeIndex + 1).join("-");
	}

	// Look for version pattern (e.g., "deepseek", "v3", "r1")
	const versionIndex = tokens.findIndex((t) =>
		/^(v\d+|r\d+|\d+\.\d+)$/.test(t),
	);
	if (versionIndex > 0) {
		return tokens.slice(0, versionIndex + 1).join("-");
	}

	// Fallback: first 2-3 meaningful tokens
	const meaningful = tokens.filter((t) => t.length > 1 && !/^\d+$/.test(t));
	return meaningful.slice(0, 3).join("-");
}

/**
 * Calculate similarity score between two models
 * Higher = more similar
 */
export function calculateSimilarity(
	modelA: { id: string; tokens: string[]; family: string },
	modelB: { id: string; tokens: string[]; family: string },
): number {
	let score = 0;

	// Exact family match (e.g., both are "llama-3.3-70b")
	if (modelA.family === modelB.family) {
		score += 100;
	}

	// Partial family overlap
	const familyTokensA = modelA.family.split("-");
	const familyTokensB = modelB.family.split("-");
	const familyOverlap = familyTokensA.filter((t) =>
		familyTokensB.includes(t),
	).length;
	score += familyOverlap * 20;

	// Token overlap (exact ID parts)
	const tokenOverlap = modelA.tokens.filter((t) =>
		modelB.tokens.includes(t),
	).length;
	score += tokenOverlap * 10;

	// Same base name (first token)
	if (modelA.tokens[0] === modelB.tokens[0]) {
		score += 15;
	}

	return score;
}

/**
 * Build searchable model index from available models
 */
export function buildModelIndex(
	availableModels: ModelWithProvider[],
): Map<string, IndexedModel> {
	const index = new Map<string, IndexedModel>();

	for (const model of availableModels) {
		const tokens = tokenizeModelId(model.id);
		const family = extractFamily(tokens);

		const indexed: IndexedModel = {
			...model,
			tokens,
			family,
		};

		index.set(`${model.provider}:${model.id}`, indexed);
	}

	return index;
}

/**
 * Mark a (provider, model) pair as exhausted
 */
export function markExhausted(
	provider: string,
	modelId: string,
	cooldownMs: number = DEFAULT_COOLDOWN_MS,
): void {
	const key = `${provider}:${modelId}`;
	exhaustedPairs.set(key, { exhaustedAt: Date.now(), cooldownMs });

	// Cleanup old entries periodically
	if (exhaustedPairs.size > 50) {
		const now = Date.now();
		for (const [k, v] of exhaustedPairs) {
			if (now - v.exhaustedAt > v.cooldownMs) {
				exhaustedPairs.delete(k);
			}
		}
	}
}

/**
 * Check if a (provider, model) pair is currently exhausted
 */
export function isExhausted(provider: string, modelId: string): boolean {
	const key = `${provider}:${modelId}`;
	const state = exhaustedPairs.get(key);
	if (!state) return false;

	const stillExhausted = Date.now() - state.exhaustedAt < state.cooldownMs;
	if (!stillExhausted) {
		exhaustedPairs.delete(key);
	}
	return stillExhausted;
}

/**
 * Find next hop target using hierarchical matching
 *
 * Priority:
 * 1. Same model ID, different provider
 * 2. Same provider, similar model
 * 3. User's preferred models (if configured)
 * 4. Same family, different provider
 * 5. Similar models by score
 */
export function findNextHop(
	currentProvider: string,
	currentModelId: string,
	availableModels: ModelWithProvider[],
	userPreferences?: {
		preferredModels?: string[];
		isPaidMode?: boolean;
	},
): ModelWithProvider | null {
	const index = buildModelIndex(availableModels);
	const currentKey = `${currentProvider}:${currentModelId}`;
	const current = index.get(currentKey);

	if (!current) return null;

	const candidates: Array<{
		model: ModelWithProvider;
		priority: number;
		reason: string;
	}> = [];

	for (const [key, model] of index) {
		if (key === currentKey) continue; // Skip current
		if (isExhausted(model.provider, model.id)) continue; // Skip exhausted

		// Check free mode - only include truly free models (cost.input === 0)
		// Models with undefined/missing cost are assumed free for failover
		const inputCost = model.cost?.input ?? 0;
		if (!userPreferences?.isPaidMode && inputCost > 0) continue;

		// Priority 1: Same model ID, different provider
		if (model.id === currentModelId) {
			candidates.push({
				model,
				priority: 1,
				reason: "same-model-different-provider",
			});
			continue;
		}

		// Priority 2: Same provider, similar model (same family)
		if (model.provider === currentProvider && model.family === current.family) {
			candidates.push({
				model,
				priority: 2,
				reason: "same-provider-similar-model",
			});
			continue;
		}

		// Priority 3: User's preferred models
		if (userPreferences?.preferredModels?.length) {
			const isPreferred = userPreferences.preferredModels.some(
				(pref) =>
					model.family.includes(pref.toLowerCase()) ||
					model.name.toLowerCase().includes(pref.toLowerCase()) ||
					model.id.toLowerCase().includes(pref.toLowerCase()),
			);
			if (isPreferred) {
				candidates.push({
					model,
					priority: 3,
					reason: "user-preferred",
				});
				continue;
			}
		}

		// Priority 4: Same family, different provider
		if (model.family === current.family) {
			candidates.push({
				model,
				priority: 4,
				reason: "same-family",
			});
			continue;
		}

		// Priority 5: Calculate similarity score
		const score = calculateSimilarity(current, model);
		if (score > 30) {
			// Threshold for "similar enough"
			candidates.push({
				model,
				priority: 5 + Math.floor(100 - score) / 10, // Lower priority for lower scores
				reason: "similar-model",
			});
		}
	}

	// Sort by priority, then by cost (cheaper first)
	candidates.sort((a, b) => {
		if (a.priority !== b.priority) return a.priority - b.priority;
		return a.model.cost.input - b.model.cost.input;
	});

	return candidates[0]?.model ?? null;
}

/**
 * Get alternative models ranked by preference
 * Returns up to N alternatives - simply find free models from different providers
 */
export function getRankedAlternatives(
	currentProvider: string,
	_currentModelId: string,
	availableModels: ModelWithProvider[],
	userPreferences?: {
		preferredModels?: string[];
		isPaidMode?: boolean;
	},
	maxResults: number = 5,
): Array<{ model: ModelWithProvider; reason: string }> {
	const results: Array<{ model: ModelWithProvider; reason: string }> = [];

	// Simple: just return free models from different providers
	for (const model of availableModels) {
		if (results.length >= maxResults) break;
		if (model.provider === currentProvider) continue;

		// Only include free models
		const inputCost = (model as any).cost?.input ?? 0;
		if (!userPreferences?.isPaidMode && inputCost > 0) continue;

		results.push({ model, reason: "free-alternative" });
	}

	return results;
}
