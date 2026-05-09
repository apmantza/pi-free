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

import type { Api, Model } from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import { getOpencodeShowPaid, getOpenrouterShowPaid } from "../config.ts";
import { createLogger } from "./logger.ts";
import { isFreeModel, registerWithGlobalToggle } from "./registry.ts";
import { createToggleState } from "./toggle-state.ts";

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
	stored: { free: ProviderModelConfig[]; all: ProviderModelConfig[] };
	reRegister: (models: ProviderModelConfig[]) => void;
	toggleState: ReturnType<typeof createToggleState<ProviderModelConfig>>;
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
		setupStatusBar(pi);
		commandsRegistered = true;
	}

	// Capture built-in models on session start and apply initial filter
	pi.on("session_start", async (_event, ctx) => {
		for (const config of BUILT_IN_TOGGLE_PROVIDERS) {
			if (providerStates.has(config.id)) {
				// Already captured — skip to avoid re-registering
				continue;
			}

			const state = tryCaptureProvider(pi, config, ctx);
			if (!state) continue;

			const applied = state.toggleState.applyCurrent(state.reRegister);
			_logger.info(
				`[built-in-toggle] ${config.id}: applied ${applied.mode} mode with ${applied.models.length} models`,
			);
		}
	});
}

// =============================================================================
// On-demand model capture (called by toggle command when state is missing)
// =============================================================================

function tryCaptureProvider(
	pi: ExtensionAPI,
	config: BuiltInToggleConfig,
	ctx: any,
): BuiltInProviderState | undefined {
	const available = ctx.modelRegistry.getAvailable();
	const providerModels = available.filter(
		(m: Model<Api>) => m.provider === config.id,
	);
	if (providerModels.length === 0) return undefined;

	const allModels = providerModels.map(modelToProviderConfig);
	const freeModels = allModels.filter((m: ProviderModelConfig) =>
		isFreeModel({ ...m, provider: config.id }, allModels),
	);

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

	const stored = { free: freeModels, all: allModels };
	const toggleState = createToggleState<ProviderModelConfig>({
		providerId: config.id,
		initialShowPaid: config.getShowPaid(),
		initialModels: stored,
	});

	const state: BuiltInProviderState = { stored, reRegister, toggleState };
	providerStates.set(config.id, state);

	registerWithGlobalToggle(config.id, stored, reRegister, true);

	_logger.info(
		`[built-in-toggle] ${config.id}: captured ${allModels.length} models (${freeModels.length} free)`,
	);

	return state;
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
			let state = providerStates.get(config.id);
			if (!state) {
				// Models may have loaded after session_start — try on-demand capture
				state = tryCaptureProvider(pi, config, ctx);
				if (!state) {
					ctx.ui.notify(
						`${config.id}: models not loaded yet. Start a session first.`,
						"warning",
					);
					return;
				}
			}

			const applied = state.toggleState.toggle(state.reRegister);

			if (applied.mode === "all") {
				ctx.ui.notify(
					`${config.id}: showing all ${state.stored.all.length} models`,
					"info",
				);
			} else {
				ctx.ui.notify(
					`${config.id}: showing ${state.stored.free.length} free models`,
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

// =============================================================================
// Status bar for provider selection
// =============================================================================

function setupStatusBar(pi: ExtensionAPI): void {
	pi.on("model_select", (_event, ctx) => {
		const selected = _event.model?.provider;

		// Clear status for all built-in toggle providers
		for (const config of BUILT_IN_TOGGLE_PROVIDERS) {
			if (selected !== config.id) {
				ctx.ui.setStatus(`${config.id}-status`, undefined);
			}
		}

		if (!selected) return;

		const state = providerStates.get(selected);
		if (!state) return;

		const free = state.stored.free.length;
		const total = state.stored.all.length;
		const paid = total - free;
		const mode = state.toggleState.getCurrentMode();
		let status: string;
		if (paid === 0) {
			status = `${selected}: ${free} free models`;
		} else if (mode === "all") {
			status = `${selected}: ${total} models (free + paid)`;
		} else {
			status = `${selected}: ${free} free \u00b7 ${paid} paid`;
		}
		ctx.ui.setStatus(`${selected}-status`, status);
	});
}

function getApiKeyEnvForProvider(providerId: string): string {
	const envMap: Record<string, string> = {
		opencode: "OPENCODE_API_KEY",
		openrouter: "OPENROUTER_API_KEY",
	};
	return envMap[providerId] || `${providerId.toUpperCase()}_API_KEY`;
}
