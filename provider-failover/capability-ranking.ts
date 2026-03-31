/**
 * Model Capability Estimation
 * Uses hardcoded benchmark data from Artificial Analysis
 * Falls back to heuristic estimation for models not in database
 */

import type { ProviderModelConfig } from "@mariozechner/pi-coding-agent";
import { getHardcodedScore } from "./hardcoded-benchmarks.ts";

export type CapabilityTier = "ultra" | "high" | "medium" | "low" | "minimal";

export interface ModelCapabilities {
	tier: CapabilityTier;
	score: number; // 0-100 score
	contextWindow: number;
	reasoning: boolean;
	estimatedParams?: number;
	hasVision: boolean;
}

const TIER_THRESHOLDS = {
	ultra: 80,
	high: 65,
	medium: 45,
	low: 25,
	minimal: 0,
};

const SCORES = {
	contextPer1K: 0.03,
	reasoning: 20,
	vision: 5,
	paramsPerB: 0.4,
};

export function extractParamCount(
	modelId: string,
	modelName: string,
): number | undefined {
	const searchText = `${modelId} ${modelName}`.toLowerCase();
	const patterns = [/(\d+(?:\.\d+)?)\s*[bt](?![a-z])/i, /(\d+)-billion/i];

	for (const pattern of patterns) {
		const match = searchText.match(pattern);
		if (match) {
			let value = parseFloat(match[1]);
			if (value > 1000) continue;
			if (match[0].includes("t")) value *= 1000;
			return value;
		}
	}
	return undefined;
}

export function estimateCapability(
	model: ProviderModelConfig,
): ModelCapabilities {
	// Try hardcoded benchmark data first (real scores from AA)
	const hardcodedScore = getHardcodedScore(model.name, model.id);

	if (hardcodedScore !== null) {
		let tier: CapabilityTier = "minimal";
		if (hardcodedScore >= TIER_THRESHOLDS.ultra) tier = "ultra";
		else if (hardcodedScore >= TIER_THRESHOLDS.high) tier = "high";
		else if (hardcodedScore >= TIER_THRESHOLDS.medium) tier = "medium";
		else if (hardcodedScore >= TIER_THRESHOLDS.low) tier = "low";

		return {
			tier,
			score: hardcodedScore,
			contextWindow: model.contextWindow,
			reasoning: model.reasoning,
			estimatedParams: extractParamCount(model.id, model.name),
			hasVision: model.input.includes("image"),
		};
	}

	// Fallback to heuristics
	let score = 0;
	score += Math.min((model.contextWindow / 1000) * SCORES.contextPer1K, 15);
	if (model.reasoning) score += SCORES.reasoning;
	if (model.input.includes("image")) score += SCORES.vision;

	const params = extractParamCount(model.id, model.name);
	if (params) score += params * SCORES.paramsPerB;

	score = Math.min(100, Math.round(score));

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

	if (targetIdx <= currentIdx) return { isDowngrade: false, severity: "none" };

	const tierDiff = targetIdx - currentIdx;
	const scoreDiff = current.score - target.score;

	if (tierDiff >= 2 || scoreDiff > 30)
		return { isDowngrade: true, severity: "major" };
	return { isDowngrade: true, severity: "minor" };
}

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

		if (!isDowngrade) equalOrBetter.push(withCaps);
		else if (severity === "minor") minorDowngrade.push(withCaps);
		else majorDowngrade.push(withCaps);
	}

	const sortByScore = (a: any, b: any) =>
		b.capabilities.score - a.capabilities.score;
	equalOrBetter.sort(sortByScore);
	minorDowngrade.sort(sortByScore);
	majorDowngrade.sort(sortByScore);

	return { equalOrBetter, minorDowngrade, majorDowngrade };
}

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
		if (tierDiff > 5)
			return `✓ Upgrade: ${target.name} (${target.capabilities.tier})`;
		return `≈ Same capability: ${target.name}`;
	}

	if (severity === "minor") {
		return `⚠️ Slight downgrade: ${target.name} (${target.capabilities.tier})`;
	}

	return `⬇️ Major downgrade: ${target.name} (${target.capabilities.tier}, score: ${target.capabilities.score}) vs ${current.name} (${current.capabilities.tier}, score: ${current.capabilities.score})`;
}

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

export async function initCapabilityRanking(): Promise<void> {
	// Initialization complete - hardcoded benchmarks loaded
}
