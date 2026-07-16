/**
 * Qoder Provider Extension
 *
 * Registers the Qoder provider with Pi, providing free access to top-tier
 * LLM models (DeepSeek V4 Pro/Flash, Qwen3.7 Plus/Max, GLM 5.1, Kimi K2.6,
 * MiniMax M3) through Qoder's OpenAI-compatible API.
 *
 * Qoder uses a custom authentication protocol (PAT exchange + COSY signing)
 * and a credits-based pricing model:
 *   - Community Edition (free): basic models with daily message limits
 *   - Pro / Pro+ / Ultra (paid): premium models via monthly credits
 *
 * Usage:
 *   Install pi-free, then run /login qoder to authenticate
 *   (PAT paste or browser OAuth)
 *   /toggle-qoder switches between basic (free-tier) and all models
 *
 * Environment variables:
 *   QODER_PERSONAL_ACCESS_TOKEN — PAT for headless auth (optional)
 *   QODER_PAT                   — Alias for above
 */

import type { Api, OAuthCredentials } from "@earendil-works/pi-ai/compat";
import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import { BASE_URL_QODER, PROVIDER_QODER } from "../../constants.ts";
import { getProviderShowPaid } from "../../config.ts";
import {
	getCachedModels,
	isBasicModel,
	type QoderModelConfig,
} from "./models.ts";
import { getCachedCredentials, loginQoder, refreshQoderToken } from "./auth.ts";
import { streamQoder } from "./stream.ts";
import { enhanceWithCI } from "../../provider-helper.ts";
import { registerWithGlobalToggle } from "../../lib/registry.ts";
import { createToggleState } from "../../lib/toggle-state.ts";

// =============================================================================
// Extension Entry Point
// =============================================================================

export default async function qoderProvider(pi: ExtensionAPI) {
	const logger = (await import("../../lib/logger.ts")).createLogger("qoder");

	// Initial model fetch
	const allModels: QoderModelConfig[] = getCachedModels();
	const basicModels: QoderModelConfig[] = allModels.filter(isBasicModel);
	const stored = { free: basicModels, all: allModels };

	const toggleState = createToggleState({
		providerId: PROVIDER_QODER,
		initialShowPaid: getProviderShowPaid(PROVIDER_QODER),
		initialModels: stored,
	});

	// ── OAuth config (defined before reRegister so it's always available) ──
	const oauthConfig = {
		name: "Qoder (Browser OAuth / PAT)",
		login: async (callbacks: any): Promise<OAuthCredentials> => {
			return loginQoder(callbacks);
		},
		refreshToken: refreshQoderToken,
		getApiKey: (cred: OAuthCredentials) => cred.access,
	};

	// Re-register function — called by toggle, session refresh, login
	const reRegister = (models: ProviderModelConfig[]) => {
		const enhanced = enhanceWithCI(models, PROVIDER_QODER);
		pi.registerProvider(PROVIDER_QODER, {
			baseUrl: BASE_URL_QODER,
			api: "qoder-api" as Api,
			models: enhanced,
			oauth: oauthConfig,
			streamSimple: streamQoder,
		});
	};

	// Register with global toggle system so it participates in /toggle-free
	registerWithGlobalToggle(PROVIDER_QODER, stored, (m) => reRegister(m), false);

	// Per-provider toggle: /toggle-qoder (basic free-tier ↔ all models)
	pi.registerCommand("toggle-qoder", {
		description: "Toggle between basic (free-tier) and all Qoder models",
		handler: async (_args, ctx) => {
			try {
				const applied = toggleState.toggle(reRegister);
				const basicCount = stored.free.length;
				const premiumCount = stored.all.length - basicCount;
				if (applied.mode === "all") {
					ctx.ui.notify(
						`qoder: showing all ${stored.all.length} models (${basicCount} basic, ${premiumCount} premium)`,
						"info",
					);
				} else {
					ctx.ui.notify(
						`qoder: showing ${stored.free.length} basic (free-tier) models`,
						"info",
					);
				}
			} catch (err) {
				logger.error("[qoder] toggle failed", {
					error: err instanceof Error ? err.message : String(err),
				});
				ctx.ui.notify("qoder: toggle failed", "error");
			}
		},
	});

	// Initial registration respects the configured show-paid mode.
	toggleState.applyCurrent(reRegister);

	logger.info(`[qoder] Provider registered with ${allModels.length} models`);
}

// Re-export key symbols for testing
export { loginQoder, refreshQoderToken, getCachedCredentials, streamQoder };
