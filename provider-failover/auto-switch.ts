/**
 * Auto-switch failover for pi-free-providers.
 * 
 * When a provider hits a 429 or capacity error, this module finds
 * an equivalent or similar model from another provider and switches to it.
 * 
 * Strategy:
 * 1. Extract the base model name/family from the failed model
 * 2. Search all available models for the same model (different provider)
 * 3. If not found, find a similar model in the same family
 * 4. If not found, find any free model with similar capability
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { Model } from "@mariozechner/pi-ai";
import { createLogger } from "../lib/logger.ts";
import {
	detectModelFamily,
	normalizeModelName,
	toModelInfo,
	isModelFree,
	type ModelInfo,
} from "../lib/model-detection.ts";
import { getHardcodedScore } from "./hardcoded-benchmarks.ts";

const _logger = createLogger("auto-switch");

export interface AutoSwitchConfig {
	/** Whether to enable auto-switching (can be disabled by user) */
	enabled: boolean;
	/** Maximum CI score degradation allowed (e.g., 10 = can drop up to 10 points) */
	maxCIScoreDrop: number;
	/** Provider priority for fallback (preferred first) */
	providerPriority: string[];
}

const DEFAULT_CONFIG: AutoSwitchConfig = {
	enabled: true,
	maxCIScoreDrop: 15,
	providerPriority: ["zen", "kilo", "openrouter", "nvidia", "fireworks", "mistral", "ollama", "cline"],
};

export interface AutoSwitchResult {
	success: boolean;
	switched: boolean;
	message: string;
	fallbackModel?: ModelInfo;
}

interface CandidateModel {
	model: Model<any>;
	modelInfo: ModelInfo;
	ciScore: number;
	normalizedName: string;
	family: string;
}

/**
 * Find a fallback model when the current provider fails.
 * 
 * Priority order:
 * 1. Same model name from different provider (best match)
 * 2. Same model family, prefer free models
 * 3. Any free model with similar CI score
 */
export async function findFallbackModel(
	failedModel: Model<any>,
	availableModels: Model<any>[],
	config: Partial<AutoSwitchConfig> = {},
): Promise<CandidateModel | null> {
	const fullConfig = { ...DEFAULT_CONFIG, ...config };

	// Convert to ModelInfo for internal processing
	const failedModelInfo = toModelInfo(failedModel);
	const failedFamily = detectModelFamily(failedModelInfo);
	const failedNormalizedName = normalizeModelName(failedModelInfo.name || failedModelInfo.id);
	const failedCIScore = getHardcodedScore(failedModel.name || "", failedModel.id) ?? 20;

	_logger.info("Finding fallback model", {
		failedModel: failedModel.id,
		failedProvider: failedModel.provider,
		failedFamily: failedFamily?.familyId,
		failedNormalizedName: failedNormalizedName,
		failedCIScore,
	});

	// Build candidate list
	const candidates: CandidateModel[] = [];

	for (const candidate of availableModels) {
		// Skip the same provider
		if (candidate.provider === failedModel.provider) continue;

		// Skip if no auth configured for this provider
		// (We'll assume available models have auth, but check anyway)
		if (!candidate.baseUrl) continue;

		const modelInfo = toModelInfo(candidate);
		const family = detectModelFamily(modelInfo);
		const normalizedName = normalizeModelName(modelInfo.name || modelInfo.id);
		const ciScore = getHardcodedScore(candidate.name || "", candidate.id) ?? 20;

		candidates.push({
			model: candidate,
			modelInfo,
			ciScore,
			normalizedName,
			family: family?.familyId ?? "other",
		});
	}

	if (candidates.length === 0) {
		_logger.info("No candidate models found");
		return null;
	}

	// Priority 1: Same model name (different provider)
	// e.g., "minimax-m2.5" on zen → "minimax-m2.5" on openrouter
	const sameName = candidates.find(
		(c) => c.normalizedName === failedNormalizedName && c.model.provider !== failedModel.provider,
	);
	if (sameName) {
		_logger.info("Found exact model match", {
			provider: sameName.model.provider,
			model: sameName.model.id,
		});
		return sameName;
	}

	// Priority 2: Same model family, prefer free models
	const sameFamily = candidates
		.filter((c) => c.family === failedFamily?.familyId && c.model.provider !== failedModel.provider)
		.sort((a, b) => {
			// Prefer free models
			if (a.modelInfo.isFree !== b.modelInfo.isFree) {
				return a.modelInfo.isFree ? -1 : 1;
			}
			// Then by CI score
			return b.ciScore - a.ciScore;
		});

	if (sameFamily.length > 0) {
		const best = sameFamily[0]!;
		_logger.info("Found same family model", {
			provider: best.model.provider,
			model: best.model.id,
			family: best.family,
			isFree: best.modelInfo.isFree,
			ciScore: best.ciScore,
		});
		return best;
	}

	// Priority 3: Any free model with similar CI score
	// Check CI score degradation limit
	const freeCandidates = candidates
		.filter((c) => {
			// Must be free
			if (!c.modelInfo.isFree) return false;
			// Must not drop CI score too much
			const ciDrop = failedCIScore - c.ciScore;
			return ciDrop <= fullConfig.maxCIScoreDrop;
		})
		.sort((a, b) => {
			// Sort by CI score (closest to failed model first)
			return b.ciScore - a.ciScore;
		});

	if (freeCandidates.length > 0) {
		const best = freeCandidates[0]!;
		_logger.info("Found free fallback model", {
			provider: best.model.provider,
			model: best.model.id,
			ciScore: best.ciScore,
			ciDrop: failedCIScore - best.ciScore,
		});
		return best;
	}

	// Priority 4: Any free model (no CI limit)
	const anyFree = candidates
		.filter((c) => c.modelInfo.isFree)
		.sort((a, b) => b.ciScore - a.ciScore);

	if (anyFree.length > 0) {
		const best = anyFree[0]!;
		_logger.info("Found any free fallback", {
			provider: best.model.provider,
			model: best.model.id,
			ciScore: best.ciScore,
		});
		return best;
	}

	// Priority 5: Any model with similar CI score
	const similarCI = candidates
		.filter((c) => {
			const ciDrop = failedCIScore - c.ciScore;
			return ciDrop <= fullConfig.maxCIScoreDrop;
		})
		.sort((a, b) => {
			// Prefer providers in priority order
			const aPriority = fullConfig.providerPriority.indexOf(a.model.provider);
			const bPriority = fullConfig.providerPriority.indexOf(b.model.provider);
			if (aPriority !== bPriority && aPriority >= 0 && bPriority >= 0) {
				return aPriority - bPriority;
			}
			// Then by CI score
			return b.ciScore - a.ciScore;
		});

	if (similarCI.length > 0) {
		const best = similarCI[0]!;
		_logger.info("Found similar CI fallback", {
			provider: best.model.provider,
			model: best.model.id,
			ciScore: best.ciScore,
		});
		return best;
	}

	// Last resort: any model, prefer by provider priority
	const anyModel = candidates.sort((a, b) => {
		const aPriority = fullConfig.providerPriority.indexOf(a.model.provider);
		const bPriority = fullConfig.providerPriority.indexOf(b.model.provider);
		if (aPriority !== bPriority && aPriority >= 0 && bPriority >= 0) {
			return aPriority - bPriority;
		}
		return b.ciScore - a.ciScore;
	});

	if (anyModel.length > 0) {
		const best = anyModel[0]!;
		_logger.info("Found any fallback", {
			provider: best.model.provider,
			model: best.model.id,
			ciScore: best.ciScore,
		});
		return best;
	}

	return null;
}

