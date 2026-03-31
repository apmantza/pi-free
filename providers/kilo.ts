/**
 * Kilo Provider Extension
 *
 * Provides access to 300+ AI models via the Kilo Gateway (OpenRouter-compatible).
 * Free models available immediately; /login kilo for full access.
 *
 * Usage:
 *   pi install git:github.com/apmantza/pi-free
 *   # Then /login kilo, or set KILO_API_KEY=...
 */

import type { Api, Model, OAuthCredentials } from "@mariozechner/pi-ai";
import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@mariozechner/pi-coding-agent";
import { KILO_FREE_ONLY, PROVIDER_KILO } from "../config.ts";
import { URL_KILO_TOS } from "../constants.ts";
import {
	enhanceWithCI,
	type StoredModels,
	setupProvider,
	createReRegister,
	createCtxReRegister,
} from "../provider-helper.ts";
import { registerUsageWidget } from "../usage-widget.ts";
import { logWarning } from "../util.ts";
import { loginKilo, refreshKiloToken } from "./kilo-auth.ts";
import { fetchKiloModels, KILO_GATEWAY_BASE } from "./kilo-models.ts";

const KILO_PROVIDER_CONFIG = {
	providerId: PROVIDER_KILO,
	baseUrl: KILO_GATEWAY_BASE,
	apiKey: "KILO_API_KEY",
	headers: {
		"X-KILOCODE-EDITORNAME": "Pi",
	},
};

export default async function (pi: ExtensionAPI) {
	let freeModels: ProviderModelConfig[] = [];
	try {
		freeModels = await fetchKiloModels({ freeOnly: true });
	} catch (error) {
		logWarning("kilo", "Failed to fetch free models at startup", error);
	}

	let cachedAllModels: ProviderModelConfig[] = [];

	// Shared model storage for setupProvider commands
	const stored: StoredModels = { free: freeModels, all: [] };

	// OAuth config for Kilo (shared across registrations)
	const oauthConfig = {
		name: "Kilo",
		login: async (callbacks: any) => {
			const cred = await loginKilo(callbacks);
			try {
				cachedAllModels = await fetchKiloModels({ token: cred.access });
				stored.all = cachedAllModels;
			} catch (error) {
				logWarning("kilo", "Failed to fetch models after login", error);
			}
			return cred;
		},
		refreshToken: refreshKiloToken,
		getApiKey: (cred: OAuthCredentials) => cred.access,
		modifyModels: (models: Model<Api>[], _cred: OAuthCredentials) => {
			if (KILO_FREE_ONLY || cachedAllModels.length === 0) return models;
			const template = models.find((m) => m.provider === PROVIDER_KILO);
			if (!template) return models;
			const nonKilo = models.filter((m) => m.provider !== PROVIDER_KILO);
			const fullModels = cachedAllModels.map((m) => ({
				...template,
				id: m.id,
				name: m.name,
				reasoning: m.reasoning,
				input: m.input,
				cost: m.cost,
				contextWindow: m.contextWindow,
				maxTokens: m.maxTokens,
			}));
			return [...nonKilo, ...fullModels];
		},
	};

	// Register initial provider
	pi.registerProvider(PROVIDER_KILO, {
		baseUrl: KILO_GATEWAY_BASE,
		apiKey: "KILO_API_KEY",
		api: "openai-completions" as const,
		headers: {
			"X-KILOCODE-EDITORNAME": "Pi",
			"User-Agent": "pi-free-providers",
		},
		models: enhanceWithCI(freeModels),
		oauth: oauthConfig,
	});

	// Wire up shared boilerplate (commands, model_select, turn_end, ToS)
	const reRegister = createReRegister(pi, {
		...KILO_PROVIDER_CONFIG,
		oauth: oauthConfig as any,
	});
	setupProvider(
		pi,
		{
			providerId: PROVIDER_KILO,
			tosUrl: URL_KILO_TOS,
			reRegister: (models) => {
				stored.free = models;
				stored.all = models;
				reRegister(models);
			},
		},
		stored,
	);

	// Register usage widget (glimpseui)
	registerUsageWidget(pi);

	// ── Kilo-specific: events ────────────────────────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		const cred = ctx.modelRegistry.authStorage.get(PROVIDER_KILO);

		if (cred?.type === "oauth") {
			try {
				cachedAllModels = await fetchKiloModels({ token: cred.access });
				stored.all = cachedAllModels;
				if (cachedAllModels.length > 0) {
					const ctxReRegister = createCtxReRegister(ctx, {
						...KILO_PROVIDER_CONFIG,
						oauth: oauthConfig as any,
					});
					ctxReRegister(freeModels);
				}
			} catch (error) {
				logWarning("kilo", "Failed to fetch models at session start", error);
			}
		}
	});
}
