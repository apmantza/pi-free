/**
 * Shared provider setup helpers for pi-free-providers.
 * Extracts the common boilerplate pattern repeated across providers:
 *   - /{provider}-toggle command to switch between free/paid models
 *   - model_select handler (clear status for other providers)
 *   - turn_end handler (provider-specific error hook)
 *   - before_agent_start handler (one-time ToS notice)
 */

import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@mariozechner/pi-coding-agent";
import { saveConfig } from "./config.ts";
import { createLogger } from "./lib/logger.ts";
import { enhanceModelNameWithCodingIndex } from "./provider-failover/hardcoded-benchmarks.ts";
import type { AutoSwitchConfig } from "./provider-failover/auto-switch.ts";

const _logger = createLogger("provider-helper");

// =============================================================================
// Types
// =============================================================================

export interface ProviderSetupConfig {
	/** Provider identifier (e.g., "kilo", "openrouter"). */
	providerId: string;
	/** Terms of service URL. If set, shows a one-time notice on first free use. */
	tosUrl?: string;
	/** When true, suppresses the "free models / set API key" ToS notice. */
	hasKey?: boolean;
	/** Initial mode - auto-detected from config at startup. */
	initialShowPaid?: boolean;
	/**
	 * Called by /{provider}-toggle command to re-register
	 * the provider with the given model set.
	 */
	reRegister: (models: ProviderModelConfig[], stored: StoredModels) => void;
	/** Optional custom error handler. Return true if handled. */
	onError?: (
		error: unknown,
		ctx: {
			ui: { notify: (m: string, t: "info" | "warning" | "error") => void };
		},
	) => Promise<boolean>;
	/** Auto-switch configuration for failover. If enabled, will automatically switch providers on rate limits. */
	autoSwitch?: Partial<AutoSwitchConfig>;
}

export interface StoredModels {
	free: ProviderModelConfig[];
	all: ProviderModelConfig[];
}

// =============================================================================
// Provider Registration Helpers
// =============================================================================

export interface OpenAICompatibleConfig {
	/** Provider identifier (e.g., "nvidia", "fireworks") */
	providerId: string;
	/** Base URL for the API */
	baseUrl: string;
	/** Environment variable name for the API key */
	apiKey: string;
	/** Additional headers to include */
	headers?: Record<string, string>;
	/** OAuth configuration (optional) */
	oauth?: {
		name: string;
		login: (callbacks: unknown) => Promise<unknown>;
		refreshToken?: (cred: unknown) => Promise<unknown>;
		getApiKey?: (cred: unknown) => string;
	};
}

/**
 * Enhance all model names with Coding Index scores
 * Use this for direct provider registration (not through setupProvider)
 */
export function enhanceWithCI(
	models: ProviderModelConfig[],
): ProviderModelConfig[] {
	return models.map((m) => ({
		...m,
		name: enhanceModelNameWithCodingIndex(m.name, m.id),
	}));
}

/**
 * Register an OpenAI-compatible provider with standard headers.
 * Reduces boilerplate across providers that use the OpenAI API format.
 */
export function registerOpenAICompatible(
	pi: ExtensionAPI,
	config: OpenAICompatibleConfig,
	models: ProviderModelConfig[],
): void {
	const { providerId, baseUrl, apiKey, headers, oauth } = config;

	pi.registerProvider(providerId, {
		baseUrl,
		apiKey,
		api: "openai-completions" as const,
		headers: {
			"User-Agent": "pi-free-providers",
			...headers,
		},
		models: enhanceWithCI(models),
		...(oauth && { oauth: oauth as any }),
	});
}

/**
 * Create a reRegister function for use with setupProvider.
 * Returns a function that re-registers the provider with new models.
 */
export function createReRegister(
	pi: ExtensionAPI,
	config: OpenAICompatibleConfig,
): (models: ProviderModelConfig[]) => void {
	return (models: ProviderModelConfig[]) => {
		registerOpenAICompatible(pi, config, models);
	};
}

