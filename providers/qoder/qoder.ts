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

import type { Api, Model, OAuthCredentials } from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import { BASE_URL_QODER } from "../../constants.ts";
import {
	getCachedModels,
	isCacheStale,
	staticModels,
	updateQoderModelsCache,
} from "./models.ts";
import { getCachedCredentials, loginQoder, refreshQoderToken } from "./auth.ts";
import { streamQoder } from "./stream.ts";

// =============================================================================
// Extension Entry Point
// =============================================================================

export default async function qoderProvider(pi: ExtensionAPI) {
	const logger = (await import("../../lib/logger.ts")).createLogger("qoder");

	// Refresh the models cache on session_start if it's stale (>1h old)
	// rather than fetching on every message in the stream hot path.
	pi.on("session_start", async (_event, ctx) => {
		try {
			const accessToken = await ctx.modelRegistry.getApiKeyForProvider("qoder");
			if (!accessToken || !isCacheStale()) return;
			const creds = getCachedCredentials();
			const userID = creds?.userID || "qoder-user";
			const name = creds?.name || "Qoder User";
			const email = creds?.email || "user@qoder.com";
			await updateQoderModelsCache(accessToken, userID, name, email);
		} catch {
			// Best-effort: fall back to existing cache / static models
		}
	});

	// ── OAuth config ──────────────────────────────────────────────────────
	const oauth = {
		name: "Qoder (Browser OAuth / PAT)",
		login: loginQoder,
		refreshToken: refreshQoderToken,
		getApiKey: (cred: OAuthCredentials) => cred.access,
		modifyModels: (models: Model<Api>[], _cred: OAuthCredentials) => {
			const cached = getCachedModels();
			const nonQoder = models.filter((m: Model<Api>) => m.provider !== "qoder");
			const modelsToUse = cached.length > 0 ? cached : staticModels;
			const modifiedQoder = modelsToUse.map(
				(m) =>
					({
						...m,
						baseUrl: "https://api3.qoder.sh/",
					}) as Model<Api>,
			);

			return [...nonQoder, ...modifiedQoder] as Model<Api>[];
		},
	};

	// ── Register the provider ─────────────────────────────────────────────
	// Qoder uses a completely custom API protocol, not OpenAI-compatible.
	// We register with a custom `api` string and provide a `streamSimple`
	// handler that implements the full Qoder protocol.
	pi.registerProvider("qoder", {
		baseUrl: BASE_URL_QODER,
		api: "qoder-api" as Api,
		models: getCachedModels() as unknown as ProviderModelConfig[],
		oauth: oauth as never,
		streamSimple: streamQoder,
	});

	logger.info("[qoder] Provider registered with static model cache");
}

// Re-export key symbols for testing
export { loginQoder, refreshQoderToken, getCachedCredentials, streamQoder };
