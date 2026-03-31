/**
 * Dynamic Model Hop - Intelligent model-level failover
 */

import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@mariozechner/pi-coding-agent";
import { createLogger } from "../lib/logger.ts";
import {
	estimateCapability,
	generateCapabilityMessage,
	isCapabilityDowngrade,
	type ModelCapabilities,
	rankByCapability,
} from "./capability-ranking.ts";
import { classifyError } from "./errors.ts";
import {
	findNextHop,
	getRankedAlternatives,
	markExhausted,
} from "./model-index.ts";

const _logger = createLogger("model-hop");

export interface ModelHopConfig {
	preferredModels?: string[];
	autoHop?: boolean;
	maxHops?: number;
	isPaidMode?: boolean;
	allowDowngrades?: "never" | "minor" | "always";
}

interface HopState {
	hopCount: number;
	triedModels: Set<string>;
	originalModel: { provider: string; id: string };
}

// Track hop state per session
const hopState = new Map<string, HopState>();

function getSessionKey(provider: string, modelId: string): string {
	return `${provider}:${modelId}`;
}

function initHopState(
	sessionId: string,
	provider: string,
	modelId: string,
): void {
	hopState.set(sessionId, {
		hopCount: 0,
		triedModels: new Set([getSessionKey(provider, modelId)]),
		originalModel: { provider, id: modelId },
	});
}

function recordHop(sessionId: string, provider: string, modelId: string): void {
	const state = hopState.get(sessionId);
	if (state) {
		state.hopCount++;
		state.triedModels.add(getSessionKey(provider, modelId));
	}
}

function getHopState(sessionId: string): HopState | undefined {
	return hopState.get(sessionId);
}

function cleanupHopState(sessionId: string): void {
	hopState.delete(sessionId);
}

// =============================================================================
// Model Hop Execution
// =============================================================================

interface HopContext {
	ui: { notify: (msg: string, type: "info" | "warning" | "error") => void };
	sessionManager: {
		getBranch: () => Array<{
			type: string;
			message?: { role?: string; content?: string };
		}>;
	};
	modelRegistry: {
		getAvailable: () => Array<ProviderModelConfig & { provider?: string }>;
	};
	session?: { id?: string };
}

export async function executeModelHop(
	pi: ExtensionAPI,
	ctx: HopContext,
	target: ProviderModelConfig & { provider?: string },
	reason: string,
): Promise<boolean> {
	try {
		if (!target.provider) {
			ctx.ui.notify("Target model has no provider", "error");
			return false;
		}

		const success = await (pi as any).setModel?.(target);
		if (!success) {
			ctx.ui.notify(`Failed to switch to ${target.provider}`, "error");
			return false;
		}

		ctx.ui.notify(
			`🔄 ${reason} → ${target.provider} (${target.name || target.id})`,
			"warning",
		);

		// Get last user message and retry
		const branch = ctx.sessionManager.getBranch();
		const lastUser = branch
			.slice()
			.reverse()
			.find((e) => e.type === "message" && e.message?.role === "user");

		if (lastUser?.message?.content) {
			await new Promise((resolve) => setTimeout(resolve, 500));
			await (pi as any).sendUserMessage?.(lastUser.message.content, {
				deliverAs: "steer",
			});
			return true;
		}

		return false;
	} catch (error) {
		ctx.ui.notify(`Model hop failed: ${String(error)}`, "error");
		return false;
	}
}

// =============================================================================
// Downgrade Handling
// =============================================================================

interface DowngradeDecision {
	shouldProceed: boolean;
	alternative?: ProviderModelConfig & { provider?: string };
	message?: string;
}

