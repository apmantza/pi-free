/**
 * Pi-Free Providers Index
 *
 * Provides free model filtering for ALL providers (built-in + extension)
 * plus unique free/paid providers not covered by pi's built-in providers.
 *
 * Unique providers:
 * - Kilo: OAuth-based free models
 * - Cline: Cline bot integration
 * - NVIDIA: NVIDIA NIM hosting (free tier available)
 * - Qwen: OAuth-based Qwen access
 * - Modal: Modal Labs hosting
 * - Fireworks: Fireworks AI (paid, but useful for failover)
 */

import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@mariozechner/pi-coding-agent";
import { FREE_ONLY, saveConfig } from "./config.ts";
import { createLogger } from "./lib/logger.ts";
// Import unique provider extensions (only providers NOT built into pi)
import cline from "./providers/cline/cline.ts";
import cloudflare from "./providers/cloudflare/cloudflare.ts";
import fireworks from "./providers/fireworks/fireworks.ts";
import kilo from "./providers/kilo/kilo.ts";
import modal from "./providers/modal/modal.ts";
import nvidia from "./providers/nvidia/nvidia.ts";
import ollama from "./providers/ollama/ollama.ts";
import qwen from "./providers/qwen/qwen.ts";

const _logger = createLogger("pi-free");

// =============================================================================
// Global Provider Registry (for global /free toggle)
// =============================================================================

interface ProviderEntry {
	id: string;
	stored: { free: ProviderModelConfig[]; all: ProviderModelConfig[] };
	reRegister: (models: ProviderModelConfig[]) => void;
	hasKey: boolean;
}

const providerRegistry = new Map<string, ProviderEntry>();
let globalFreeOnly = FREE_ONLY;

/** Register a provider with the global free/paid toggle system */
export function registerWithGlobalToggle(
	providerId: string,
	stored: { free: ProviderModelConfig[]; all: ProviderModelConfig[] },
	reRegister: (models: ProviderModelConfig[]) => void,
	hasKey: boolean = false,
): void {
	providerRegistry.set(providerId, {
		id: providerId,
		stored,
		reRegister,
		hasKey,
	});
	_logger.info(
		`[pi-free] Registered ${providerId} with global toggle (${stored.free.length} free, ${stored.all.length} total)`,
	);
}

/** Check if a model is free (input cost is 0 or undefined) */
export function isFreeModel(model: ProviderModelConfig): boolean {
	return (model.cost?.input ?? 0) === 0;
}

/** Get current global free-only state */
export function getGlobalFreeOnly(): boolean {
	return globalFreeOnly;
}

// =============================================================================
// Apply Global Free/Paid Filter to All Providers
// =============================================================================

function applyGlobalFilter(_pi: ExtensionAPI, freeOnly: boolean): void {
	globalFreeOnly = freeOnly;
	saveConfig({ free_only: freeOnly });

	for (const [providerId, entry] of providerRegistry) {
		try {
			if (freeOnly) {
				// Show only free models
				if (entry.stored.free.length > 0) {
					entry.reRegister(entry.stored.free);
					_logger.info(
						`[pi-free] ${providerId}: filtered to ${entry.stored.free.length} free models`,
					);
				} else {
					_logger.warn(`[pi-free] ${providerId}: no free models available`);
				}
			} else {
				// Show all models (paid + free)
				const allModels =
					entry.stored.all.length > 0 ? entry.stored.all : entry.stored.free;
				if (allModels.length > 0) {
					entry.reRegister(allModels);
					_logger.info(
						`[pi-free] ${providerId}: showing all ${allModels.length} models`,
					);
				}
			}
		} catch (err) {
			_logger.error(
				`[pi-free] Failed to apply filter to ${providerId}`,
				err instanceof Error ? { error: err.message } : { error: String(err) },
			);
		}
	}
}

// =============================================================================
// Global Commands
// =============================================================================

