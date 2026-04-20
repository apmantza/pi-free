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

import type { Api, Model } from "@mariozechner/pi-ai";
import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@mariozechner/pi-coding-agent";
import { OPENROUTER_SHOW_PAID, saveConfig } from "./config.ts";
import { loadFreeConfig, saveFreeConfig } from "./lib/free-config.ts";
import { createLogger } from "./lib/logger.ts";
// Import unique provider extensions (only providers NOT built into pi)
import cline from "./providers/cline/cline.ts";
import fireworks from "./providers/fireworks/fireworks.ts";
import kilo from "./providers/kilo/kilo.ts";
import modal from "./providers/modal/modal.ts";
import nvidia from "./providers/nvidia/nvidia.ts";
import qwen from "./providers/qwen/qwen.ts";

// Qwen provider is deprecated - remove import when fully removing support

const _logger = createLogger("pi-free");

// =============================================================================
// Model Filter State
// =============================================================================

interface FilterState {
	freeOnly: boolean;
	providerOverrides: Record<string, boolean | undefined>;
}

const DEFAULT_FILTER_STATE: FilterState = {
	freeOnly: true,
	providerOverrides: {},
};

/** Check if a model is free (input cost is 0 or undefined) */
function isFreeModel(model: ProviderModelConfig): boolean {
	return (model.cost?.input ?? 0) === 0;
}

// =============================================================================
// Global Free Model Filtering System
// =============================================================================