/**
 * Create a reRegister function that uses ctx.modelRegistry.registerProvider.
 * Used by providers that need to register with runtime context (session_start handlers).
 */
export function createCtxReRegister(
	ctx: {
		modelRegistry: { registerProvider: (id: string, config: unknown) => void };
	},
	config: OpenAICompatibleConfig,
): (models: ProviderModelConfig[]) => void {
	const { providerId, baseUrl, apiKey, headers, oauth } = config;

	return (models: ProviderModelConfig[]) => {
		ctx.modelRegistry.registerProvider(providerId, {
			baseUrl,
			apiKey,
			api: "openai-completions" as const,
			headers: {
				"User-Agent": "pi-free-providers",
				...headers,
			},
			models: enhanceWithCI(models),
			...(oauth && { oauth: oauth as any }),
		});
	};
}

/**
 * Get the config key name for a provider's show_paid setting.
 */
function getShowPaidConfigKey(providerId: string): string {
	return `${providerId}_show_paid`;
}

export function setupProvider(
	pi: ExtensionAPI,
	config: ProviderSetupConfig,
	stored: StoredModels,
): void {
	const { providerId, tosUrl, initialShowPaid = false } = config;

	// Track current mode (synced with config)
	let currentShowPaid = initialShowPaid;

	// Wrap reRegister to automatically add CI scores to all models
	const reRegister = (models: ProviderModelConfig[], _s: StoredModels) => {
		const enhanced = enhanceWithCI(models);
		config.reRegister(enhanced, _s);
	};

	// ── Single toggle command ──────────────────────────────────────────

	pi.registerCommand(`${providerId}-toggle`, {
		description: `Toggle between free and all ${providerId} models`,
		handler: async (_args, ctx) => {
			// Toggle the mode
			currentShowPaid = !currentShowPaid;

			// Persist to config file
			const configKey = getShowPaidConfigKey(providerId);
			saveConfig({ [configKey]: currentShowPaid });

			// Re-register with appropriate model set
			if (currentShowPaid) {
				if (stored.all.length === 0) {
					ctx.ui.notify("No models available", "warning");
					return;
				}
				reRegister(stored.all, stored);
				ctx.ui.notify(
					`${providerId}: showing all ${stored.all.length} models (including paid)`,
					"info",
				);
			} else {
				if (stored.free.length === 0) {
					ctx.ui.notify("No free models loaded", "warning");
					return;
				}
				reRegister(stored.free, stored);
				ctx.ui.notify(
					`${providerId}: showing ${stored.free.length} free models`,
					"info",
				);
			}
		},
	});

	// ── Clear status when another provider is selected ───────────────────

	pi.on("model_select", (_event, ctx) => {
		if (_event.model?.provider !== providerId) {
			ctx.ui.setStatus(`${providerId}-status`, undefined);
		}
	});

	// ── Error handling / usage tracking are temporarily deprecated ─────────

	pi.on("turn_end", async (event, ctx) => {
		if (ctx.model?.provider !== providerId) return;

		const msg = (
			event as { message?: { role?: string; errorMessage?: string } }
		).message;

		if (msg?.role === "assistant" && msg.errorMessage) {
			_logger.info("Provider error (auto model hopping disabled)", {
				provider: providerId,
				error: msg.errorMessage.slice(0, 100),
			});

			// Keep custom handlers working for provider-specific logic.
			if (config.onError) {
				await config.onError(msg.errorMessage, ctx);
			}
		}
	});

	// ── ToS notice on first use ────────────────────────────────
	if (tosUrl) {
		let tosShown = false;
		pi.on("model_select", async (_event, ctx) => {
			if (tosShown || ctx.model?.provider !== providerId) return;
			tosShown = true;
			if (config.hasKey) return;
			const cred = ctx.modelRegistry.authStorage.get(providerId);
			if (cred?.type === "oauth") return;
			ctx.ui.notify(
				`Using ${providerId} free models. Set API key for paid access. Terms: ${tosUrl}`,
				"info",
			);
		});
	}
}
