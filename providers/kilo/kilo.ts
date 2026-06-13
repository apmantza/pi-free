/**
 * Kilo Provider Extension
 *
 * Provides access to 300+ AI models via the Kilo Gateway (OpenRouter-compatible).
 * Fetches ALL models at startup (like Cline/OpenRouter), defaults to free-only view.
 * Run /login kilo or use /toggle-kilo to access paid models.
 *
 * Responds to global free-only filter for free/paid model filtering.
 *
 * Usage:
 *   pi install git:github.com/apmantza/pi-free
 *   # Free models visible immediately; /login kilo for paid access
 */

import type { Api, Model, OAuthCredentials } from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import {
	getKiloFreeOnly,
	getKiloShowPaid,
	PROVIDER_KILO,
	saveConfig,
} from "../../config.ts";
import { URL_KILO_TOS } from "../../constants.ts";
import { isFreeModel, registerWithGlobalToggle } from "../../lib/registry.ts";
import { wrapSessionStartHandler } from "../../lib/session-start-metrics.ts";
import { cleanModelName, logWarning } from "../../lib/util.ts";
import {
	createCtxReRegister,
	createReRegister,
	enhanceWithCI,
	type StoredModels,
} from "../../provider-helper.ts";
import { loginKilo, refreshKiloToken } from "./kilo-auth.ts";
import { fetchKiloModels, KILO_GATEWAY_BASE } from "./kilo-models.ts";

const KILO_PROVIDER_CONFIG = {
	providerId: PROVIDER_KILO,
	baseUrl: KILO_GATEWAY_BASE,
	apiKey: "$KILO_API_KEY",
	headers: {
		"X-KILOCODE-EDITORNAME": "Pi",
	},
};

