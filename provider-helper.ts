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
import { createLogger } from "./lib/logger.ts";
import { incrementRequestCount } from "./metrics.js";
import { incrementModelRequestCount } from "./usage/tracking.ts";

const _logger = createLogger("provider-helper");

// =============================================================================
// Global free models cache for model hopping
// =============================================================================

export const freeModelsCache: Array<{
	provider: string;
	model: ProviderModelConfig;
}> = [];

export function addToFreeModelsCache(
	provider: string,
	models: ProviderModelConfig[],
): void {
	// Remove existing models for this provider first
	const _idx = freeModelsCache.findIndex((m) => m.provider === provider);
	while (freeModelsCache.findIndex((m) => m.provider === provider) !== -1) {
		freeModelsCache.splice(
			freeModelsCache.findIndex((m) => m.provider === provider),
			1,
		);
	}
	// Add new models
	for (const model of models) {
		freeModelsCache.push({ provider, model });
	}
	_logger.info(`Cached ${models.length} free models for ${provider}`);
}

import { enhanceModelNameWithCodingIndex } from "./provider-failover/hardcoded-benchmarks.js";
import {
	handleProviderError,
	isProviderExhausted,
	resetFailureCount,
} from "./provider-failover/index.js";
import { handleModelHop } from "./provider-failover/model-hop.js";

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
		...(oauth && { oauth }),
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
			...(oauth && { oauth }),
		});
	};
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
		// Update global free models cache for model hopping
		addToFreeModelsCache(providerId, s.free);
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
			_logger.info("Error detected", {
				provider: providerId,
				error: errorMsg.slice(0, 100),
			});

			// Store last user message for potential auto-retry
			const lastUserMsg = (
				event as {
					branch?: Array<{
						type?: string;
						message?: { role?: string; content?: string };
					}>;
				}
			).branch
				?.slice()
				.reverse()
				.find((e) => e.type === "message" && e.message?.role === "user")
				?.message?.content;

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

				// Auto-retry with last user message after compact
				if (lastUserMsg) {
					setTimeout(async () => {
						ctx.ui.notify("🔄 Auto-retrying after compact...", "info");
						await (pi as any).sendUserMessage?.(lastUserMsg, {
							deliverAs: "steer",
						});
					}, result.retryDelayMs ?? 2000);
				}
			} else if (result.action === "failover") {
				ctx.ui.notify(result.message, "warning");
				if (isProviderExhausted(providerId)) {
					ctx.ui.setStatus(
						`${providerId}-status`,
						ctx.ui.theme.fg("dim", "⚠️ Rate limited - consider switching"),
					);
				}

				// Attempt intelligent model hop
				const currentModelId = ctx.model?.id ?? "";
				const currentModelName = ctx.model?.name ?? currentModelId;

				try {
					const hopResult = await handleModelHop(
						pi,
						{
							ui: ctx.ui as {
								notify: (
									msg: string,
									type: "info" | "warning" | "error",
								) => void;
							},
							sessionManager: {
								getBranch: () => {
									// Try to get branch from event, fallback to empty
									const branch = (
										event as {
											branch?: Array<{
												type: string;
												message?: { role?: string; content?: unknown };
											}>;
										}
									).branch;
									return (branch ?? []).map((e) => ({
										type: e.type ?? "message",
										message: e.message
											? {
													role: e.message.role,
													content:
														typeof e.message.content === "string"
															? e.message.content
															: Array.isArray(e.message.content)
																? e.message.content
																		.map(
																			(c: unknown) =>
																				(c as { text?: string }).text ?? "",
																		)
																		.join("")
																: "",
												}
											: undefined,
									}));
								},
							},
							modelRegistry: {
								getAvailable: () => {
									// Use our free models cache - only providers we actually registered
									return freeModelsCache
										.filter((m) => m.provider !== providerId)
										.map((m) => ({ ...m.model, provider: m.provider })) as any[];
								},
							},
							session: (ctx as { session?: { id?: string } }).session,
						},
						providerId,
						currentModelId,
						currentModelName,
						errorMsg,
						{
							isPaidMode: config.isPaidMode ?? false,
							allowDowngrades: "minor",
							maxHops: 3,
						},
					);

					if (hopResult.success) {
						ctx.ui.notify(`✅ ${hopResult.message}`, "info");
					} else {
						// Hop failed, notify user
						ctx.ui.notify(`❌ ${hopResult.message}`, "warning");
					}
				} catch (err) {
					_logger.error("Model hop failed", err);
					ctx.ui.notify(
						"Model hop failed, try /model to switch manually",
						"warning",
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
			// Extract token usage from the event if available
			const msg = (
				event as {
					message?: {
						usage?: {
							input?: number;
							output?: number;
							cacheRead?: number;
							cacheWrite?: number;
							cost?: { total?: number };
						};
					};
				}
			).message;
			const tokensIn = msg?.usage?.input ?? 0;
			const tokensOut = msg?.usage?.output ?? 0;
			const cacheRead = msg?.usage?.cacheRead ?? 0;
			const cacheWrite = msg?.usage?.cacheWrite ?? 0;
			const cost = msg?.usage?.cost?.total ?? 0;
			incrementModelRequestCount(
				providerId,
				modelId,
				tokensIn,
				tokensOut,
				cacheRead,
				cacheWrite,
				cost,
			);
		}

		resetFailureCount(providerId);
	});

	// ── One-time ToS notice on first free use ────────────────────────────

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

	// ── Initialize free models cache ────────────────────────────────
	addToFreeModelsCache(providerId, stored.free);
}
