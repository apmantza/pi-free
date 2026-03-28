/**
 * Model Capability Estimation
 * Uses real benchmark data from Artificial Analysis when available
 * Falls back to heuristic estimation for models not in their database
 */

import type { ProviderModelConfig } from "@mariozechner/pi-coding-agent";
import {
	type AAModelData,
	findAAModel,
	getAAScore,
	initArtificialAnalysis,
} from "./artificial-analysis.ts";

export type CapabilityTier = "ultra" | "high" | "medium" | "low" | "minimal";

export interface ModelCapabilities {
	tier: CapabilityTier;
	score: number; // 0-100 estimated score
	contextWindow: number;
	reasoning: boolean;
	estimatedParams?: number; // In billions, extracted from name if possible
	hasVision: boolean;
}

// Tier thresholds (based on typical model characteristics)
const TIER_THRESHOLDS = {
	ultra: 80, // 400B+ params OR 200k+ context with reasoning
	high: 65, // 70B+ params OR 128k+ context
	medium: 45, // 30B+ params OR good context
	low: 25, // 7B+ params
	minimal: 0, // Everything else
};

// Scoring weights
const SCORES = {
	contextPer1K: 0.03, // 0.03 points per 1k context (max ~12 for 400k)
	reasoning: 20, // +20 for reasoning capability
	vision: 5, // +5 for vision
	paramsPerB: 0.4, // 0.4 points per billion params
};

/**
 * Extract estimated parameter count from model name/ID
 */
export function extractParamCount(
	modelId: string,
	modelName: string,
): number | undefined {
	const searchText = `${modelId} ${modelName}`.toLowerCase();

	// Look for parameter indicators (70b, 405b, 1.5t, etc.)
	const patterns = [
		/(\d+(?:\.\d+)?)\s*[bt](?![a-z])/i, // 70b, 405b, 1.5t
		/(\d+)-billion/i, // 70-billion
	];

	for (const pattern of patterns) {
		const match = searchText.match(pattern);
		if (match) {
			let value = parseFloat(match[1]);
			if (value > 1000) continue; // Skip context windows like 128000
			if (match[0].includes("t")) value *= 1000; // Convert trillions to billions
			return value;
		}
	}

	return undefined;
}

const cachedAAData: AAModelData[] | null = null;

/**
 * Get Artificial Analysis data (cached)
 */
function getAAData(): AAModelData[] {
	if (cachedAAData) return cachedAAData;
	// This is synchronous - for async init use initArtificialAnalysis()
	// For now, return empty; real data comes after async init
	return [];
}

/**
 * Estimate model capability
 * Uses real Artificial Analysis benchmark data when available
 * Falls back to heuristic estimation for models not in their database
 */
export function estimateCapability(
	model: ProviderModelConfig,
): ModelCapabilities {
	// Try to find real benchmark data
	const aaData = getAAData();
	const aaModel = findAAModel(model.name, model.id, aaData);
	const aaScore = getAAScore(aaModel);

	// If we have real benchmark data, use it
	if (aaScore !== null) {
		let tier: CapabilityTier = "minimal";
		if (aaScore >= TIER_THRESHOLDS.ultra) tier = "ultra";
		else if (aaScore >= TIER_THRESHOLDS.high) tier = "high";
		else if (aaScore >= TIER_THRESHOLDS.medium) tier = "medium";
		else if (aaScore >= TIER_THRESHOLDS.low) tier = "low";

		return {
			tier,
			score: aaScore,
			contextWindow: model.contextWindow,
			reasoning: model.reasoning || aaModel?.supports_reasoning || false,
			estimatedParams: extractParamCount(model.id, model.name),
			hasVision:
				model.input.includes("image") || aaModel?.supports_vision || false,
		};
	}

	// Fallback to heuristic estimation
	let score = 0;

	// Context window contribution
	score += Math.min((model.contextWindow / 1000) * SCORES.contextPer1K, 15);

	// Reasoning capability (major factor)
	if (model.reasoning) {
		score += SCORES.reasoning;
	}

	// Vision capability
	if (model.input.includes("image")) {
		score += SCORES.vision;
	}

	// Parameter count (if extractable)
	const params = extractParamCount(model.id, model.name);
	if (params) {
		score += params * SCORES.paramsPerB;
	}

	// Cap at 100
	score = Math.min(100, Math.round(score));

	// Determine tier
	let tier: CapabilityTier = "minimal";
	if (score >= TIER_THRESHOLDS.ultra) tier = "ultra";
	else if (score >= TIER_THRESHOLDS.high) tier = "high";
	else if (score >= TIER_THRESHOLDS.medium) tier = "medium";
	else if (score >= TIER_THRESHOLDS.low) tier = "low";

	return {
		tier,
		score,
		contextWindow: model.contextWindow,
		reasoning: model.reasoning,
		estimatedParams: params,
		hasVision: model.input.includes("image"),
	};
}

/**
 * Initialize capability ranking with real benchmark data
 */
export async function initCapabilityRanking(): Promise<void> {
	const hasRealData = await initArtificialAnalysis();
	if (hasRealData) {
		console.log(
			"[capability] Using real benchmark data from Artificial Analysis",
		);
	} else {
		console.log(
			"[capability] Using heuristic estimation (no API key or fetch failed)",
		);
	}
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
	const currentCaps = estimateCapability(current);

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
		const altCaps = estimateCapability(alt);
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
 * Generate capability comparison message for user
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
			return `✓ Upgrade: ${target.name} (${target.capabilities.tier})`;
		}
		return `≈ Same capability: ${target.name}`;
	}

	if (severity === "minor") {
		return `⚠️ Slight downgrade: ${target.name} (${target.capabilities.tier})`;
	}

	return `⬇️ Major downgrade: ${target.name} (${target.capabilities.tier}, score: ${target.capabilities.score}) vs ${current.name} (${current.capabilities.tier}, score: ${current.capabilities.score})`;
}

/**
 * Get minimum acceptable capability tier
 * Allows one tier downgrade max
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
	const minIdx = Math.min(currentIdx + 1, tierOrder.length - 1);
	return tierOrder[minIdx];
}