function setupGlobalCommands(pi: ExtensionAPI) {
	// /free - Global toggle for ALL providers
	pi.registerCommand("free", {
		description: "Toggle free-only mode for ALL providers (on/off/status)",
		handler: async (args, ctx) => {
			const arg = args.trim().toLowerCase();

			if (arg === "on" || arg === "true" || arg === "yes") {
				applyGlobalFilter(pi, true);
				ctx.ui.notify(
					"✓ Free-only mode enabled - paid models hidden for all providers",
					"info",
				);
			} else if (arg === "off" || arg === "false" || arg === "no") {
				applyGlobalFilter(pi, false);
				ctx.ui.notify(
					"✓ Paid models enabled - all models visible for all providers",
					"info",
				);
			} else if (arg === "status" || arg === "" || !arg) {
				const available = await ctx.modelRegistry.getAvailable();
				const freeCount = available.filter(isFreeModel).length;
				const status = globalFreeOnly ? "enabled" : "disabled";

				// Count by provider
				const lines = [
					`Free-only mode: ${status}`,
					`${freeCount}/${available.length} models free`,
					"",
				];
				for (const [id, entry] of providerRegistry) {
					const free = entry.stored.free.length;
					const all = entry.stored.all.length || free;
					lines.push(`${id}: ${free}/${all} free`);
				}

				ctx.ui.notify(lines.join("\n"), "info");
			} else {
				ctx.ui.notify("Usage: /free [on|off|status]", "warning");
			}
		},
	});

	// /free-providers - Show free model counts by provider
	pi.registerCommand("free-providers", {
		description: "Show free/paid model counts for all pi-free providers",
		handler: async (_args, ctx) => {
			const lines = ["📊 Pi-Free Providers:", ""];

			for (const [id, entry] of providerRegistry) {
				const free = entry.stored.free.length;
				const all = entry.stored.all.length || free;
				const indicator = entry.hasKey ? "🔑" : "🆓";
				lines.push(
					`${indicator} ${id}: ${free} free / ${all - free} paid (${all} total)`,
				);
			}

			if (providerRegistry.size === 0) {
				lines.push("(No providers registered yet)");
			}

			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	// Notify when paid models are selected in free-only mode
	pi.on("model_select", async (event, ctx) => {
		const model = event.model;
		if (!model || !globalFreeOnly) return;
		if (isFreeModel(model)) return;

		// Only warn for providers managed by pi-free
		if (providerRegistry.has(model.provider)) {
			ctx.ui.notify(
				`⚠️ Paid model selected (${model.id}). Use "/free off" to enable paid models.`,
				"warning",
			);
		}
	});
}

// =============================================================================
// Main Entry Point
// =============================================================================

export default async function (pi: ExtensionAPI) {
	_logger.info(`[pi-free] Initializing (global free-only: ${globalFreeOnly})`);

	// Setup global commands first
	setupGlobalCommands(pi);

	// Load all unique providers
	// Each provider will register itself with the global toggle system
	await Promise.allSettled([
		cloudflare(pi),
		fireworks(pi),
		modal(pi),
		nvidia(pi),
		kilo(pi),
		ollama(pi),
		// Qwen is deprecated
		qwen(pi).catch((err) => {
			_logger.warn("[pi-free] Qwen provider failed to load (deprecated)", err);
		}),
		cline(pi),
	]);

	// Setup dynamic built-in providers (Mistral, Groq, Cerebras, xAI, Hugging Face, OpenRouter)
	// These only activate if the user has configured API keys (OpenRouter works without key too)
	const { setupDynamicBuiltInProviders } = await import(
		"./providers/dynamic-built-in/index.ts"
	);
	await setupDynamicBuiltInProviders(pi);

	// Apply initial global filter if free-only mode is enabled
	if (globalFreeOnly) {
		_logger.info("[pi-free] Applying initial free-only filter");
		await applyGlobalFilter(pi, true);
	}

	_logger.info(`[pi-free] Loaded with ${providerRegistry.size} providers`);
}

// Re-export for providers
export { providerRegistry };
