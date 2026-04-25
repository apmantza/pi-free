/**
 * Benchmark lookup logic — extracted from hardcoded-benchmarks.ts
 * for maintainability (the data file is ~10k lines of JSON-like entries).
 *
 * This module re-exports everything consumers currently import from
 * hardcoded-benchmarks, so you can switch imports to this file without
 * breaking anything.
 */

import {
	HARDCODED_BENCHMARKS,
	type HardcodedBenchmark,
} from "./hardcoded-benchmarks.ts";

// Re-export the type and data so callers can migrate imports here
export { HARDCODED_BENCHMARKS, type HardcodedBenchmark };

// =============================================================================
// Prefix fallback helpers
// =============================================================================

/**
 * Segments that indicate a variant of the same base model
 * (effort level, reasoning mode, date, preview) — NOT a fundamentally different model.
 * Used to filter prefix matches so we don't cross model boundaries
 * (e.g. gpt-4o → gpt-4o-mini is wrong, but gpt-4o → gpt-4o-aug-24 is fine).
 */
const VARIANT_QUALIFIER_SEGMENTS = new Set([
	"reasoning",
	"non-reasoning",
	"high",
	"low",
	"medium",
	"xhigh",
	"preview",
	"adaptive",
	"fast",
]);

/**
 * Check if a segment is a variant qualifier rather than a different model identifier.
 * Accepts effort levels, reasoning modes, date codes, size specifiers, and version numbers.
 */
function isVariantQualifier(segment: string): boolean {
	if (VARIANT_QUALIFIER_SEGMENTS.has(segment)) return true;
	// Date codes like "0528", "20250514"
	if (/^\d{4,8}$/.test(segment)) return true;
	// Month names (from date suffixes like "may-25", "mar-24")
	if (/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)$/.test(segment))
		return true;
	// Size specifiers like "70b", "8b", "a35b", "a3b" (MoE notation)
	if (/^a?\d+(\.\d+)?b$/i.test(segment)) return true;
	// Version numbers like "v3.2", "v2.5", "v1"
	if (/^v\d+(\.\d+)?$/.test(segment)) return true;
	// Two-digit year like "25", "24"
	if (/^\d{2}$/.test(segment)) return true;
	// Special variant suffixes
	if (segment === "speciale" || segment === "chatgpt" || segment === "latest")
		return true;
	return false;
}

/**
 * Normalize model ID by reordering size tokens to match AA convention.
 * Converts "70b-instruct" → "instruct-70b", "405b-chat" → "chat-405b".
 * AA uses instruct-70b order while providers often use 70b-instruct.
 */
function normalizeSizeTokenOrder(id: string): string {
	return id.replace(/(\d+(?:\.\d+)?b)-(instruct|chat)/gi, "$2-$1");
}

/**
 * Extract the base model ID from a provider model ID.
 * Strips ALL provider prefixes ("openai/", "@cf/meta/", "@cf/qwen/"), :free suffix, date suffixes, and version suffixes.
 */
