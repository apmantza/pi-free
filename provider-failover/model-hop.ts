/**
 * Dynamic Model Hop - Intelligent model-level failover
 * Hierarchical matching without hardcoded patterns
 */

import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@mariozechner/pi-coding-agent";
import {
	estimateCapability,
	generateCapabilityMessage,
	isCapabilityDowngrade,
	rankByCapability,
} from "./capability-ranking.ts";
import { classifyError } from "./errors.ts";
import {
	findNextHop,
	getRankedAlternatives,
	markExhausted,
} from "./model-index.ts";

// User configuration for model hopping
interface ModelHopConfig {
	preferredModels?: string[];
	autoHop?: boolean;
	maxHops?: number;
	isPaidMode?: boolean;
	allowDowngrades?: "never" | "minor" | "always"; // Default: "minor"
}

// Track hop state per session
const hopState = new Map<
	string,
	{
		hopCount: number;
		triedModels: Set<string>;
		originalModel: { provider: string; id: string };
	}
>();

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

function getHopState(sessionId: string) {
	return hopState.get(sessionId);
}

function cleanupHopState(sessionId: string): void {
	hopState.delete(sessionId);
}

/**
 * Execute model hop - switch provider and retry
 */
export async function executeModelHop(
	pi: ExtensionAPI,
	ctx: {
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
	},
	target: ProviderModelConfig & { provider?: string },
	reason: string,
): Promise<boolean> {
	try {
		if (!target.provider) {
			ctx.ui.notify("Target model has no provider", "error");
			return false;
		}

		// Switch model using Pi's API
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
			// Small delay to let model switch settle
			await new Promise((resolve) => setTimeout(resolve, 500));

			// Retry with same prompt
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

/**
 * Handle 429 with intelligent model hopping
 * Main entry point - completely automated
 */
export async function handleModelHop(
	pi: ExtensionAPI,
	ctx: {
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
	},
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
	const _autoHop = config?.autoHop ?? true;

	// Classify the error
	const classified = classifyError(error);

	// Only hop on rate limits and capacity errors
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
	const availableModels = ctx.modelRegistry.getAvailable().map((m) => ({
		...m,
		provider: (m as any).provider || currentProvider, // Ensure provider is set
	}));

	if (availableModels.length === 0) {
		return {
			success: false,
			hops: state.hopCount,
			message: "⚠️ No alternative models available",
		};
	}

	// Find next hop using hierarchical matching
	const nextModel = findNextHop(
		currentProvider,
		currentModelId,
		availableModels,
		{
			preferredModels: config?.preferredModels,
			isPaidMode: config?.isPaidMode ?? false,
		},
	);

	if (!nextModel) {
		// No direct match - try to get any alternative
		const alternatives = getRankedAlternatives(
			currentProvider,
			currentModelId,
			availableModels.filter(
				(m) =>
					!state?.triedModels.has(
						getSessionKey(m.provider || currentProvider, m.id),
					),
			),
			{
				preferredModels: config?.preferredModels,
				isPaidMode: config?.isPaidMode ?? false,
			},
			1,
		);

		if (alternatives.length === 0) {
			cleanupHopState(sessionId);
			return {
				success: false,
				hops: state.hopCount,
				message: "⚠️ No suitable alternatives found",
			};
		}

		// Try the best alternative
		const alt = alternatives[0];
		recordHop(sessionId, alt.model.provider || currentProvider, alt.model.id);

		const success = await executeModelHop(
			pi,
			ctx,
			alt.model,
			`Trying ${alt.reason}`,
		);

		if (success) {
			return {
				success: true,
				newProvider: alt.model.provider,
				hops: state.hopCount,
				message: `Hopped to ${alt.model.provider} (${alt.reason})`,
			};
		}

		// Recursive retry with next alternative
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

	// Check capability before hopping
	const currentModel = availableModels.find(
		(m) => m.provider === currentProvider && m.id === currentModelId,
	);

	if (currentModel) {
		const currentCaps = estimateCapability(currentModel);
		const nextCaps = estimateCapability(nextModel);
		const { isDowngrade, severity } = isCapabilityDowngrade(
			currentCaps,
			nextCaps,
		);

		const allowDowngrades = config?.allowDowngrades ?? "minor";

		if (isDowngrade) {
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
							!state?.triedModels.has(
								getSessionKey(m.provider || currentProvider, m.id),
							) && m.id !== nextModel.id,
					),
				);

				if (ranked.equalOrBetter.length > 0) {
					// Use equal-or-better model instead
					const betterModel = ranked.equalOrBetter[0];
					recordHop(
						sessionId,
						betterModel.provider || currentProvider,
						betterModel.id,
					);

					const success = await executeModelHop(
						pi,
						ctx,
						betterModel,
						`Rate limited on ${currentProvider} (preserving capability)`,
					);

					if (success) {
						return {
							success: true,
							newProvider: betterModel.provider,
							hops: state.hopCount,
							message: `Hopped to ${betterModel.name || betterModel.id} @ ${betterModel.provider} (capability preserved)`,
						};
					}
				}

				// No suitable alternative without downgrade
				if (severity === "major") {
					ctx.ui.notify(
						`⚠️ Cannot find equivalent model. ${nextModel.name || nextModel.id} is significantly less capable than ${currentModelName}. Use /model to switch manually or allow downgrades in config.`,
						"warning",
					);
				}
			}

			// Show capability message even if we proceed
			const capMessage = generateCapabilityMessage(
				{ name: currentModelName, capabilities: currentCaps },
				{ name: nextModel.name || nextModel.id, capabilities: nextCaps },
			);
			ctx.ui.notify(capMessage, severity === "major" ? "warning" : "info");
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

/**
 * Reset hop state for a session
 * Call this on successful completion
 */
export function resetHopState(sessionId?: string): void {
	if (sessionId) {
		cleanupHopState(sessionId);
	} else {
		hopState.clear();
	}
}

/**
 * Get current hop status for debugging
 */
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
