/**
 * Model detection utilities for pi-free-providers.
 * Extracts and adapts model family detection from pi-models.
 * Used for failover when providers hit rate limits.
 */

import type { Model } from "@earendil-works/pi-ai";
import type { ProviderModelConfig } from "./types.ts";

export interface ModelInfo {
	id: string;
	name?: string;
	provider: string;
	isFree: boolean;
	inputCost: number;
	outputCost: number;
}

export interface ModelFamily {
	id: string; // Normalized family ID (e.g., "claude-sonnet")
	displayName: string; // Human readable (e.g., "Claude Sonnet")
	models: ModelInfo[]; // All models in this family
}

/**
 * Convert Pi's Model type to ModelInfo for internal use
 */
export function toModelInfo(model: Model<any>): ModelInfo {
	return {
		id: model.id,
		name: model.name,
		provider: model.provider,
		isFree: !model.cost || (model.cost.input === 0 && model.cost.output === 0),
		inputCost: model.cost?.input ?? 0,
		outputCost: model.cost?.output ?? 0,
	};
}

/**
 * Convert ProviderModelConfig to ModelInfo for internal use
 */
export function toProviderModelInfo(model: ProviderModelConfig): ModelInfo {
	return {
		id: model.id,
		name: model.name,
		provider: "", // Will be set by caller
		isFree: !model.cost || (model.cost.input === 0 && model.cost.output === 0),
		inputCost: model.cost?.input ?? 0,
		outputCost: model.cost?.output ?? 0,
	};
}

// =============================================================================
// Shared helpers for model family detection
// =============================================================================

const VERSION_RE = /^v?\d+(\.\d+)?$/;
const ROUTER_RE = /\b(?:router|auto)\b/;
const SKIP_PARTS = new Set([
	"latest",
	"preview",
	"rc",
	"beta",
	"alpha",
	"dev",
	"free",
]);

interface BrandMapping {
	keywords: string[];
	familyId: string;
	familyName: string;
}

const BRAND_MAPPINGS: BrandMapping[] = [
	{ keywords: ["claude"], familyId: "claude", familyName: "Claude" },
	{ keywords: ["deepseek"], familyId: "deepseek", familyName: "DeepSeek" },
	{ keywords: ["gemini"], familyId: "gemini", familyName: "Gemini" },
	{ keywords: ["gpt"], familyId: "gpt", familyName: "GPT" },
	{ keywords: ["llama"], familyId: "llama", familyName: "Llama" },
	{ keywords: ["minimax"], familyId: "minimax", familyName: "MiniMax" },
	{ keywords: ["qwen"], familyId: "qwen", familyName: "Qwen" },
	{ keywords: ["nemotron"], familyId: "nemotron", familyName: "Nemotron" },
	{ keywords: ["kimi", "moonshot"], familyId: "kimi", familyName: "Kimi" },
	{ keywords: ["glm", "chatglm"], familyId: "glm", familyName: "GLM" },
	{ keywords: ["mistral"], familyId: "mistral", familyName: "Mistral" },
	{ keywords: ["arcee", "trinity"], familyId: "arcee", familyName: "Arcee" },
	{ keywords: ["o1", "o3"], familyId: "openai-o", familyName: "OpenAI o" },
];

const PROVIDER_MAPPINGS: Record<
	string,
	{ familyId: string; familyName: string }
> = {
	minimax: { familyId: "minimax", familyName: "MiniMax" },
	minimaxai: { familyId: "minimax", familyName: "MiniMax" },
	deepseek: { familyId: "deepseek", familyName: "DeepSeek" },
	nvidia: { familyId: "nemotron", familyName: "Nemotron" },
	moonshot: { familyId: "kimi", familyName: "Kimi" },
	zhipu: { familyId: "glm", familyName: "GLM" },
};

function capitalize(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}

function findBrandInText(
	text: string,
): { familyId: string; familyName: string } | null {
	for (const mapping of BRAND_MAPPINGS) {
		for (const keyword of mapping.keywords) {
			if (text.includes(keyword)) {
				return { familyId: mapping.familyId, familyName: mapping.familyName };
			}
		}
	}
	return null;
}

function findBrandInParts(
	parts: string[],
): { familyId: string; familyName: string } | null {
	for (const part of parts) {
		const result = findBrandInText(part);
		if (result) return result;
	}
	return null;
}

/**
 * Detect the model family from a model's ID or name.
 * Returns the family ID and display name.
 */
