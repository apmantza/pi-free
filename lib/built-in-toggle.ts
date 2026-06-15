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
import {
	getProviderRegistry,
	isFreeModel,
	registerWithGlobalToggle,
} from "./registry.ts";
import { wrapSessionStartHandler } from "./session-start-metrics.ts";
import { createToggleState } from "./toggle-state.ts";
import {
	OPENCODE_DYNAMIC_API,
	createOpenCodeSessionTracker,
	createOpenCodeStreamSimple,
	isOpenCodeProvider,
} from "../providers/opencode-session.ts";

const _logger = createLogger("built-in-toggle");

// OpenCode requires per-request ids; see createOpenCodeStreamSimple().
// Lazy-initialised because the OpenCode dynamic fetcher in
// providers/dynamic-built-in/ usually wins the race for `opencode`,
// leaving this fallback capture unused — no point allocating the
// session tracker on every module import.
let _opencodeSession: ReturnType<typeof createOpenCodeSessionTracker> | null =
	null;
function getOpenCodeSession() {
	if (!_opencodeSession) _opencodeSession = createOpenCodeSessionTracker();
	return _opencodeSession;
}

// =============================================================================
// Configuration
// =============================================================================

interface BuiltInToggleConfig {
	id: string;
	getShowPaid: () => boolean;
}

const BUILT_IN_TOGGLE_PROVIDERS: BuiltInToggleConfig[] = [
	{ id: "opencode", getShowPaid: getOpencodeShowPaid },
	{ id: "opencode-go", getShowPaid: getOpencodeShowPaid },
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
	const activeConfigs = BUILT_IN_TOGGLE_PROVIDERS.filter(
		(config) => !getProviderRegistry().has(config.id),
	);

	if (activeConfigs.length === 0) {
		_logger.info(
			"[built-in-toggle] OpenCode/OpenRouter already registered dynamically; skipping fallback capture",
		);
		return;
	}

	// Register toggle commands once (available even before models load)
	if (!commandsRegistered) {
		for (const config of activeConfigs) {
			registerToggleCommand(pi, config);
		}
		commandsRegistered = true;
	}

	// Capture built-in models on session start and apply initial filter
	pi.on(
		"session_start",
		wrapSessionStartHandler("built-in-toggle", async (_event, ctx) => {
			for (const config of activeConfigs) {
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
		}),
	);
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

	const allModels = providerModels.map((m: Model<Api>) =>
		modelToProviderConfig(m, config.id),
	);
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
			api: isOpenCodeProvider(config.id) ? OPENCODE_DYNAMIC_API : api,
			...(isOpenCodeProvider(config.id)
				? { streamSimple: createOpenCodeStreamSimple(getOpenCodeSession()) }
				: {}),
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

function modelToProviderConfig(
	m: Model<Api>,
	providerId?: string,
): ProviderModelConfig {
	const base: ProviderModelConfig = {
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

	// Use a custom OpenCode API wrapper so per-request headers are regenerated
	// for every LLM call instead of being frozen at registration time.
	if (providerId && isOpenCodeProvider(providerId)) {
		base.api = OPENCODE_DYNAMIC_API;
	}

	return base;
}

function getApiKeyEnvForProvider(providerId: string): string {
	const envMap: Record<string, string> = {
		opencode: "$OPENCODE_API_KEY",
		"opencode-go": "$OPENCODE_API_KEY",
		openrouter: "$OPENROUTER_API_KEY",
	};
	return envMap[providerId] || `$${providerId.toUpperCase()}_API_KEY`;
}
