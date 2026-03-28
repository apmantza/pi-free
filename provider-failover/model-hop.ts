/**
 * Model Hop - Intelligent model-level failover
 * Tries same model family across different providers
 * Supports user-configured model priorities
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
	buildModelIndex,
	getModelAlternatives,
	type IndexedModel,
} from "./model-index.ts";

// User configuration for model priorities
interface ModelHopConfig {
	// Ordered list of preferred model families to try
	// e.g., ["llama-3.3-70b", "qwen-2.5-72b", "deepseek-v3"]
	preferredModels?: string[];
	// Whether to auto-hop when hitting 429
	autoHop?: boolean;
	// Max number of hops before giving up
	maxHops?: number;
}

// Track exhausted (provider, model) pairs
const exhaustedPairs = new Map<
	string,
	{ exhaustedAt: number; cooldownMs: number }
>();
const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

function getExhaustedKey(provider: string, modelId: string): string {
	return `${provider}:${modelId}`;
}

export function markModelExhausted(
	provider: string,
	modelId: string,
	cooldownMs: number = DEFAULT_COOLDOWN_MS,
): void {
	const key = getExhaustedKey(provider, modelId);
	exhaustedPairs.set(key, { exhaustedAt: Date.now(), cooldownMs });
}

export function isModelExhausted(provider: string, modelId: string): boolean {
	const key = getExhaustedKey(provider, modelId);
	const state = exhaustedPairs.get(key);
	if (!state) return false;

	const isStillExhausted = Date.now() - state.exhaustedAt < state.cooldownMs;
	if (!isStillExhausted) {
		// Clean up expired entry
		exhaustedPairs.delete(key);
	}
	return isStillExhausted;
}

export function clearExhaustedModels(): void {
	exhaustedPairs.clear();
}

/**
 * Find next hop target - same model family, different provider
 * Respects user preferences if configured
 */
export function findNextHop(
	ctx: {
		modelRegistry: {
			getAll: () => Array<{ provider: string } & Record<string, unknown>>;
			getAvailable: () => Array<{ provider: string } & Record<string, unknown>>;
		};
	},
	currentProvider: string,
	currentModelId: string,
	currentModelName: string,
	isPaidMode: boolean,
	userConfig?: ModelHopConfig,
): IndexedModel | null {
	// Build fresh model index
	const allModels = ctx.modelRegistry.getAll() as Array<
		{ provider: string } & Record<string, unknown>
	>;
	const availableModels = ctx.modelRegistry.getAvailable() as Array<
		{ provider: string } & Record<string, unknown>
	>;
	const modelIndex = buildModelIndex(allModels as any, availableModels as any);

	// Get current model family
	const alternatives = getModelAlternatives(
		modelIndex,
		currentProvider,
		currentModelId,
		currentModelName,
		isPaidMode,
		new Set(
			Array.from(exhaustedPairs.keys()).filter((key) => {
				const [provider, modelId] = key.split(":");
				return isModelExhausted(provider, modelId);
			}),
		),
	);

	// If user has preferred models, prioritize those
	if (userConfig?.preferredModels && userConfig.preferredModels.length > 0) {
		for (const preferredFamily of userConfig.preferredModels) {
			// Check if this preferred model is already exhausted
			const preferredAlts = alternatives.filter((alt) => {
				const altFamily = `${alt.name} ${alt.id}`.toLowerCase();
				return (
					altFamily.includes(preferredFamily.toLowerCase()) &&
					!isModelExhausted(alt.provider, alt.id)
				);
			});

			if (preferredAlts.length > 0) {
				return preferredAlts[0]; // Return cheapest available
			}
		}
	}

	// Return best alternative from same family
	if (alternatives.length > 0) {
		return alternatives[0]; // Already sorted by cost
	}

	return null;
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
			find: (id: string, provider: string) => unknown;
			getAll: () => Array<{ provider: string } & Record<string, unknown>>;
			getAvailable: () => Array<{ provider: string } & Record<string, unknown>>;
		};
	},
	target: IndexedModel,
	reason: string,
): Promise<boolean> {
	try {
		// Find the full model object in registry
		let targetModel = ctx.modelRegistry.find(target.id, "") as any;
		if (!targetModel) {
			const allModels = ctx.modelRegistry.getAll();
			targetModel = allModels.find(
				(m) => m.provider === target.provider,
			) as any;
		}

		if (!targetModel) {
			ctx.ui.notify(`Model ${target.name} not found in registry`, "error");
			return false;
		}

		// Switch model
		const success = await (pi as any).setModel?.(targetModel);
		if (!success) {
			ctx.ui.notify(`Failed to switch to ${target.provider}`, "error");
			return false;
		}

		ctx.ui.notify(
			`🔄 ${reason} → ${target.provider} (${target.name})`,
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
 * Handle 429 with model hopping
 * Main entry point for automated failover
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
			find: (id: string, provider: string) => unknown;
			getAll: () => Array<{ provider: string } & Record<string, unknown>>;
			getAvailable: () => Array<{ provider: string } & Record<string, unknown>>;
		};
	},
	currentProvider: string,
	currentModelId: string,
	currentModelName: string,
	isPaidMode: boolean,
	hopCount: number = 0,
	userConfig?: ModelHopConfig,
): Promise<{ success: boolean; newProvider?: string; hops: number }> {
	const maxHops = userConfig?.maxHops ?? 3;

	if (hopCount >= maxHops) {
		ctx.ui.notify(
			"⚠️ Max model hops reached. Try a different model manually.",
			"warning",
		);
		return { success: false, hops: hopCount };
	}

	// Mark current as exhausted
	markModelExhausted(currentProvider, currentModelId);

	// Find next hop
	const nextModel = findNextHop(
		ctx,
		currentProvider,
		currentModelId,
		currentModelName,
		isPaidMode,
		userConfig,
	);

	if (!nextModel) {
		ctx.ui.notify(
			"⚠️ No alternative models available. Try again later.",
			"warning",
		);
		return { success: false, hops: hopCount };
	}

	// Execute hop
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
			hops: hopCount + 1,
		};
	}

	// If hop failed, try recursively (next alternative)
	return handleModelHop(
		pi,
		ctx,
		nextModel.provider,
		nextModel.id,
		nextModel.name,
		isPaidMode,
		hopCount + 1,
		userConfig,
	);
}
