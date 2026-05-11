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
 * - ZenMux: Unified AI API gateway with 200+ models
 * - Codestral: Mistral's code-focused model via codestral.mistral.ai (free tier)
 * - DeepInfra: AI inference cloud ($5 trial credit)
 * - SambaNova: Fast inference on RDU hardware (free tier, no credit card)
 * - Together: Fast inference on 200+ open-source models ($1 trial credit)
 * - LLM7: AI gateway (free default/fast selectors)
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { setupBuiltInProviderToggles } from "./lib/built-in-toggle.ts";
import { createLogger } from "./lib/logger.ts";
import {
	processQuotaResponse,
	formatQuotaStatus,
} from "./lib/quota-monitor.ts";
import {
	applyGlobalFilter,
	getGlobalFreeOnly,
	getProviderRegistry,
	isFreeModel,
	registerWithGlobalToggle,
} from "./lib/registry.ts";
// Import unique provider extensions (only providers NOT built into pi)
import cline from "./providers/cline/cline.ts";
import codestral from "./providers/codestral/codestral.ts";
import crofai from "./providers/crofai/crofai.ts";
import kilo from "./providers/kilo/kilo.ts";
import llm7 from "./providers/llm7/llm7.ts";
import deepinfra from "./providers/deepinfra/deepinfra.ts";
import sambanova from "./providers/sambanova/sambanova.ts";
import together from "./providers/together/together.ts";
import novita from "./providers/novita/novita.ts";
import nvidia from "./providers/nvidia/nvidia.ts";
import ollama from "./providers/ollama/ollama.ts";
import zenmux from "./providers/zenmux/zenmux.ts";

const _logger = createLogger("pi-free");

// =============================================================================
// Global Commands
// =============================================================================

function setupGlobalCommands(pi: ExtensionAPI) {
	// /toggle-free - Global free-only mode toggle
	pi.registerCommand("toggle-free", {
		description: "Toggle global free-only mode for all providers",
		handler: async (_args, ctx) => {
			const current = getGlobalFreeOnly();
			const next = !current;
			applyGlobalFilter(pi, next);

			const registry = getProviderRegistry();
			const providerCount = registry.size;

			if (next) {
				const totalFree = [...registry.values()].reduce(
					(sum, e) => sum + e.stored.free.length,
					0,
				);
				ctx.ui.notify(
					`Free-only mode: ON (${totalFree} free models across ${providerCount} providers)`,
					"info",
				);
			} else {
				const totalAll = [...registry.values()].reduce(
					(sum, e) => sum + (e.stored.all.length || e.stored.free.length),
					0,
				);
				ctx.ui.notify(
					`Free-only mode: OFF (all ${totalAll} models visible across ${providerCount} providers)`,
					"info",
				);
			}
		},
	});

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
			const freemiumProviders = new Set([
				"nvidia",
				"sambanova",
				"ollama-cloud",
			]);
			// Trial credit providers - one-time credits, otherwise paid
			const trialCreditProviders = new Set(["deepinfra"]);

			for (const [id, entry] of registry) {
				const free = entry.stored.free.length;
				const all = entry.stored.all.length || free;
				const indicator = entry.hasKey ? "🔑" : "🆓";
				const paid = all - free;

				if (freemiumProviders.has(id)) {
					// Freemium: all models share a free tier (e.g., 1,000 reqs/month)
					lines.push(`${indicator} ${id}: ${all} models (freemium)`);
				} else if (trialCreditProviders.has(id)) {
					// Trial credit: one-time credits, otherwise paid
					lines.push(`${indicator} ${id}: ${all} models ($5 trial credit)`);
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
// Quota Monitoring
// =============================================================================

function setupQuotaMonitoring(pi: ExtensionAPI) {
	// Capture rate-limit headers from every provider response
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(pi as any).on(
		"after_provider_response",
		(event: { status: number; headers: Record<string, string> }, ctx: any) => {
			const providerId = ctx.model?.provider;
			if (!providerId) return;

			processQuotaResponse(providerId, event.headers);

			// Update status bar with quota for the active provider
			const status = formatQuotaStatus(providerId);
			if (status) {
				ctx.ui.setStatus("quota", status);
			}
		},
	);

	// Clear quota status when switching away from a provider
	pi.on("model_select", (_event, ctx) => {
		const providerId = ctx.model?.provider;
		if (!providerId) {
			ctx.ui.setStatus("quota", undefined);
			return;
		}
		// Show cached quota on provider switch (if still fresh)
		const status = formatQuotaStatus(providerId);
		ctx.ui.setStatus("quota", status);
	});
}

// =============================================================================
// Main Entry Point
// =============================================================================

export default async function piFreeEntry(pi: ExtensionAPI) {
	const globalFreeOnly = getGlobalFreeOnly();
	_logger.info(`[pi-free] Initializing (global free-only: ${globalFreeOnly})`);

	// Setup global commands first
	setupGlobalCommands(pi);

	// Setup quota monitoring (passive, no extra API calls)
	setupQuotaMonitoring(pi);

	// Load all unique providers
	// Each provider will register itself with the global toggle system
	await Promise.allSettled([
		nvidia(pi),
		kilo(pi),
		ollama(pi),
		cline(pi),
		zenmux(pi),
		crofai(pi),
		codestral(pi),
		llm7(pi),
		deepinfra(pi),
		sambanova(pi),
		together(pi),
		novita(pi),
	]);

	// Setup dynamic built-in providers (Mistral, Groq, Cerebras, xAI, Hugging Face)
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
		applyGlobalFilter(pi, true);
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
