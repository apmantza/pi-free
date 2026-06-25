/**
 * Qoder Provider Extension
 *
 * Registers the Qoder provider with Pi, providing free access to top-tier
 * LLM models (DeepSeek V4 Pro/Flash, Qwen3.7 Plus/Max, GLM 5.1, Kimi K2.6,
 * MiniMax M3) through Qoder's proprietary API.
 *
 * Qoder uses a custom authentication protocol (PAT exchange + COSY signing)
 * and a non-standard streaming API. All models are completely free — no
 * paid tier exists.
 *
 * Usage:
 *   Install pi-free, then run /login qoder to authenticate
 *   (PAT paste or browser OAuth)
 *
 * Environment variables:
 *   QODER_PERSONAL_ACCESS_TOKEN — PAT for headless auth (optional)
 *   QODER_PAT                   — Alias for above
 */

import type { Api, OAuthCredentials } from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import { BASE_URL_QODER, PROVIDER_QODER } from "../../constants.ts";
import {
	getCachedModels,
	isCacheStale,
	updateQoderModelsCache,
} from "./models.ts";
import { getCachedCredentials, loginQoder, refreshQoderToken } from "./auth.ts";
import { streamQoder } from "./stream.ts";
import { enhanceWithCI } from "../../provider-helper.ts";
import { isFreeModel, registerWithGlobalToggle } from "../../lib/registry.ts";

// =============================================================================
// Extension Entry Point
// =============================================================================

export default async function qoderProvider(pi: ExtensionAPI) {
	const logger = (await import("../../lib/logger.ts")).createLogger("qoder");

	// Initial model fetch
	let allModels: ProviderModelConfig[] = getCachedModels();
	let freeModels: ProviderModelConfig[] = allModels.filter((m) =>
		isFreeModel({ ...m, provider: PROVIDER_QODER }, allModels),
	);
	const stored = { free: freeModels, all: allModels };

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

	// Initial registration
	reRegister(allModels);

	// ── OAuth config ──────────────────────────────────────────────────────
	const oauthConfig = {
		name: "Qoder (Browser OAuth / PAT)",
		login: async (callbacks: any): Promise<OAuthCredentials> => {
			const cred = await loginQoder(callbacks);

			// After login, refresh models from API
			try {
				const accessToken = cred.access as string;
				const creds = getCachedCredentials();
				const userID = creds?.userID || "qoder-user";
				const name = creds?.name || "Qoder User";
				const email = creds?.email || "user@qoder.com";
				await updateQoderModelsCache(accessToken, userID, name, email);

				const fresh = getCachedModels();
				if (fresh.length > 0) {
					allModels = fresh;
					freeModels = fresh.filter((m) =>
						isFreeModel({ ...m, provider: PROVIDER_QODER }, fresh),
					);
					stored.all = allModels;
					stored.free = freeModels;
					reRegister(allModels);
					logger.info(
						`[qoder] Models refreshed after login: ${allModels.length}`,
					);
				}
			} catch {
				// Best-effort
			}

			return cred;
		},
		refreshToken: refreshQoderToken,
		getApiKey: (cred: OAuthCredentials) => cred.access,
	};

	// Refresh models cache on session_start if stale (>1h old)
	pi.on("session_start", async (_event, ctx) => {
		try {
			const accessToken =
				await ctx.modelRegistry.getApiKeyForProvider(PROVIDER_QODER);
			if (!accessToken || !isCacheStale()) return;
			const creds = getCachedCredentials();
			const userID = creds?.userID || "qoder-user";
			const name = creds?.name || "Qoder User";
			const email = creds?.email || "user@qoder.com";
			await updateQoderModelsCache(accessToken, userID, name, email);

			const fresh = getCachedModels();
			if (fresh.length > 0) {
				allModels = fresh;
				freeModels = fresh.filter((m) =>
					isFreeModel({ ...m, provider: PROVIDER_QODER }, fresh),
				);
				stored.all = allModels;
				stored.free = freeModels;
				reRegister(allModels);
				logger.info(`[qoder] Cache refreshed: ${allModels.length} models`);
			}
		} catch {
			// Best-effort: fall back to existing cache / static models
		}
	});

	logger.info(`[qoder] Provider registered with ${allModels.length} models`);
}

// Re-export key symbols for testing
export { loginQoder, refreshQoderToken, getCachedCredentials, streamQoder };