function setupGlobalFiltering(pi: ExtensionAPI, state: FilterState) {
	// Notify when paid models are selected in free-only mode
	pi.on("model_select", async (event, ctx) => {
		const model = event.model;
		if (!model || !state.freeOnly) return;
		if (isFreeModel(model)) return;

		const providerOverride = state.providerOverrides[model.provider];
		if (providerOverride !== false) {
			ctx.ui.notify(
				`Paid model selected (${model.id}). Use /free off to enable paid models.`,
				"warning",
			);
		}
	});

	// Log model counts on session start
	pi.on("session_start", async (_event, ctx) => {
		const available = await ctx.modelRegistry.getAvailable();
		const freeCount = available.filter(isFreeModel).length;
		_logger.info(
			`[pi-free] ${freeCount}/${available.length} free models available`,
		);
	});

	// /free - Toggle free-only mode
	pi.registerCommand("free", {
		description: "Toggle free-only model filtering (on/off/status)",
		handler: async (args, ctx) => {
			const arg = args.trim().toLowerCase();

			if (arg === "on" || arg === "true" || arg === "yes") {
				state.freeOnly = true;
				saveFreeConfig({ free_only: true });
				ctx.ui.notify("✓ Free-only mode enabled - paid models hidden", "info");
			} else if (arg === "off" || arg === "false" || arg === "no") {
				state.freeOnly = false;
				saveFreeConfig({ free_only: false });
				ctx.ui.notify("✓ Paid models enabled - all models visible", "info");
			} else if (arg === "status" || arg === "" || !arg) {
				const available = await ctx.modelRegistry.getAvailable();
				const freeCount = available.filter(isFreeModel).length;
				const status = state.freeOnly ? "enabled" : "disabled";
				ctx.ui.notify(
					`Free-only mode: ${status} (${freeCount}/${available.length} models free)`,
					"info",
				);
			} else {
				ctx.ui.notify("Usage: /free [on|off|status]", "warning");
			}
		},
	});

	// /free-providers - Show free model counts by provider
	pi.registerCommand("free-providers", {
		description: "Show free model counts by provider",
		handler: async (_args, ctx) => {
			const available = await ctx.modelRegistry.getAvailable();
			const byProvider = new Map<string, { free: number; paid: number }>();

			for (const model of available) {
				const provider = model.provider || "unknown";
				const counts = byProvider.get(provider) || { free: 0, paid: 0 };
				if (isFreeModel(model)) counts.free++;
				else counts.paid++;
				byProvider.set(provider, counts);
			}

			const lines = ["📊 Free Models by Provider:", ""];
			for (const [provider, counts] of byProvider) {
				const indicator = counts.free > 0 ? "🟢" : "🔴";
				lines.push(
					`${indicator} ${provider}: ${counts.free} free, ${counts.paid} paid`,
				);
			}

			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	// Setup per-provider toggles for built-in pi providers
	setupBuiltInProviderToggles(pi, state);
}

// =============================================================================
// Built-in Provider Toggles (for pi's native providers like OpenRouter)
// =============================================================================

function setupBuiltInProviderToggles(pi: ExtensionAPI, _state: FilterState) {
	// OpenRouter toggle - controls free vs all models for built-in OpenRouter provider
	let openrouterShowPaid = OPENROUTER_SHOW_PAID;

	// Apply initial OpenRouter filtering on session start (when registry is ready)
	pi.on("session_start", async (_event, ctx) => {
		const available = await ctx.modelRegistry.getAvailable();
		const openrouterModels = available.filter(
			(m: Model<Api>) => m.provider === "openrouter",
		);
		const freeCount = openrouterModels.filter(isFreeModel).length;
		const paidCount = openrouterModels.length - freeCount;

		if (!openrouterShowPaid && paidCount > 0) {
			// Filter to only free models by re-registering with filtered list
			const freeModels = openrouterModels.filter(isFreeModel);
			pi.registerProvider("openrouter", {
				models: freeModels,
			});
			_logger.info(
				`[pi-free] OpenRouter: filtered to ${freeCount} free models (${paidCount} paid hidden)`,
			);
		} else if (openrouterShowPaid) {
			// Unregister to restore all built-in models
			pi.unregisterProvider("openrouter");
			_logger.info(
				`[pi-free] OpenRouter: showing all ${openrouterModels.length} models`,
			);
		}
	});

	pi.registerCommand("openrouter-toggle", {
		description: "Toggle between free and all OpenRouter models",
		handler: async (_args, ctx) => {
			openrouterShowPaid = !openrouterShowPaid;
			saveConfig({ openrouter_show_paid: openrouterShowPaid });

			// Get current models and apply filtering
			const available = await ctx.modelRegistry.getAvailable();
			const openrouterModels = available.filter(
				(m: Model<Api>) => m.provider === "openrouter",
			);
			const freeCount = openrouterModels.filter(isFreeModel).length;
			const paidCount = openrouterModels.length - freeCount;

			if (openrouterShowPaid) {
				// Unregister to restore all built-in models
				pi.unregisterProvider("openrouter");
				ctx.ui.notify(
					`openrouter: showing all ${openrouterModels.length} models (including paid)`,
					"info",
				);
			} else {
				// Filter to only free models
				const freeModels = openrouterModels.filter(isFreeModel);
				pi.registerProvider("openrouter", {
					models: freeModels,
				});
				ctx.ui.notify(
					`openrouter: showing only ${freeCount} free models (${paidCount} paid hidden)`,
					"info",
				);
			}
		},
	});
}

// =============================================================================
// Main Entry Point
// =============================================================================

export default async function (pi: ExtensionAPI) {
	const config = loadFreeConfig();
	const state: FilterState = {
		freeOnly: config.free_only ?? DEFAULT_FILTER_STATE.freeOnly,
		providerOverrides: config.provider_overrides ?? {},
	};

	_logger.info(`[pi-free] Initializing (free-only: ${state.freeOnly})`);

	// Setup filtering first, then load unique providers
	setupGlobalFiltering(pi, state);

	await Promise.allSettled([
		fireworks(pi),
		modal(pi),
		nvidia(pi),
		kilo(pi),
		// Qwen is deprecated - 1,000 req/day free tier no longer available
		qwen(pi).catch((err) => {
			_logger.warn("[pi-free] Qwen provider failed to load (deprecated)", err);
		}),
		cline(pi),
	]);

	_logger.info("[pi-free] Loaded");
}
