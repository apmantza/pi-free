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

import type { Api, Model } from "@earendil-works/pi-ai/compat";
import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import {
	getOpencodeShowPaid,
	getOpenrouterShowPaid,
} from "../config.ts";
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
	ensureOpenCodeApiProviderRegistered,
	isOpenCodeProvider,
} from "../providers/opencode-session.ts";

const _logger = createLogger("built-in-toggle");

// OpenCode requires per-request ids; see createOpenCodeStreamSimple().
// Keep the tracker lazy because Pi owns the built-in catalog and this module
// only needs the custom stream when a filtered catalog is re-registered.
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
	baseUrl: string;
	api: Api;
}

const BUILT_IN_TOGGLE_PROVIDERS: BuiltInToggleConfig[] = [
	{
		id: "opencode",
		getShowPaid: getOpencodeShowPaid,
		baseUrl: "https://opencode.ai/zen/v1",
		api: OPENCODE_DYNAMIC_API,
	},
	{
		id: "opencode-go",
		getShowPaid: getOpencodeShowPaid,
		baseUrl: "https://opencode.ai/zen/go/v1",
		api: OPENCODE_DYNAMIC_API,
	},
	{
		id: "openrouter",
		getShowPaid: getOpenrouterShowPaid,
		baseUrl: "https://openrouter.ai/api/v1",
		api: "openai-completions",
	},
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
			"[built-in-toggle] OpenCode/OpenRouter already registered; skipping capture",
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
// Model capture (called on session start or by toggle when state is missing)
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
		modelToProviderConfig(m),
	);

	return createProviderState(pi, config, {
		allModels,
		baseUrl: providerModels[0].baseUrl,
		api: providerModels[0].api,
		apiKey: getApiKeyEnvForProvider(config.id),
		source: "captured",
	});
}

function createProviderState(
	pi: ExtensionAPI,
	config: BuiltInToggleConfig,
	options: {
		allModels: ProviderModelConfig[];
		baseUrl: string;
		api: Api;
		apiKey?: string;
		source: "captured";
	},
): BuiltInProviderState {
	const { allModels, baseUrl, api, apiKey, source } = options;
	const freeModels = allModels.filter((m: ProviderModelConfig) =>
		isFreeModel({ ...m, provider: config.id }, allModels),
	);

	const reRegister = (models: ProviderModelConfig[]) => {
		// Ensure the opencode-dynamic API is registered in compat's global
		// registry so fallback code paths (compat streamSimple) can resolve it.
		if (isOpenCodeProvider(config.id)) {
			ensureOpenCodeApiProviderRegistered(getOpenCodeSession());
		}
		pi.registerProvider(config.id, {
			baseUrl,
			...(apiKey !== undefined ? { apiKey } : {}),
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
		`[built-in-toggle] ${config.id}: ${source} ${allModels.length} models (${freeModels.length} free)`,
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
				// Models may have loaded after session_start — try capture again.
				state = tryCaptureProvider(pi, config, ctx);
			}
			if (!state) {
				ctx.ui.notify(
					`${config.id}: models not loaded yet. Start a session first, then try again.`,
					"warning",
				);
				return;
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

	// The provider-level OpenCode wrapper still regenerates headers, while the
	// model-level API is preserved so Anthropic/Responses/Google routes remain
	// protocol-correct.
	return base;
}

function getApiKeyEnvForProvider(providerId: string): string | undefined {
	// OpenRouter is Pi's built-in provider. Do not supply an apiKey here:
	// re-registerProvider merges only defined fields, so omitting it preserves
	// Pi-managed OAuth credentials from /login openrouter (and refresh support).
	const envMap: Record<string, string> = {
		opencode: "$OPENCODE_API_KEY",
		"opencode-go": "$OPENCODE_API_KEY",
	};
	return envMap[providerId];
}