export default async function kiloProvider(pi: ExtensionAPI) {
	// Try to fetch ALL models at startup (like Cline/OpenRouter)
	// If no API key, this will return free models only
	let allModels: ProviderModelConfig[] = [];
	let freeModels: ProviderModelConfig[] = [];

	try {
		// Fetch all models (returns free-only if no auth, all if auth available)
		allModels = await fetchKiloModels({ freeOnly: false });
		// Derive free list using isFreeModel with allModels for detection
		freeModels = allModels.filter((m) =>
			isFreeModel({ ...m, provider: PROVIDER_KILO }, allModels),
		);
	} catch (error) {
		logWarning("kilo", "Failed to fetch models at startup", error);
		// Fallback: try to fetch just free models
		try {
			freeModels = await fetchKiloModels({ freeOnly: true });
		} catch (e) {
			logWarning("kilo", "Failed to fetch free models", e);
		}
	}

	// State tracking
	const kiloShowPaid = getKiloShowPaid();
	const kiloFreeOnly = getKiloFreeOnly();
	let showPaidModels = kiloShowPaid;
	let currentModels = kiloShowPaid && !kiloFreeOnly ? allModels : freeModels;

	// Shared model storage for global toggle
	const stored: StoredModels = { free: freeModels, all: allModels };

	// Create re-register function
	const reRegister = createReRegister(pi, {
		...KILO_PROVIDER_CONFIG,
	});

	// Register with global toggle system
	registerWithGlobalToggle(
		PROVIDER_KILO,
		stored,
		reRegister,
		!!process.env.KILO_API_KEY,
	);

	// OAuth config for Kilo
	const oauthConfig = {
		name: "Kilo",
		login: async (callbacks: any) => {
			const cred = await loginKilo(callbacks);
			try {
				// Fetch all models with the new token
				const newModels = await fetchKiloModels({
					token: cred.access,
					freeOnly: false,
				});
				allModels = newModels;
				stored.all = allModels;
				freeModels = allModels.filter((m) =>
					isFreeModel({ ...m, provider: PROVIDER_KILO }, allModels),
				);
				stored.free = freeModels;

				// Update global toggle registration with new lists
				const globalReRegister = createReRegister(pi, {
					...KILO_PROVIDER_CONFIG,
				});
				registerWithGlobalToggle(PROVIDER_KILO, stored, globalReRegister, true);

				// If paid mode is enabled, show all models
				if (showPaidModels && !kiloFreeOnly) {
					currentModels = allModels;
					globalReRegister(allModels);
				}
			} catch (error) {
				logWarning("kilo", "Failed to fetch models after login", error);
			}
			return cred;
		},
		refreshToken: refreshKiloToken,
		getApiKey: (cred: OAuthCredentials) => cred.access,
		modifyModels: (models: Model<Api>[], _cred: OAuthCredentials) => {
			if (!showPaidModels || kiloFreeOnly || allModels.length === 0) {
				return models;
			}
			const template = models.find((m) => m.provider === PROVIDER_KILO);
			if (!template) return models;
			const nonKilo = models.filter((m) => m.provider !== PROVIDER_KILO);
			const fullModels = allModels.map((m) => ({
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

	// Register initial provider (default to free models)
	pi.registerProvider(PROVIDER_KILO, {
		baseUrl: KILO_GATEWAY_BASE,
		apiKey: "$KILO_API_KEY",
		api: "openai-completions" as const,
		headers: {
			"X-KILOCODE-EDITORNAME": "Pi",
			"User-Agent": "pi-free-providers",
		},
		models: enhanceWithCI(currentModels),
		oauth: oauthConfig,
	});

	// Registration complete - models registered silently (use LOG_LEVEL=info to see details)

	// Per-provider toggle command
	pi.registerCommand("toggle-kilo", {
		description: "Toggle between free and all Kilo models",
		handler: async (_args, ctx) => {
			showPaidModels = !showPaidModels;
			saveConfig({ kilo_show_paid: showPaidModels });

			// Determine which models to show
			const modelsToShow =
				showPaidModels && allModels.length > 0 ? allModels : freeModels;

			currentModels = modelsToShow;
			reRegister(modelsToShow);

			const freeCount = freeModels.length;
			const paidCount = allModels.length - freeCount;

			if (showPaidModels && allModels.length > 0) {
				ctx.ui.notify(
					`kilo: showing all ${allModels.length} models (${freeCount} free, ${paidCount} paid)`,
					"info",
				);
			} else {
				ctx.ui.notify(
					`kilo: showing ${freeCount} free models (${paidCount} paid hidden)`,
					"info",
				);
			}
		},
	});

	// Status bar + ToS notice on provider selection
	let tosShown = false;
	pi.on("model_select", async (_event, ctx) => {
		if (ctx.model?.provider !== PROVIDER_KILO) {
			ctx.ui.setStatus(`${PROVIDER_KILO}-status`, undefined);
			return;
		}

		// Build status line
		const free = freeModels.length;
		const total = allModels.length;
		const paid = total - free;
		let status: string;
		if (paid === 0) {
			status = `kilo: ${free} free models`;
		} else if (showPaidModels) {
			status = `kilo: ${total} models (free + paid)`;
		} else {
			status = `kilo: ${free} free \u00b7 ${paid} paid`;
		}
		ctx.ui.setStatus(`${PROVIDER_KILO}-status`, status);

		// ToS notice (once)
		if (tosShown) return;
		tosShown = true;
		const cred = ctx.modelRegistry.authStorage.get(PROVIDER_KILO);
		if (cred?.type === "oauth") return;
		const paidCount = allModels.length - freeModels.length;
		if (paidCount > 0) {
			ctx.ui.notify(
				`Kilo: ${freeModels.length} free models shown. Use /toggle-kilo or /login kilo for ${paidCount} paid models. Terms: ${URL_KILO_TOS}`,
				"info",
			);
		}
	});

	// Refresh models on session start if authenticated
	let refreshInFlight: Promise<void> | undefined;
	pi.on(
		"session_start",
		wrapSessionStartHandler("kilo", (_event, ctx) => {
			const cred = ctx.modelRegistry.authStorage.get(PROVIDER_KILO);
			if (cred?.type !== "oauth" || refreshInFlight) return Promise.resolve();

			refreshInFlight = fetchKiloModels({ token: cred.access, freeOnly: false })
				.then((newModels) => {
					allModels = newModels;
					stored.all = allModels;
					freeModels = allModels.filter((m) =>
						isFreeModel({ ...m, provider: PROVIDER_KILO }, allModels),
					);
					stored.free = freeModels;

					// Update global toggle registration
					const ctxReRegister = createCtxReRegister(ctx as any, {
						...KILO_PROVIDER_CONFIG,
					});
					registerWithGlobalToggle(PROVIDER_KILO, stored, ctxReRegister, true);

					// Apply current view mode
					if (showPaidModels && !getKiloFreeOnly()) {
						ctxReRegister(allModels);
					}
				})
				.catch((error) => {
					logWarning(
						"kilo",
						"Failed to refresh models at session start",
						error instanceof Error ? error.message : String(error),
					);
				})
				.finally(() => {
					refreshInFlight = undefined;
				});
			return Promise.resolve();
		}),
	);
}
