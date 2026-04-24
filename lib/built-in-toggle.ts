/**
 * Built-in Provider Toggle Support
 *
 * Captures pi's built-in providers after session start and enables
 * free/paid toggling for them via the global registry.
 *
 * Currently supports:
 * - opencode (OpenCode / Zen gateway)
 * - openrouter (OpenRouter)
 *
 * Usage: /toggle-opencode
 */

import type { Api, Model } from "@mariozechner/pi-ai";
import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@mariozechner/pi-coding-agent";
import {
	getOpencodeShowPaid,
	getOpenrouterShowPaid,
	saveConfig,
} from "../config.ts";
import { createLogger } from "./logger.ts";
import {
	getGlobalFreeOnly,
	isFreeModel,
	registerWithGlobalToggle,
} from "./registry.ts";

const _logger = createLogger("built-in-toggle");

// =============================================================================
// Configuration
// =============================================================================

interface BuiltInToggleConfig {
	id: string;
	getShowPaid: () => boolean;
}

const BUILT_IN_TOGGLE_PROVIDERS: BuiltInToggleConfig[] = [
	{ id: "opencode", getShowPaid: getOpencodeShowPaid },
	{ id: "openrouter", getShowPaid: getOpenrouterShowPaid },
];

// =============================================================================
// State
// =============================================================================

interface BuiltInProviderState {
	free: ProviderModelConfig[];
	all: ProviderModelConfig[];
	reRegister: (models: ProviderModelConfig[]) => void;
	showPaid: boolean;
}

const providerStates = new Map<string, BuiltInProviderState>();
let commandsRegistered = false;

// =============================================================================
// Setup
// =============================================================================

export function setupBuiltInProviderToggles(pi: ExtensionAPI): void {
	// Register toggle commands once (available even before models load)
	if (!commandsRegistered) {
		for (const config of BUILT_IN_TOGGLE_PROVIDERS) {
			registerToggleCommand(pi, config);
		}
		commandsRegistered = true;
	}

	// Capture built-in models on session start and apply initial filter
	pi.on("session_start", async (_event, ctx) => {
		const available = ctx.modelRegistry.getAvailable();

		for (const config of BUILT_IN_TOGGLE_PROVIDERS) {
			if (providerStates.has(config.id)) {
				// Already captured this session — skip to avoid re-registering
				continue;
			}

			const providerModels = available.filter(
				(m: Model<Api>) => m.provider === config.id,
			);
			if (providerModels.length === 0) continue;

			const allModels = providerModels.map(modelToProviderConfig);
			const freeModels = allModels.filter(isFreeModel);

			const baseUrl = providerModels[0].baseUrl;
			const api = providerModels[0].api;
			const apiKeyEnv = getApiKeyEnvForProvider(config.id);

			const reRegister = (models: ProviderModelConfig[]) => {
				pi.registerProvider(config.id, {
					baseUrl,
					apiKey: apiKeyEnv,
					api,
					models,
				});
			};

			providerStates.set(config.id, {
				free: freeModels,
				all: allModels,
				reRegister,
				showPaid: config.getShowPaid(),
			});

			// Register with global free-only filter
			registerWithGlobalToggle(
				config.id,
				{ free: freeModels, all: allModels },
				reRegister,
				true,
			);

			_logger.info(
				`[built-in-toggle] ${config.id}: captured ${allModels.length} models (${freeModels.length} free)`,
			);

			// Respect global free-only setting at capture time
			if (!getGlobalFreeOnly() && !config.getShowPaid()) {
				// Default: show free only (same as other pi-free providers)
				if (freeModels.length > 0) {
					reRegister(freeModels);
					_logger.info(
						`[built-in-toggle] ${config.id}: applied free-only filter`,
					);
				}
			}
		}
	});
}

// =============================================================================
// Per-provider toggle command
// =============================================================================

function registerToggleCommand(
	pi: ExtensionAPI,
	config: BuiltInToggleConfig,
): void {
	const commandName = `toggle-${config.id}`;
	pi.registerCommand(commandName, {
		description: `Toggle free/paid ${config.id} models`,
		handler: async (_args, ctx) => {
			const state = providerStates.get(config.id);
			if (!state) {
				ctx.ui.notify(
					`${config.id}: models not loaded yet. Start a session first.`,
					"warning",
				);
				return;
			}

			state.showPaid = !state.showPaid;

			// Persist preference
			saveConfig({ [`${config.id}_show_paid`]: state.showPaid });

			if (state.showPaid) {
				state.reRegister(state.all);
				ctx.ui.notify(
					`${config.id}: showing all ${state.all.length} models`,
					"info",
				);
			} else {
				state.reRegister(state.free);
				ctx.ui.notify(
					`${config.id}: showing ${state.free.length} free models`,
					"info",
				);
			}
		},
	});
}

// =============================================================================
// Helpers
// =============================================================================

function modelToProviderConfig(m: Model<Api>): ProviderModelConfig {
	return {
		id: m.id,
		name: m.name,
		api: m.api,
		reasoning: m.reasoning,
		input: m.input,
		cost: m.cost,
		contextWindow: m.contextWindow,
		maxTokens: m.maxTokens,
		headers: m.headers,
		compat: (m as any).compat,
	};
}

function getApiKeyEnvForProvider(providerId: string): string {
	const envMap: Record<string, string> = {
		opencode: "OPENCODE_API_KEY",
		openrouter: "OPENROUTER_API_KEY",
	};
	return envMap[providerId] || `${providerId.toUpperCase()}_API_KEY`;
}