/**
 * Perform automatic failover when a provider hits an error.
 * Returns the result of the switch attempt.
 */
export async function autoFailover(
	errorMessage: string,
	failedModel: Model<any>,
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	config: Partial<AutoSwitchConfig> = {},
): Promise<AutoSwitchResult> {
	if (!config.enabled) {
		return {
			success: false,
			switched: false,
			message: "Auto-switch disabled",
		};
	}

	// Get all available models
	const availableModels = ctx.modelRegistry.getAvailable();

	if (availableModels.length === 0) {
		return {
			success: false,
			switched: false,
			message: "No alternative models available",
		};
	}

	// Find fallback model
	const fallback = await findFallbackModel(failedModel, availableModels, config);

	if (!fallback) {
		return {
			success: false,
			switched: false,
			message: `No fallback model found for ${failedModel.provider}/${failedModel.id}`,
		};
	}

	// Attempt to switch
	const success = await pi.setModel(fallback.model);

	if (success) {
		const freeStatus = fallback.modelInfo.isFree ? " (free)" : "";
		return {
			success: true,
			switched: true,
			message: `Switched from ${failedModel.provider} to ${fallback.model.provider}/${fallback.model.id}${freeStatus}`,
			fallbackModel: fallback.modelInfo,
		};
	} else {
		return {
			success: false,
			switched: false,
			message: `Failed to switch to ${fallback.model.provider}/${fallback.model.id} (no API key?)`,
			fallbackModel: fallback.modelInfo,
		};
	}
}

/**
 * Check if a model is available from multiple providers
 */
export function getModelAvailability(
	modelId: string,
	availableModels: Model<any>[],
): string[] {
	const normalizedName = normalizeModelName(modelId);

	return availableModels
		.filter((m) => {
			const mNormalized = normalizeModelName(m.name || m.id);
			return mNormalized === normalizedName;
		})
		.map((m) => m.provider);
}

/**
 * Get a summary of available models grouped by family
 */
export function getModelAvailabilitySummary(
	availableModels: Model<any>[],
): Map<string, string[]> {
	const families = new Map<string, string[]>();

	for (const model of availableModels) {
		const modelInfo = toModelInfo(model);
		const family = detectModelFamily(modelInfo);

		if (!family) continue;

		const existing = families.get(family.familyId) ?? [];
		if (!existing.includes(model.provider)) {
			existing.push(model.provider);
		}
		families.set(family.familyId, existing);
	}

	return families;
}
