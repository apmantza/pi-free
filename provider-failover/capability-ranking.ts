/**
 * Model Capability Ranking
 * Ensures model hops don't silently downgrade to less capable models
 */

import type { ProviderModelConfig } from "@mariozechner/pi-coding-agent";
import {
	calculateBenchmarkedCapability,
	needsBenchmarkRefresh,
	updateBenchmarkCache,
} from "./benchmark-cache.ts";

export type CapabilityTier = "ultra" | "high" | "medium" | "low" | "minimal";

export interface ModelCapabilities {
	tier: CapabilityTier;
	score: number; // 0-100 numerical score
	contextWindow: number;
	reasoning: boolean;
	estimatedParams?: number; // In billions, extracted from name if possible
}

// Tier thresholds
const TIER_THRESHOLDS = {
	ultra: 85, // 400B+ params, 200k+ context, reasoning
	high: 70, // 70B+ params, 128k+ context
	medium: 50, // 30B+ params, 32k+ context
	low: 30, // 7B+ params, 16k+ context
	minimal: 0, // Everything else
};

// Capability bonuses/penalties
const CAPABILITY_SCORES = {
	contextPer1K: 0.05, // 0.05 points per 1k context window
	reasoning: 15, // +15 for reasoning capability
	paramsPerB: 0.5, // 0.5 points per billion params
	imageInput: 5, // +5 for vision capability
};

/**
 * Extract estimated parameter count from model name/ID
 */
export function extractParamCount(
	modelId: string,
	modelName: string,
): number | undefined {
	const searchText = `${modelId} ${modelName}`.toLowerCase();

	// Look for parameter indicators
	const patterns = [
		/(\d+(?:\.\d+)?)\s*[bt](?![a-z])/i, // 70b, 405b, 1.5t
		/(\d+)-billion/i, // 70-billion
		/(\d+(?:\.\d+)?)\s*billion/i, // 70 billion
	];

	for (const pattern of patterns) {
		const match = searchText.match(pattern);
		if (match) {
			let value = parseFloat(match[1]);
			// Check if it's actually a context window (too large for params)
			if (value > 1000) continue; // Likely context window like 128000
			if (match[0].includes("t")) value *= 1000; // Convert trillions to billions
			return value;
		}
	}

	return undefined;
}

/**
 * Calculate capability score and tier for a model
 * Uses real benchmark data if available, falls back to heuristics
 */
export function calculateCapability(
	model: ProviderModelConfig,
): ModelCapabilities {
	// Try to use real benchmark data first
	const benchmark = calculateBenchmarkedCapability(
		model.id,
		model.name,
		model.contextWindow,
		model.reasoning,
		model.input.includes("image"),
	);

	if (benchmark.score > 0) {
		return {
			tier: benchmark.tier as CapabilityTier,
			score: benchmark.score,
			contextWindow: model.contextWindow,
			reasoning: model.reasoning,
			estimatedParams: extractParamCount(model.id, model.name),
		};
	}

	// Fallback to heuristics
	let score = 0;

	// Context window contribution (max ~10 points for 200k)
	score += Math.min(
		(model.contextWindow / 1000) * CAPABILITY_SCORES.contextPer1K,
		10,
	);

	// Reasoning capability
	if (model.reasoning) {
		score += CAPABILITY_SCORES.reasoning;
	}

	// Vision capability
	if (model.input.includes("image")) {
		score += CAPABILITY_SCORES.imageInput;
	}

	// Parameter count (if extractable)
	const params = extractParamCount(model.id, model.name);
	if (params) {
		score += params * CAPABILITY_SCORES.paramsPerB;
	}

	// Determine tier based on score
	let tier: CapabilityTier = "minimal";
	if (score >= TIER_THRESHOLDS.ultra) tier = "ultra";
	else if (score >= TIER_THRESHOLDS.high) tier = "high";
	else if (score >= TIER_THRESHOLDS.medium) tier = "medium";
	else if (score >= TIER_THRESHOLDS.low) tier = "low";

	return {
		tier,
		score: Math.round(score),
		contextWindow: model.contextWindow,
		reasoning: model.reasoning,
		estimatedParams: params,
	};
}

/**
 * Check if target model is capability-downgrade from current
 */
export function isCapabilityDowngrade(
	current: ModelCapabilities,
	target: ModelCapabilities,
): { isDowngrade: boolean; severity: "major" | "minor" | "none" } {
	const tierOrder: CapabilityTier[] = [
		"ultra",
		"high",
		"medium",
		"low",
		"minimal",
	];
	const currentIdx = tierOrder.indexOf(current.tier);
	const targetIdx = tierOrder.indexOf(target.tier);

	// Same or higher tier = not a downgrade
	if (targetIdx <= currentIdx) {
		return { isDowngrade: false, severity: "none" };
	}

	// Calculate severity
	const tierDiff = targetIdx - currentIdx;
	const scoreDiff = current.score - target.score;

	if (tierDiff >= 2 || scoreDiff > 30) {
		return { isDowngrade: true, severity: "major" };
	}

	return { isDowngrade: true, severity: "minor" };
}

