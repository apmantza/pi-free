/**
 * Shared provider setup helpers for pi-free-providers.
 * Extracts the common boilerplate pattern repeated across providers:
 *   - /{provider}-free and /{provider}-all toggle commands
 *   - model_select handler (clear status for other providers)
 *   - turn_end handler (increment request count)
 *   - before_agent_start handler (one-time ToS notice)
 */

import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@mariozechner/pi-coding-agent";
import { incrementModelRequestCount } from "./free-tier-limits.js";
import { incrementRequestCount } from "./metrics";
import {
	handleProviderError,
	isProviderExhausted,
	resetFailureCount,
} from "./provider-failover";
import { enhanceModelNameWithCodingIndex } from "./provider-failover/hardcoded-benchmarks.js";

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
	/** Whether this provider is in paid mode (shows paid models). */
	isPaidMode?: boolean;
	/** Whether to suggest autocompact on 429 errors (free mode only). Default: true */
	enableAutocompact?: boolean;
	/**
	 * Called by /{provider}-free and /{provider}-all commands to re-register
	 * the provider with the given model set. Receives the model array and a
	 * reference to the stored models object so it can update the pointers.
	 */
	reRegister: (models: ProviderModelConfig[], stored: StoredModels) => void;
	/** Optional custom error handler. Return true if handled. */
	onError?: (
		error: unknown,
		ctx: {
			ui: { notify: (m: string, t: "info" | "warning" | "error") => void };
		},
	) => Promise<boolean>;
}

export interface StoredModels {
	free: ProviderModelConfig[];
	all: ProviderModelConfig[];
}

// =============================================================================
// Setup
// =============================================================================

/**
 * Wire up common provider event handlers and toggle commands.
 *
 * Call this after your provider's initial `pi.registerProvider()` call.
 * Each provider still owns its own registration timing and custom handlers
 * (OAuth, message reshaping, footer, etc.) — this only handles the shared
 * parts.
 *
 * @param pi        Extension API
 * @param config    Provider setup config
 * @param stored    Mutable reference to stored free/all model arrays
 */
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

export function setupProvider(
	pi: ExtensionAPI,
	config: ProviderSetupConfig,
	stored: StoredModels,
): void {
	const { providerId, tosUrl } = config;

	// Wrap reRegister to automatically add CI scores to all models
	const reRegister = (models: ProviderModelConfig[], s: StoredModels) => {
		const enhanced = enhanceWithCI(models);
		config.reRegister(enhanced, s);
	};

	// ── Toggle commands ──────────────────────────────────────────────────

	pi.registerCommand(`${providerId}-free`, {
		description: `Show only free ${providerId} models`,
		handler: async (_args, ctx) => {
			if (stored.free.length === 0) {
				ctx.ui.notify("No free models loaded", "warning");
				return;
			}
			reRegister(stored.free, stored);
			ctx.ui.notify(
				`${providerId}: showing ${stored.free.length} free models`,
				"info",
			);
		},
	});

	pi.registerCommand(`${providerId}-all`, {
		description: `Show all ${providerId} models (free + paid)`,
		handler: async (_args, ctx) => {
			if (stored.all.length === 0) {
				ctx.ui.notify("No models loaded", "warning");
				return;
			}
			reRegister(stored.all, stored);
			ctx.ui.notify(
				`${providerId}: showing all ${stored.all.length} models`,
				"info",
			);
		},
	});

	// ── Clear status when another provider is selected ───────────────────

	pi.on("model_select", (_event, ctx) => {
		if (_event.model?.provider !== providerId) {
			ctx.ui.setStatus(`${providerId}-status`, undefined);
		}
	});

	// ── Track request count, reset failure count, handle errors ──────────

	pi.on("turn_end", async (event, ctx) => {
		if (ctx.model?.provider !== providerId) return;

		const msg = (
			event as { message?: { role?: string; errorMessage?: string } }
		).message;

		// Check for errors in the assistant message
		if (msg?.role === "assistant" && msg.errorMessage) {
			const errorMsg = msg.errorMessage;
			console.log(`[${providerId}] Error detected: ${errorMsg.slice(0, 100)}`);

			// Use custom error handler if provided
			if (config.onError) {
				const handled = await config.onError(errorMsg, ctx);
				if (handled) return;
			}

			// Use default failover handler
			const result = await handleProviderError(
				errorMsg,
				{
					provider: providerId,
					isPaidMode: config.isPaidMode ?? false,
					enableAutocompact: config.enableAutocompact ?? true,
				},
				pi,
				ctx as {
					ui: {
						notify: (m: string, t: "info" | "warning" | "error") => void;
					};
					session?: { id?: string };
				},
			);

			// Show notification based on result
			if (result.action === "autocompact") {
				ctx.ui.notify(result.message, "warning");
			} else if (result.action === "failover") {
				ctx.ui.notify(result.message, "warning");
				if (isProviderExhausted(providerId)) {
					ctx.ui.setStatus(
						`${providerId}-status`,
						ctx.ui.theme.fg("dim", "⚠️ Rate limited - consider switching"),
					);
				}
			} else if (result.action === "fail") {
				ctx.ui.notify(result.message, "error");
			}

			// Don't reset failure count on error
			return;
		}

		// Success - reset failure count and increment metrics
		incrementRequestCount(providerId);

		// Track per-model usage if we have a model selected
		const modelId = ctx.model?.id;
		if (modelId) {
			incrementModelRequestCount(providerId, modelId);
		}

		resetFailureCount(providerId);
	});

	// ── One-time ToS notice on first free use ────────────────────────────

	if (tosUrl) {
		let tosShown = false;
		pi.on("before_agent_start", async (_event, ctx) => {
			if (tosShown || ctx.model?.provider !== providerId) return;
			tosShown = true;
			if (config.hasKey) return;
			const cred = ctx.modelRegistry.authStorage.get(providerId);
			if (cred?.type === "oauth") return;
			return {
				message: {
					customType: providerId,
					content: `Using ${providerId} free models. Set API key for paid access.\nTerms: ${tosUrl}`,
					display: "inline" as const,
				},
			};
		});
	}
}