function handleDowngradeDecision(
	currentModel: ProviderModelConfig,
	targetModel: ProviderModelConfig & { provider?: string },
	availableModels: Array<ProviderModelConfig & { provider?: string }>,
	currentCaps: ModelCapabilities,
	targetCaps: ModelCapabilities,
	triedModels: Set<string>,
	currentProvider: string,
	allowDowngrades: "never" | "minor" | "always",
): DowngradeDecision {
	const { isDowngrade, severity } = isCapabilityDowngrade(
		currentCaps,
		targetCaps,
	);

	if (!isDowngrade) {
		return { shouldProceed: true };
	}

	// Check if downgrade is allowed
	if (
		allowDowngrades === "never" ||
		(allowDowngrades === "minor" && severity === "major")
	) {
		// Try to find equal-or-better alternative
		const ranked = rankByCapability(
			currentModel,
			availableModels.filter(
				(m) =>
					!triedModels.has(
						getSessionKey(m.provider || currentProvider, m.id),
					) && m.id !== targetModel.id,
			),
		);

		if (ranked.equalOrBetter.length > 0) {
			return {
				shouldProceed: true,
				alternative: ranked.equalOrBetter[0],
			};
		}

		// No suitable alternative without downgrade
		return {
			shouldProceed: false,
			message:
				severity === "major"
					? `⚠️ Cannot find equivalent model. ${targetModel.name || targetModel.id} is significantly less capable.`
					: undefined,
		};
	}

	return { shouldProceed: true };
}

// =============================================================================
// Alternative Model Selection
// =============================================================================

async function tryAlternativeModel(
	pi: ExtensionAPI,
	ctx: HopContext,
	alt: { model: ProviderModelConfig & { provider?: string }; reason: string },
	sessionId: string,
	currentProvider: string,
	error: unknown,
	config?: ModelHopConfig,
): Promise<{
	success: boolean;
	newProvider?: string;
	hops: number;
	message: string;
}> {
	recordHop(sessionId, alt.model.provider || currentProvider, alt.model.id);

	const success = await executeModelHop(
		pi,
		ctx,
		alt.model,
		`Trying ${alt.reason}`,
	);

	if (success) {
		const state = getHopState(sessionId);
		return {
			success: true,
			newProvider: alt.model.provider,
			hops: state?.hopCount ?? 1,
			message: `Hopped to ${alt.model.provider} (${alt.reason})`,
		};
	}

	// Recursive retry with next alternative
	markExhausted(alt.model.provider || currentProvider, alt.model.id);
	return handleModelHop(
		pi,
		ctx,
		alt.model.provider || currentProvider,
		alt.model.id,
		alt.model.name || alt.model.id,
		error,
		config,
	);
}

// =============================================================================
// Main Handler
// =============================================================================