function extractBaseModelId(modelId: string): string {
	return modelId
		.toLowerCase()
		.replace(/^.*\//, "") // Strip ALL path prefixes - keep only last segment
		.replace(/:free$/, "") // Strip :free suffix
		.replace(/-\d{8}$/, "") // Strip date suffixes like -20250514
		.replace(/-v\d+(\.\d+)?$/, "") // Strip version suffixes like -v1.1
		.replace(/-\d{3,}$/, "") // Strip numeric suffixes like -001, -2603
		.replace(/-it$/, "") // Strip -it suffix (Gemma convention for "instruct")
		.replace(/-fp\d+$/, "") // Strip -fp8, -fp16 suffixes
		.replace(/-bf\d+$/, "") // Strip -bf16 suffixes
		.trim();
}

/**
 * Find the best benchmark variant by prefix matching.
 * Given a base model ID, finds all benchmark keys that are variants of it
 * (same base model with effort/reasoning/date qualifiers) and returns the
 * variant with the highest codingIndex.
 */
function findBestVariantByPrefix(baseId: string): HardcodedBenchmark | null {
	const prefixKey = baseId + "-";
	const candidates: { key: string; data: HardcodedBenchmark }[] = [];

	for (const [key, data] of Object.entries(HARDCODED_BENCHMARKS) as [
		string,
		HardcodedBenchmark,
	][]) {
		// Exact match
		if (key === baseId) {
			if (data.codingIndex !== undefined) return data;
			continue;
		}

		// Prefix match: key starts with baseId + "-"
		if (key.startsWith(prefixKey)) {
			// Check that the first segment after the prefix is a qualifier
			// (prevents gpt-4o → gpt-4o-mini cross-model matches)
			const remainder = key.slice(prefixKey.length);
			const firstSegment = remainder.split("-")[0]!;
			if (isVariantQualifier(firstSegment)) {
				candidates.push({ key, data });
			}
		}
	}

	if (candidates.length === 0) return null;

	// Pick the candidate with the highest codingIndex
	// If tied or no CI, use normalizedScore as tiebreaker
	candidates.sort((a, b) => {
		const ciA = a.data.codingIndex ?? -1;
		const ciB = b.data.codingIndex ?? -1;
		if (ciB !== ciA) return ciB - ciA;
		return (b.data.normalizedScore ?? 0) - (a.data.normalizedScore ?? 0);
	});

	// Only return if the best candidate has a codingIndex
	if (candidates[0]!.data.codingIndex !== undefined) {
		return candidates[0]!.data;
	}

	return null;
}

// =============================================================================
// Main lookup
// =============================================================================

export function findHardcodedBenchmark(
	modelName: string,
	modelId: string,
): HardcodedBenchmark | null {
	const search = `${modelName} ${modelId}`.toLowerCase();

	// 1. Direct lookup — check if any benchmark key is a substring of the search
	for (const [key, data] of Object.entries(HARDCODED_BENCHMARKS) as [
		string,
		HardcodedBenchmark,
	][]) {
		if (search.includes(key.toLowerCase())) {
			return data;
		}
	}

	// 2. Variant matching — aliases for models with different naming conventions
	const variants: Record<string, string[]> = {
		"gpt-4o-aug-24": ["gpt-4o", "gpt-4-o"],
		"gpt-4": ["gpt-4", "gpt4"],
		"claude-3.5-sonnet-oct-24": [
			"claude-3.5-sonnet",
			"claude-3-5-sonnet",
			"sonnet-3.5",
		],
		"claude-3-opus": ["claude-3-opus", "opus-3"],
		"llama-3.1-instruct-405b": [
			"llama-3.1-405b",
			"llama3.1-405b",
			"llama-405b",
		],
		"llama-3.1-instruct-70b": ["llama-3.1-70b", "llama3.1-70b", "llama-70b"],
		"gemini-1.5-pro": ["gemini-1.5-pro", "gemini1.5-pro", "gemini-pro-1.5"],
		"qwen2.5-instruct-72b": ["qwen2.5-72b", "qwen-2.5-72b"],
		"deepseek-v3.2-non-reasoning": [
			"deepseek-v3",
			"deepseekv3",
			"deepseek-chat",
		],
		"mimo-v2-pro": ["mimo-v2-pro", "mimo-v2-pro-free", "mimo-pro"],
		"mimo-v2-omni": ["mimo-v2-omni", "mimo-v2-omni-free", "mimo-omni"],
		"mimo-v2-flash": ["mimo-v2-flash", "mimo-v2-flash-free", "mimo-flash"],
		"big-pickle": ["big-pickle", "bigpickle"],
		"minimax-m2.5": ["minimax-m2.5", "minimax-m2.5-free", "minimax-m25"],
		"nvidia-nemotron-3-super-120b-a12b-reasoning": [
			"nemotron-3-super",
			"nemotron-3-super-free",
			"nemotron-super",
			"nemotron-3",
		],
	};

	for (const [canonical, names] of Object.entries(variants)) {
		if (names.some((n) => search.includes(n.toLowerCase()))) {
			return HARDCODED_BENCHMARKS[canonical] || null;
		}
	}

	// 3. Prefix fallback — extract base model ID and find best variant
	//    Handles cases where benchmark keys have variant suffixes
	//    (reasoning/non-reasoning, effort levels, dates) that the model ID lacks
	const baseId = extractBaseModelId(modelId);
	if (baseId) {
		let best = findBestVariantByPrefix(baseId);
		if (best) return best;

		// 3b. Try with word-order normalization
		//     (e.g., llama-3.3-70b-instruct → llama-3.3-instruct-70b)
		const normalizedId = normalizeSizeTokenOrder(baseId);
		if (normalizedId !== baseId) {
			best = findBestVariantByPrefix(normalizedId);
			if (best) return best;
		}
	}

	return null;
}

/**
 * Get score from hardcoded data
 */
export function getHardcodedScore(
	modelName: string,
	modelId: string,
): number | null {
	const benchmark = findHardcodedBenchmark(modelName, modelId);
	return benchmark?.normalizedScore ?? null;
}

/**
 * Enhance model name with Coding Index score
 * Returns model name with CI score appended if available
 */
export function enhanceModelNameWithCodingIndex(
	modelName: string,
	modelId: string,
): string {
	const benchmark = findHardcodedBenchmark(modelName, modelId);
	if (benchmark?.codingIndex !== undefined) {
		return `${modelName} [CI: ${benchmark.codingIndex.toFixed(1)}]`;
	}
	return modelName;
}
