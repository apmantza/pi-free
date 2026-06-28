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
import {
	getOpencodeApiKey,
	getOpencodeShowPaid,
	getOpenrouterApiKey,
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
import { fetchWithTimeout } from "./util.ts";
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
	baseUrl: string;
	api: Api;
	getApiKey: () => string | undefined;
}

const BUILT_IN_TOGGLE_PROVIDERS: BuiltInToggleConfig[] = [
	{
		id: "opencode",
		getShowPaid: getOpencodeShowPaid,
		baseUrl: "https://opencode.ai/zen/v1",
		api: OPENCODE_DYNAMIC_API,
		getApiKey: getOpencodeApiKey,
	},
	{
		id: "opencode-go",
		getShowPaid: getOpencodeShowPaid,
		baseUrl: "https://opencode.ai/zen/go/v1",
		api: OPENCODE_DYNAMIC_API,
		getApiKey: getOpencodeApiKey,
	},
	{
		id: "openrouter",
		getShowPaid: getOpenrouterShowPaid,
		baseUrl: "https://openrouter.ai/api/v1",
		api: "openai-completions",
		getApiKey: getOpenrouterApiKey,
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

const ZERO_COST = Object.freeze({
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
});

// OpenCode's /models endpoint does not expose real pricing. Use a tiny
// non-zero sentinel for known non-free models so the model picker does not
// label every OpenCode model as free. Authoritative free detection still uses
// _freeKnown/_isFree, not the sentinel amount.
const UNKNOWN_PAID_COST = Object.freeze({
	input: 0.000001,
	output: 0.000001,
	cacheRead: 0,
	cacheWrite: 0,
});

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

	return createProviderState(pi, config, {
		allModels,
		baseUrl: providerModels[0].baseUrl,
		api: providerModels[0].api,
		apiKey: getApiKeyEnvForProvider(config.id),
		source: "captured",
	});
}

async function tryDiscoverProvider(
	pi: ExtensionAPI,
	config: BuiltInToggleConfig,
): Promise<BuiltInProviderState | undefined> {
	const apiKey = config.getApiKey();
	if (!apiKey) return undefined;

	try {
		const response = await fetchWithTimeout(
			`${config.baseUrl}/models`,
			{
				headers: {
					Accept: "application/json",
					Authorization: `Bearer ${apiKey}`,
				},
			},
			30_000,
		);

		if (!response.ok) {
			throw new Error(`HTTP ${response.status} ${response.statusText}`);
		}

		const body = (await response.json()) as
			| Array<Record<string, unknown>>
			| { data?: Array<Record<string, unknown>> };
		const rawModels = Array.isArray(body) ? body : (body.data ?? []);
		const mappedModels = rawModels
			.map((m) => rawModelToProviderConfig(m, config))
			.filter((m): m is ProviderModelConfig & { _pricingKnown?: boolean } =>
				m !== undefined,
			);
		const allModels = applyAuthoritativeFreeFlags(mappedModels, config.id);

		if (allModels.length === 0) return undefined;

		return createProviderState(pi, config, {
			allModels,
			baseUrl: config.baseUrl,
			api: config.api,
			apiKey,
			source: "discovered",
		});
	} catch (err) {
		_logger.warn(`[built-in-toggle] ${config.id}: on-demand discovery failed`, {
			error: err instanceof Error ? err.message : String(err),
		});
		return undefined;
	}
}

function createProviderState(
	pi: ExtensionAPI,
	config: BuiltInToggleConfig,
	options: {
		allModels: ProviderModelConfig[];
		baseUrl: string;
		api: Api;
		apiKey: string;
		source: "captured" | "discovered";
	},
): BuiltInProviderState {
	const { allModels, baseUrl, api, apiKey, source } = options;
	const freeModels = allModels.filter((m: ProviderModelConfig) =>
		isFreeModel({ ...m, provider: config.id }, allModels),
	);

	const reRegister = (models: ProviderModelConfig[]) => {
		pi.registerProvider(config.id, {
			baseUrl,
			apiKey,
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
				// Models may have loaded after session_start — try on-demand capture.
				state = tryCaptureProvider(pi, config, ctx);
			}
			if (!state) {
				// If Pi has not exposed built-in models yet, fetch the provider's
				// /models endpoint directly so /toggle-opencode works before the
				// first chat session has populated the model registry.
				state = await tryDiscoverProvider(pi, config);
			}
			if (!state) {
				ctx.ui.notify(
					`${config.id}: models not loaded yet and on-demand discovery failed. Check your API key, then try again.`,
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

function rawModelToProviderConfig(
	m: Record<string, unknown>,
	config: BuiltInToggleConfig,
): (ProviderModelConfig & { _pricingKnown?: boolean }) | undefined {
	const id = String(m.id ?? "").trim();
	if (!id) return undefined;
	const inputModalities = Array.isArray(m.input_modalities)
		? m.input_modalities
		: undefined;
	const supportsImage = inputModalities?.includes("image") === true;
	return {
		id,
		name: String(m.name ?? m.model ?? id),
		api: isOpenCodeProvider(config.id) ? OPENCODE_DYNAMIC_API : config.api,
		reasoning: Boolean(m.reasoning ?? false),
		input: supportsImage ? ["text", "image"] : ["text"],
		cost: ZERO_COST,
		contextWindow:
			((m.context_length ??
				m.max_context_length ??
				m.context_window) as number) ?? 128_000,
		maxTokens: ((m.max_tokens ?? m.max_completion_tokens) as number) ?? 16_384,
		_pricingKnown: false,
	};
}

function applyAuthoritativeFreeFlags(
	models: Array<ProviderModelConfig & { _pricingKnown?: boolean }>,
	providerId: string,
): Array<
	ProviderModelConfig & {
		_pricingKnown?: boolean;
		_freeKnown?: boolean;
		_isFree?: boolean;
	}
> {
	return models.map((model) => {
		const isFree = isFreeModel({ ...model, provider: providerId }, models);
		return {
			...model,
			cost: isFree ? ZERO_COST : UNKNOWN_PAID_COST,
			_freeKnown: true,
			_isFree: isFree,
		};
	});
}

function getApiKeyEnvForProvider(providerId: string): string {
	const envMap: Record<string, string> = {
		opencode: "$OPENCODE_API_KEY",
		"opencode-go": "$OPENCODE_API_KEY",
		openrouter: "$OPENROUTER_API_KEY",
	};
	return envMap[providerId] || `$${providerId.toUpperCase()}_API_KEY`;
}