export function detectModelFamily(
	model: ModelInfo,
): { familyId: string; familyName: string } | null {
	const id = model.id.toLowerCase();
	const name = (model.name || "").toLowerCase();
	const fullText = `${id} ${name}`;

	// Router models (gateways to free models) - group into "other"
	if (ROUTER_RE.test(fullText) || id === "kilo-auto/free") {
		return { familyId: "other", familyName: "Other" };
	}

	// Known brand keywords in full text
	const brandFromText = findBrandInText(fullText);
	if (brandFromText) return brandFromText;

	// Provider-specific fallbacks for models without brand in ID/name
	const providerResult = PROVIDER_MAPPINGS[model.provider];
	if (providerResult) return providerResult;

	// Fallback: try to identify brand from model ID structure
	const parts = id.split(/[-_:.@]/);
	const firstPart = parts[0];

	const brandFromParts = findBrandInParts(parts);
	if (brandFromParts) return brandFromParts;

	// Use first part as brand if it looks brand-like
	if (firstPart && !VERSION_RE.test(firstPart)) {
		return { familyId: firstPart, familyName: capitalize(firstPart) };
	}

	// First non-version, non-skip part
	const nonVersion = parts.find(
		(p) => p && !VERSION_RE.test(p) && !SKIP_PARTS.has(p),
	);
	if (nonVersion) {
		return { familyId: nonVersion, familyName: capitalize(nonVersion) };
	}

	return {
		familyId: firstPart || id,
		familyName: capitalize(firstPart || id),
	};
}

/**
 * Normalize a model name for comparison by removing provider-specific suffixes
 * and common qualifiers. This helps detect when the same model is offered by
 * multiple providers with slightly different naming.
 *
 * Uses string operations instead of regex backtracking to avoid ReDoS warnings.
 */
export function normalizeModelName(name: string): string {
	const suffixes = ["(free)", "(cline)", "-free", "free"];
	let normalized = name.toLowerCase().trimEnd();

	// Remove common literal suffixes — simple string ops, no regex backtracking
	for (const suffix of suffixes) {
		while (normalized.endsWith(suffix)) {
			normalized = normalized.slice(0, -suffix.length).trimEnd();
		}
	}

	// CI score suffix — regex with disjoint char classes (linear)
	// Anchored with $, matches at most once → .replace() is correct (S4144 N/A)
	normalized = normalized.replace(/\(ci:\s*[\d.]+\)$/, "").trimEnd();
	normalized = normalized.replace(/\[ci:\s*[\d.]+\]$/, "").trimEnd();

	// Remove any trailing parenthetical — non-regex loop
	while (normalized.endsWith(")")) {
		const idx = normalized.lastIndexOf("(", normalized.length - 1);
		if (idx === -1) break;
		normalized = normalized.slice(0, idx).trimEnd();
	}

	return normalized.trim();
}

/**
 * Try to merge a model into another family if its normalized name
 * matches a model in a different family.
 */
function tryMergeFamily(
	byFamily: Map<string, ModelInfo[]>,
	nameToFamilyId: Map<string, string>,
	familyId: string,
	model: ModelInfo,
): boolean {
	const normalizedName = normalizeModelName(model.name || model.id);
	if (!normalizedName) return false;

	const existingFamilyForName = nameToFamilyId.get(normalizedName);
	if (!existingFamilyForName || existingFamilyForName === familyId) {
		nameToFamilyId.set(normalizedName, familyId);
		return false;
	}

	// Same model name found in different family - merge them
	const targetFamily = byFamily.get(existingFamilyForName);
	const sourceFamily = byFamily.get(familyId);
	if (!targetFamily || !sourceFamily) return false;

	targetFamily.push(...sourceFamily);
	byFamily.delete(familyId);
	return true;
}

/**
 * Build a sorted list of ModelFamily from a by-family grouping map.
 */
function buildFamiliesList(byFamily: Map<string, ModelInfo[]>): ModelFamily[] {
	const families: ModelFamily[] = [];
	for (const [id, familyModels] of byFamily) {
		const firstModel = familyModels[0]!;
		const familyInfo = detectModelFamily(firstModel)!;

		families.push({
			id,
			displayName: familyInfo.familyName,
			models: familyModels.sort(
				(a, b) =>
					a.provider.localeCompare(b.provider) || b.id.localeCompare(a.id),
			),
		});
	}

	return families.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/**
 * Get all model families from a list of models.
 * Groups models by family and merges same-name models across providers.
 */
export function getModelFamilies(models: ModelInfo[]): ModelFamily[] {
	const byFamily = new Map<string, ModelInfo[]>();
	const nameToFamilyId = new Map<string, string>();

	// First pass: group models by detected family
	for (const model of models) {
		const family = detectModelFamily(model);
		if (!family) continue;

		const existing = byFamily.get(family.familyId) ?? [];
		existing.push(model);
		byFamily.set(family.familyId, existing);
	}

	// Second pass: merge families whose models have the same normalized name
	const familyIds = [...byFamily.keys()];
	for (const familyId of familyIds) {
		const familyModels = byFamily.get(familyId);
		if (!familyModels) continue;

		for (const model of familyModels) {
			if (tryMergeFamily(byFamily, nameToFamilyId, familyId, model)) {
				break;
			}
		}
	}

	return buildFamiliesList(byFamily);
}