/**
 * Rank alternatives by capability preservation
 * Returns models grouped by whether they preserve capability
 */
export function rankByCapability(
	current: ProviderModelConfig,
	alternatives: Array<ProviderModelConfig & { provider?: string }>,
): {
	equalOrBetter: Array<
		ProviderModelConfig & { provider?: string; capabilities: ModelCapabilities }
	>;
	minorDowngrade: Array<
		ProviderModelConfig & { provider?: string; capabilities: ModelCapabilities }
	>;
	majorDowngrade: Array<
		ProviderModelConfig & { provider?: string; capabilities: ModelCapabilities }
	>;
} {
	const currentCaps = calculateCapability(current);

	const equalOrBetter: Array<
		ProviderModelConfig & { provider?: string; capabilities: ModelCapabilities }
	> = [];
	const minorDowngrade: Array<
		ProviderModelConfig & { provider?: string; capabilities: ModelCapabilities }
	> = [];
	const majorDowngrade: Array<
		ProviderModelConfig & { provider?: string; capabilities: ModelCapabilities }
	> = [];

	for (const alt of alternatives) {
		const altCaps = calculateCapability(alt);
		const { isDowngrade, severity } = isCapabilityDowngrade(
			currentCaps,
			altCaps,
		);

		const withCaps = { ...alt, capabilities: altCaps };

		if (!isDowngrade) {
			equalOrBetter.push(withCaps);
		} else if (severity === "minor") {
			minorDowngrade.push(withCaps);
		} else {
			majorDowngrade.push(withCaps);
		}
	}

	// Sort each group by score (best first)
	const sortByScore = (a: any, b: any) =>
		b.capabilities.score - a.capabilities.score;
	equalOrBetter.sort(sortByScore);
	minorDowngrade.sort(sortByScore);
	majorDowngrade.sort(sortByScore);

	return { equalOrBetter, minorDowngrade, majorDowngrade };
}

/**
 * Generate capability comparison message
 */
export function generateCapabilityMessage(
	current: { name: string; capabilities: ModelCapabilities },
	target: { name: string; capabilities: ModelCapabilities },
): string {
	const { isDowngrade, severity } = isCapabilityDowngrade(
		current.capabilities,
		target.capabilities,
	);

	if (!isDowngrade) {
		const tierDiff = target.capabilities.score - current.capabilities.score;
		if (tierDiff > 5) {
			return `✓ Upgrade: ${target.name} (${target.capabilities.tier}) vs ${current.name} (${current.capabilities.tier})`;
		}
		return `≈ Same capability: ${target.name}`;
	}

	if (severity === "minor") {
		return `⚠️ Slight downgrade: ${target.name} (${target.capabilities.tier}) vs ${current.name} (${current.capabilities.tier})`;
	}

	return `⬇️ Major downgrade: ${target.name} (${target.capabilities.tier}, score: ${target.capabilities.score}) vs ${current.name} (${current.capabilities.tier}, score: ${current.capabilities.score})`;
}

/**
 * Get minimum acceptable capability tier
 * Returns tier one level below current (allows minor downgrades but not major)
 */
export function getMinimumAcceptableTier(
	current: CapabilityTier,
): CapabilityTier {
	const tierOrder: CapabilityTier[] = [
		"ultra",
		"high",
		"medium",
		"low",
		"minimal",
	];
	const currentIdx = tierOrder.indexOf(current);

	// Allow one tier downgrade max
	const minIdx = Math.min(currentIdx + 1, tierOrder.length - 1);
	return tierOrder[minIdx];
}

/**
 * Initialize capability ranking system
 * Refreshes benchmark cache only if stale (> 7 days) or empty
 */
export async function initCapabilityRanking(): Promise<void> {
	if (needsBenchmarkRefresh()) {
		console.log("[capability] Benchmark cache stale or empty, refreshing...");
		const result = await updateBenchmarkCache();
		if (result.updated > 0) {
			console.log(
				`[capability] Updated ${result.updated} models from: ${result.sources.join(", ") || "static snapshot"}`,
			);
		} else {
			console.log(
				"[capability] Using existing benchmark cache (not stale yet)",
			);
		}
	} else {
		console.log("[capability] Using cached benchmark data (fresh)");
	}
}