export async function handleModelHop(
	pi: ExtensionAPI,
	ctx: HopContext,
	currentProvider: string,
	currentModelId: string,
	currentModelName: string,
	error: unknown,
	config?: ModelHopConfig,
): Promise<{
	success: boolean;
	newProvider?: string;
	hops: number;
	message: string;
}> {
	const sessionId = ctx.session?.id || "default";
	const maxHops = config?.maxHops ?? 3;
	const allowDowngrades = config?.allowDowngrades ?? "minor";

	// Classify the error
	const classified = classifyError(error);
	if (classified.type !== "rate_limit" && classified.type !== "capacity") {
		return {
			success: false,
			hops: 0,
			message: `Not a rate limit error (${classified.type})`,
		};
	}

	// Initialize or get hop state
	let state = getHopState(sessionId);
	if (!state) {
		initHopState(sessionId, currentProvider, currentModelId);
		state = getHopState(sessionId)!;
	}

	// Check max hops
	if (state.hopCount >= maxHops) {
		cleanupHopState(sessionId);
		return {
			success: false,
			hops: state.hopCount,
			message:
				"⚠️ Max model hops reached. Try a different model manually with /model",
		};
	}

	// Mark current as exhausted
	markExhausted(currentProvider, currentModelId);

	// Get available models
	const rawModels = ctx.modelRegistry.getAvailable();
	_logger.info(`[HOP] Got ${rawModels.length} raw models from registry`);

	const availableModels = rawModels.map((m) => ({
		...m,
		provider: (m as any).provider || currentProvider,
	}));

	_logger.info(
		`[HOP] Available models after mapping: ${availableModels.map((m) => `${m.provider}/${m.id}`).join(", ")}`,
	);

	if (availableModels.length === 0) {
		_logger.warn(`[HOP] No models returned from modelRegistry.getAvailable()`);
		return {
			success: false,
			hops: state.hopCount,
			message: "⚠️ No alternative models available",
		};
	}

	// Try hierarchical matching first
	const nextModel = findNextHop(
		currentProvider,
		currentModelId,
		availableModels,
		{
			preferredModels: config?.preferredModels,
			isPaidMode: config?.isPaidMode ?? false,
		},
	);

	// No direct match - get ranked alternatives
	if (!nextModel) {
		_logger.info(
			`[HOP] No direct match from findNextHop, trying ranked alternatives`,
		);

		const untriedModels = availableModels.filter(
			(m) =>
				!state?.triedModels.has(
					getSessionKey(m.provider || currentProvider, m.id),
				),
		);
		_logger.info(
			`[HOP] Untried models: ${untriedModels.map((m) => `${m.provider}/${m.id}`).join(", ")}`,
		);

		const alternatives = getRankedAlternatives(
			currentProvider,
			currentModelId,
			untriedModels,
			{
				preferredModels: config?.preferredModels,
				isPaidMode: config?.isPaidMode ?? false,
			},
			1,
		);

		_logger.info(
			`[HOP] getRankedAlternatives returned ${alternatives.length} alternatives: ${alternatives.map((a) => `${a.model.provider}/${a.model.id} (${a.reason})`).join(", ")}`,
		);

		if (alternatives.length === 0) {
			cleanupHopState(sessionId);
			return {
				success: false,
				hops: state.hopCount,
				message: "⚠️ No suitable alternatives found",
			};
		}

		return tryAlternativeModel(
			pi,
			ctx,
			alternatives[0],
			sessionId,
			currentProvider,
			error,
			config,
		);
	}

	// Check capability before hopping
	const currentModel = availableModels.find(
		(m) => m.provider === currentProvider && m.id === currentModelId,
	);

	if (currentModel) {
		const currentCaps = estimateCapability(currentModel);
		const nextCaps = estimateCapability(nextModel);

		const decision = handleDowngradeDecision(
			currentModel,
			nextModel,
			availableModels,
			currentCaps,
			nextCaps,
			state.triedModels,
			currentProvider,
			allowDowngrades,
		);

		if (decision.message) {
			ctx.ui.notify(decision.message, "warning");
		}

		if (!decision.shouldProceed) {
			// Try fallback to equal-or-better if available
			if (decision.alternative) {
				recordHop(
					sessionId,
					decision.alternative.provider || currentProvider,
					decision.alternative.id,
				);
				const success = await executeModelHop(
					pi,
					ctx,
					decision.alternative,
					`Rate limited on ${currentProvider} (preserving capability)`,
				);

				if (success) {
					return {
						success: true,
						newProvider: decision.alternative.provider,
						hops: state.hopCount,
						message: `Hopped to ${decision.alternative.name || decision.alternative.id} @ ${decision.alternative.provider} (capability preserved)`,
					};
				}
			}
		} else {
			// Show capability message for downgrade
			const { isDowngrade, severity } = isCapabilityDowngrade(
				currentCaps,
				nextCaps,
			);
			if (isDowngrade) {
				const capMessage = generateCapabilityMessage(
					{ name: currentModelName, capabilities: currentCaps },
					{ name: nextModel.name || nextModel.id, capabilities: nextCaps },
				);
				ctx.ui.notify(capMessage, severity === "major" ? "warning" : "info");
			}
		}
	}

	// Execute the hop
	recordHop(sessionId, nextModel.provider || currentProvider, nextModel.id);

	const success = await executeModelHop(
		pi,
		ctx,
		nextModel,
		`Rate limited on ${currentProvider}`,
	);

	if (success) {
		return {
			success: true,
			newProvider: nextModel.provider,
			hops: state.hopCount,
			message: `Hopped to ${nextModel.provider}`,
		};
	}

	// If hop failed, try next alternative
	markExhausted(nextModel.provider || currentProvider, nextModel.id);

	return handleModelHop(
		pi,
		ctx,
		currentProvider,
		currentModelId,
		currentModelName,
		error,
		config,
	);
}

// =============================================================================
// Public API
// =============================================================================

export function resetHopState(sessionId?: string): void {
	if (sessionId) {
		cleanupHopState(sessionId);
	} else {
		hopState.clear();
	}
}

export function getHopStatus(sessionId: string): {
	hopCount: number;
	triedCount: number;
	originalProvider: string;
} | null {
	const state = hopState.get(sessionId);
	if (!state) return null;

	return {
		hopCount: state.hopCount,
		triedCount: state.triedModels.size,
		originalProvider: state.originalModel.provider,
	};
}
