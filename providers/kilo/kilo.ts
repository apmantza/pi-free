/**
 * Kilo Provider Extension
 *
 * Provides access to 300+ AI models via the Kilo Gateway (OpenRouter-compatible).
 * Free models available immediately; /login kilo for full access.
 *
 * Responds to global /free toggle for free/paid model filtering.
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
import { KILO_FREE_ONLY, KILO_SHOW_PAID, PROVIDER_KILO } from "../../config.ts";
import { URL_KILO_TOS } from "../../constants.ts";
import { registerWithGlobalToggle } from "../../index.ts";
import {
	enhanceWithCI,
	type StoredModels,
	createReRegister,
	createCtxReRegister,
} from "../../provider-helper.ts";
import { cleanModelName, logWarning } from "../../lib/util.ts";
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
	let showPaidModels = KILO_SHOW_PAID;

	// Shared model storage for global toggle and OAuth
	const stored: StoredModels = { free: freeModels, all: [] };

	// Create re-register function for global toggle
	const reRegister = createReRegister(pi, {
		...KILO_PROVIDER_CONFIG,
	});

	// Register with global toggle (will be updated after OAuth)
	registerWithGlobalToggle(PROVIDER_KILO, stored, reRegister, false);

	// OAuth config for Kilo
	const oauthConfig = {
		name: "Kilo",
		login: async (callbacks: any) => {
			const cred = await loginKilo(callbacks);
			try {
				cachedAllModels = await fetchKiloModels({ token: cred.access });
				stored.all = cachedAllModels;
				
				// Re-register with global toggle now that we have paid models
				const globalReRegister = createReRegister(pi, {
					...KILO_PROVIDER_CONFIG,
				});
				registerWithGlobalToggle(PROVIDER_KILO, stored, globalReRegister, true);
				
				// If paid mode is enabled, show all models
				if (showPaidModels && !KILO_FREE_ONLY) {
					globalReRegister(cachedAllModels);
				}
			} catch (error) {
				logWarning("kilo", "Failed to fetch models after login", error);
			}
			return cred;
		},
		refreshToken: refreshKiloToken,
		getApiKey: (cred: OAuthCredentials) => cred.access,
		modifyModels: (models: Model<Api>[], _cred: OAuthCredentials) => {
			if (!showPaidModels || KILO_FREE_ONLY || cachedAllModels.length === 0) {
				return models;
			}
			const template = models.find((m) => m.provider === PROVIDER_KILO);
			if (!template) return models;
			const nonKilo = models.filter((m) => m.provider !== PROVIDER_KILO);
			const fullModels = cachedAllModels.map((m) => ({
				...template,
				id: m.id,
				name: cleanModelName(m.name),
				reasoning: m.reasoning,
				input: m.input,
				cost: m.cost,
				contextWindow: m.contextWindow,
				maxTokens: m.maxTokens,
			}));
			return [...nonKilo, ...fullModels];
		},
	};

	// Register initial provider with free models
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

	// Keep per-provider toggle for backward compatibility
	pi.registerCommand("kilo-toggle", {
		description: "Toggle between free and all Kilo models",
		handler: async (_args, ctx) => {
			showPaidModels = !showPaidModels;
			
			// Update stored state
			const modelsToShow = showPaidModels && cachedAllModels.length > 0
				? cachedAllModels
				: freeModels;
			
			reRegister(modelsToShow);
			
			const count = modelsToShow.length;
			const type = showPaidModels ? "all" : "free";
			ctx.ui.notify(`kilo: showing ${count} ${type} models`, "info");
		},
	});

	// ToS notice
	let tosShown = false;
	pi.on("model_select", async (_event, ctx) => {
		if (tosShown || ctx.model?.provider !== PROVIDER_KILO) return;
		tosShown = true;
		const cred = ctx.modelRegistry.authStorage.get(PROVIDER_KILO);
		if (cred?.type === "oauth") return;
		ctx.ui.notify(
			`Using kilo free models. Run /login kilo for paid access. Terms: ${URL_KILO_TOS}`,
			"info",
		);
	});

	// Refresh models on session start if authenticated
	pi.on("session_start", async (_event, ctx) => {
		const cred = ctx.modelRegistry.authStorage.get(PROVIDER_KILO);

		if (cred?.type === "oauth") {
			try {
				cachedAllModels = await fetchKiloModels({ token: cred.access });
				stored.all = cachedAllModels;
				
				// Update global toggle registration
				const ctxReRegister = createCtxReRegister(ctx as any, {
					...KILO_PROVIDER_CONFIG,
				});
				registerWithGlobalToggle(PROVIDER_KILO, stored, ctxReRegister, true);
				
				if (cachedAllModels.length > 0 && showPaidModels && !KILO_FREE_ONLY) {
					ctxReRegister(cachedAllModels);
				}
			} catch (error) {
				logWarning("kilo", "Failed to fetch models at session start", error);
			}
		}
	});
}
