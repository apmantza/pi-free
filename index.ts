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
 * - Ollama Cloud: Ollama's cloud-hosted models with usage-based free tier
 * - Qwen: OAuth-based Qwen access (deprecated)
 * - Modal: Modal Labs hosting
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { setupBuiltInProviderToggles } from "./lib/built-in-toggle.ts";
import { createLogger } from "./lib/logger.ts";
import {
	applyGlobalFilter,
	getGlobalFreeOnly,
	getProviderRegistry,
	isFreeModel,
	registerWithGlobalToggle,
} from "./lib/registry.ts";
// Import unique provider extensions (only providers NOT built into pi)
import cline from "./providers/cline/cline.ts";
import cloudflare from "./providers/cloudflare/cloudflare.ts";
import kilo from "./providers/kilo/kilo.ts";
import modal from "./providers/modal/modal.ts";
import nvidia from "./providers/nvidia/nvidia.ts";
import ollama from "./providers/ollama/ollama.ts";
import qwen from "./providers/qwen/qwen.ts";

const _logger = createLogger("pi-free");

// =============================================================================
// Global Commands
// =============================================================================

function setupGlobalCommands(pi: ExtensionAPI) {
	// /free-providers - Show free model counts by provider
	pi.registerCommand("free-providers", {
		description: "Show free/paid model counts for all pi-free providers",
		handler: async (_args, ctx) => {
			const lines = ["📊 Pi-Free Providers:", ""];
			const registry = getProviderRegistry();

			// Providers known to not expose pricing via API (all models show as "free")
			// OpenRouter and OpenCode expose actual pricing
			const noPricingApi = new Set([
				"mistral",
				"xai",
				"huggingface",
				"groq",
				"cerebras",
			]);
			// Freemium providers - all models share a free tier quota
			const freemiumProviders = new Set(["nvidia"]);

			for (const [id, entry] of registry) {
				const free = entry.stored.free.length;
				const all = entry.stored.all.length || free;
				const indicator = entry.hasKey ? "🔑" : "🆓";
				const paid = all - free;

				if (freemiumProviders.has(id)) {
					// Freemium: all models share a free tier (e.g., 1,000 reqs/month)
					lines.push(`${indicator} ${id}: ${all} models (freemium)`);
				} else if (noPricingApi.has(id)) {
					// Provider doesn't expose pricing - can't determine free vs paid
					lines.push(
						`${indicator} ${id}: ${all} models (pricing not exposed by API)`,
					);
				} else if (paid === 0 && free > 0) {
					// All models are actually free
					lines.push(`${indicator} ${id}: ${free} free models`);
				} else {
					// Mix of free and paid
					lines.push(
						`${indicator} ${id}: ${free} free / ${paid} paid (${all} total)`,
					);
				}
			}

			if (registry.size === 0) {
				lines.push("(No providers registered yet)");
			}

			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}

// =============================================================================
// Main Entry Point
// =============================================================================

export default async function (pi: ExtensionAPI) {
	const globalFreeOnly = getGlobalFreeOnly();
	_logger.info(`[pi-free] Initializing (global free-only: ${globalFreeOnly})`);

	// Setup global commands first
	setupGlobalCommands(pi);

	// Load all unique providers
	// Each provider will register itself with the global toggle system
	await Promise.allSettled([
		cloudflare(pi),
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

	// Setup toggles for pi's built-in providers (e.g., OpenCode)
	setupBuiltInProviderToggles(pi);

	// Apply initial global filter if free-only mode is enabled
	if (globalFreeOnly) {
		_logger.info("[pi-free] Applying initial free-only filter");
		await applyGlobalFilter(pi, true);
	}

	const registry = getProviderRegistry();
	_logger.info(`[pi-free] Loaded with ${registry.size} providers`);
}

// Re-export registry helpers so consumers don't need deep imports
export {
	applyGlobalFilter,
	getGlobalFreeOnly,
	getProviderRegistry,
	isFreeModel,
	registerWithGlobalToggle,
};
