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

import type {
	Api,
	Model,
	RefreshModelsContext,
} from "@earendil-works/pi-ai/compat";
import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import {
	getOpencodeApiKey,
	getOpencodeFreeShowPaid,
	getOpencodeGoShowPaid,
	getOpenrouterShowPaid,
} from "../config.ts";
import { createLogger } from "./logger.ts";
import {
	getProviderRegistry,
	isFreeModel,
	registerWithGlobalToggle,
} from "./registry.ts";
import {
	trackDetachedSessionStart,
	wrapSessionStartHandler,
} from "./session-start-metrics.ts";
import { createToggleState } from "./toggle-state.ts";
import {
	OPENCODE_DYNAMIC_API,
	applyOpenCodeProtocolDefaults,
	createOpenCodeHeaders,
	createOpenCodeSessionTracker,
	createOpenCodeStreamSimple,
	fetchOpenCodeModelIds,
	getOpenCodeModelBaseUrl,
	ensureOpenCodeApiProviderRegistered,
	isOpenCodeProvider,
	resolveOpenCodeModelApi,
} from "../providers/opencode-session.ts";
import { fetchOpenRouterCompatibleModels } from "../providers/model-fetcher.ts";

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
	/**
	 * Provider id whose stored models are captured (defaults to {@link id}).
	 * `opencode-free` captures Pi's built-in `opencode` catalog (Pi registers
	 * a provider with that id, which also owns the stored models) and
	 * re-registers them under the distinct id so OUR stream wrapper is used.
	 */
	captureFrom?: string;
	getShowPaid: () => boolean;
	/**
	 * Config key the toggle persists under; defaults to `{id}_show_paid`.
	 * The OpenCode tiers register under dashed ids (`opencode-free`) but
	 * persist under snake_case keys, so they must pass this explicitly.
	 */
	showPaidConfigKey?: string;
	baseUrl: string;
	api: Api;
	/** Fetch the public catalog after the initial built-in capture. */
	refreshEndpoint?: boolean;
	/**
	 * Live-catalog fetch strategy for {@link refreshEndpoint}. Receives the
	 * captured built-in models and returns the refreshed catalog merged with
	 * that metadata. Defaults to the OpenCode Zen refresh (IDs-only endpoint).
	 */
	fetchRefreshedModels?: (
		config: BuiltInToggleConfig,
		fallbackModels: ProviderModelConfig[],
		signal?: AbortSignal,
	) => Promise<ProviderModelConfig[]>;
}

const BUILT_IN_TOGGLE_PROVIDERS: BuiltInToggleConfig[] = [
	{
		// Named opencode-free (NOT "opencode"): pi registers a built-in
		// "opencode" provider that stamps requests with its own attribution
		// identity (x-opencode-client: pi + UUID session), which OpenCode's
		// backend treats as a third-party client and rate-limits. A distinct
		// id makes OUR provider (with the CLI-faithful header wrapper) the only
		// one with this id, so pi dispatches through our streamSimple and the
		// free tier gets the real opencode identity.
		id: "opencode-free",
		captureFrom: "opencode",
		getShowPaid: getOpencodeFreeShowPaid,
		showPaidConfigKey: "opencode_free_show_paid",
		baseUrl: "https://opencode.ai/zen/v1",
		api: OPENCODE_DYNAMIC_API,
		refreshEndpoint: true,
	},
	{
		id: "opencode-go",
		getShowPaid: getOpencodeGoShowPaid,
		showPaidConfigKey: "opencode_go_show_paid",
		baseUrl: "https://opencode.ai/zen/go/v1",
		api: OPENCODE_DYNAMIC_API,
	},
	{
		id: "openrouter",
		getShowPaid: getOpenrouterShowPaid,
		baseUrl: "https://openrouter.ai/api/v1",
		api: "openai-completions",
		// Pi's built-in openrouter provider is also a static generated catalog
		// (no fetchModels → refreshModels undefined → ModelRegistry.refresh()
		// skips it entirely), so refresh it from the public keyless endpoint.
		refreshEndpoint: true,
		fetchRefreshedModels: fetchRefreshedOpenRouterModels,
	},
];

// =============================================================================
// State
// =============================================================================

interface CurrentModelRegistry {
	// Kept structural because Pi exposes overloaded registerProvider signatures.
	registerProvider: unknown;
	getAll?: () => Model<Api>[];
	getAvailable: () => Model<Api>[];
	getApiKeyForProvider?: (providerId: string) => Promise<string | undefined>;
}

interface BuiltInProviderState {
	stored: { free: ProviderModelConfig[]; all: ProviderModelConfig[] };
	reRegister: (models: ProviderModelConfig[]) => void;
	setModelRegistry: (registry: CurrentModelRegistry) => void;
	updateModels: (allModels: ProviderModelConfig[]) => void;
	toggleState: ReturnType<typeof createToggleState<ProviderModelConfig>>;
}

const providerStates = new Map<string, BuiltInProviderState>();

/**
 * Session pieces needed to re-select the session's saved model once the
 * captured catalog is registered. See maybeRestoreSavedModel().
 */
interface SavedModelSnapshot {
	modelRegistry: CurrentModelRegistry;
	sessionManager?: {
		buildSessionContext?: () => {
			model: { provider: string; modelId: string } | null;
		};
		getEntries?: () => unknown[];
	};
	model?: { provider: string; id: string };
}

interface PendingCapture {
	/** The detached capture task. */
	task: Promise<void>;
	/**
	 * Latest session snapshot seen by ANY session_start event for this
	 * provider. Duplicate events update this cell so the in-flight capture
	 * registers into the CURRENT session's registry, not the one that
	 * happened to start the capture.
	 */
	snapshot: SavedModelSnapshot;
}

/**
 * In-flight first captures keyed by provider id. Pi can fire session_start
 * more than once per resume; without this guard the duplicate events would
 * race two captures (and two re-registrations) for the same provider.
 */
const pendingCaptures = new Map<string, PendingCapture>();
/** One detached endpoint refresh per provider; duplicate session events reuse it. */
const pendingEndpointRefreshes = new Map<string, Promise<void>>();
let commandsRegisteredFor: ExtensionAPI | undefined;
let sessionStartRegisteredFor: ExtensionAPI | undefined;

// =============================================================================
// Setup
// =============================================================================

export function setupBuiltInProviderToggles(pi: ExtensionAPI): void {
	const activeConfigs = BUILT_IN_TOGGLE_PROVIDERS.filter(
		(config) =>
			!getProviderRegistry().has(config.id) || providerStates.has(config.id),
	);

	if (activeConfigs.length === 0) {
		_logger.info(
			"[built-in-toggle] OpenCode/OpenRouter already registered; skipping capture",
		);
		return;
	}

	// Register commands once per ExtensionAPI instance. A reload creates a new
	// runner even though this module's state can survive, so the new runner must
	// receive the commands again.
	if (commandsRegisteredFor !== pi) {
		for (const config of activeConfigs) {
			registerToggleCommand(pi, config);
		}
		commandsRegisteredFor = pi;
	}

	// Capture built-in models on session start and apply initial filter. Avoid
	// duplicate handlers when the entry point is invoked twice for one runner.
	if (sessionStartRegisteredFor === pi) return;
	// A reload creates a new runner; pending captures belong to the previous
	// runner's session and must not block or shadow the new runner's captures.
	if (sessionStartRegisteredFor !== undefined) pendingCaptures.clear();
	sessionStartRegisteredFor = pi;
	pi.on(
		"session_start",
		wrapSessionStartHandler("built-in-toggle", async (_event, ctx) => {
			for (const config of activeConfigs) {
				const existing = providerStates.get(config.id);
				if (existing) {
					// ModelRegistry is session-scoped. Replace the registry and reapply
					// the selected view to the new session's provider catalog.
					existing.setModelRegistry(ctx.modelRegistry);
					existing.toggleState.applyCurrent(existing.reRegister);
					// Detach the restore like the first capture below: setModel appends
					// a model_change entry and must not delay the session_start tick.
					// maybeRestoreSavedModel contains its own errors; tracking keeps
					// the restore visible to /free-startup.
					trackDetachedSessionStart(
						`built-in-toggle-restore-${config.id}`,
						maybeRestoreSavedModel(pi, config, snapshotFromCtx(ctx)),
					);
					scheduleEndpointRefresh(config, existing);
					continue;
				}

				// Detach the first capture: resolving OAuth/API credentials and
				// waiting on Pi's catalog can take seconds and used to block
				// session start. Until it completes the provider shows Pi's
				// unfiltered built-in catalog; /toggle-{provider} retries capture
				// on demand, and duplicate session_start events reuse the
				// in-flight task instead of racing a second capture.
				const pending = pendingCaptures.get(config.id);
				if (pending) {
					// Hand the fresh session snapshot to the in-flight capture so it
					// registers into the CURRENT session, not the one that started it.
					pending.snapshot = snapshotFromCtx(ctx);
					continue;
				}
				const entry: PendingCapture = {
					task: Promise.resolve(),
					snapshot: snapshotFromCtx(ctx),
				};
				entry.task = (async () => {
					try {
						const state = await tryCaptureProvider(pi, config, ctx);
						if (!state) return;

						// Register into the latest registry seen by any session_start
						// event while this capture was in flight.
						state.setModelRegistry(entry.snapshot.modelRegistry);
						const applied = state.toggleState.applyCurrent(state.reRegister);
						_logger.info(
							`[built-in-toggle] ${config.id}: applied ${applied.mode} mode with ${applied.models.length} models`,
						);
						// Schedule the endpoint refresh BEFORE the restore: the initial
						// captured catalog can be a partial upstream list, and the
						// restore's not-found retry waits for this refresh to land.
						scheduleEndpointRefresh(config, state);
						await maybeRestoreSavedModel(pi, config, entry.snapshot);
					} finally {
						pendingCaptures.delete(config.id);
					}
				})();
				pendingCaptures.set(config.id, entry);
				trackDetachedSessionStart(
					`built-in-toggle-capture-${config.id}`,
					entry.task,
					// session-start-metrics already logs the detached failure; no
					// second warning here.
					() => {},
				);
			}
		}),
	);
}

// =============================================================================
// Model capture (called on session start or by toggle when state is missing)
// =============================================================================

function snapshotFromCtx(ctx: {
	modelRegistry: CurrentModelRegistry;
	sessionManager?: unknown;
	model?: SavedModelSnapshot["model"];
}): SavedModelSnapshot {
	return {
		modelRegistry: ctx.modelRegistry,
		sessionManager: ctx.sessionManager as SavedModelSnapshot["sessionManager"],
		model: ctx.model,
	};
}

/**
 * Wall-clock ms at module load. Session entries stamped at or after this
 * moment were written during the current run — the marker that separates
 * Pi's startup restore-fallback from a deliberate model switch made in a
 * previous run.
 */
const RUN_STARTED_AT = Date.now();
/** Clock-skew allowance for timestamp comparisons against RUN_STARTED_AT. */
const CLOCK_SKEW_MS = 5_000;

interface ModelChangeEntry {
	provider: string;
	modelId: string;
	timestamp?: string;
}

function readModelChanges(
	session: SavedModelSnapshot["sessionManager"],
): ModelChangeEntry[] | undefined {
	const entries = session?.getEntries?.();
	if (!Array.isArray(entries)) return undefined;
	const changes: ModelChangeEntry[] = [];
	for (const entry of entries) {
		const candidate = entry as {
			type?: unknown;
			provider?: unknown;
			modelId?: unknown;
			timestamp?: unknown;
		};
		if (
			candidate?.type === "model_change" &&
			typeof candidate.provider === "string" &&
			typeof candidate.modelId === "string"
		) {
			changes.push({
				provider: candidate.provider,
				modelId: candidate.modelId,
				timestamp:
					typeof candidate.timestamp === "string" ? candidate.timestamp : undefined,
			});
		}
	}
	return changes;
}

/**
 * Resolve the model choice to restore for a built-in-toggle provider.
 *
 * Pi's startup fallback ("Could not restore model … Using …") APPENDS a
 * `model_change` entry for the fallback model, so by the time the captured
 * catalog registers, `buildSessionContext().model` reports the fallback —
 * not the session's persisted choice — and a naive read would silently skip
 * the restore. The raw entry trail disambiguates: a trailing model_change
 * naming ANOTHER provider only counts as the user's deliberate choice if it
 * predates this run. A trailing change stamped during this run can only be
 * Pi's own fallback (the TUI is not interactive yet), so the last pre-run
 * change for this provider is the choice to restore.
 */
function resolveSavedModelChoice(
	providerId: string,
	session: SavedModelSnapshot["sessionManager"],
	contextModel: { provider: string; modelId: string } | null | undefined,
): { provider: string; modelId: string } | undefined {
	if (contextModel?.provider === providerId) return contextModel;
	const changes = readModelChanges(session);
	if (!changes || changes.length === 0) return undefined;
	const last = changes.at(-1);
	if (!last) return undefined;
	if (last.provider === providerId) return last;
	// Trailing change names another provider. If it was not written during
	// this run, it is a deliberate choice from a previous run — honor it.
	const lastAt = last.timestamp ? Date.parse(last.timestamp) : Number.NaN;
	if (Number.isNaN(lastAt) || lastAt < RUN_STARTED_AT - CLOCK_SKEW_MS) {
		return undefined;
	}
	for (let i = changes.length - 2; i >= 0; i--) {
		if (changes[i].provider === providerId) return changes[i];
	}
	return undefined;
}

/**
 * Deferred saved-model restore. Pi resolves a resumed session's model BEFORE
 * extension provider registrations take effect (createAgentSession restores
 * from the session file; queued registerProvider calls only flush when the
 * runner binds afterwards), so a session saved with a built-in-toggle provider
 * (e.g. opencode-free/…) always falls back with a "Could not restore model"
 * warning even though the capture registers that exact model moments later.
 * Once the catalog view is applied, switch back to the saved model — but only
 * while it is still the session's persisted choice: setModel appends a
 * model_change entry, so a fresh buildSessionContext() read also tells us if
 * the user deliberately picked another model in the meantime.
 */
async function maybeRestoreSavedModel(
	pi: ExtensionAPI,
	config: BuiltInToggleConfig,
	snapshot: SavedModelSnapshot,
): Promise<void> {
	try {
		const contextModel =
			snapshot.sessionManager?.buildSessionContext?.().model ?? null;
		const saved = resolveSavedModelChoice(
			config.id,
			snapshot.sessionManager,
			contextModel,
		);
		if (!saved || saved.provider !== config.id) {
			// Debug, not warn: a fresh session (or a deliberate previous-run
			// switch) lands here on every resume.
			_logger.debug(`[built-in-toggle] ${config.id}: no saved model to restore`, {
				contextProvider: contextModel?.provider,
				contextModelId: contextModel?.modelId,
			});
			return;
		}
		if (
			snapshot.model?.provider === saved.provider &&
			snapshot.model.id === saved.modelId
		) {
			return;
		}
		const catalog =
			snapshot.modelRegistry.getAll?.() ?? snapshot.modelRegistry.getAvailable();
		let model = catalog.find(
			(m: Model<Api>) => m.provider === config.id && m.id === saved.modelId,
		);
		if (!model) {
			// The initial capture can serve a partial upstream list while the
			// detached endpoint refresh is still fetching the complete one
			// (observed: saved model absent from a 61-model capture, present in
			// the 64-model refresh two seconds later). Wait for that refresh
			// once and retry the lookup before giving up.
			const refresh = pendingEndpointRefreshes.get(config.id);
			if (refresh) {
				try {
					await refresh;
				} catch {
					// Refresh failures are logged by the refresh task itself.
				}
				const refreshedCatalog =
					snapshot.modelRegistry.getAll?.() ??
					snapshot.modelRegistry.getAvailable();
				model = refreshedCatalog.find(
					(m: Model<Api>) =>
						m.provider === config.id && m.id === saved.modelId,
				);
			}
		}
		if (!model) {
			// Warn: the persisted choice exists in the session but the captured
			// catalog no longer contains it (upstream rotation, capture failure,
			// or a filtered-out view). This explains a lingering "Could not
			// restore model" warning that the deferred restore could not fix.
			_logger.warn(
				`[built-in-toggle] ${config.id}: saved model ${saved.modelId} not in the registered catalog; keeping Pi's fallback`,
			);
			return;
		}
		const restored = await pi.setModel(model);
		if (restored) {
			_logger.info(
				`[built-in-toggle] ${config.id}: restored saved model ${saved.modelId} after late registration`,
			);
		} else {
			_logger.warn(
				`[built-in-toggle] ${config.id}: saved model ${saved.modelId} registered but setModel was rejected (auth?)`,
			);
		}
	} catch (error) {
		_logger.warn(
			`[built-in-toggle] ${config.id}: saved-model restore failed: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

async function tryCaptureProvider(
	pi: ExtensionAPI,
	config: BuiltInToggleConfig,
	ctx: { modelRegistry: CurrentModelRegistry },
): Promise<BuiltInProviderState | undefined> {
	// Capture the complete catalog, not only getAvailable(). getAvailable() is
	// auth-filtered and therefore hides Pi's built-in OpenCode models before a
	// credential is configured, which made /toggle-opencode report "not loaded".
	const catalog =
		ctx.modelRegistry.getAll?.() ?? ctx.modelRegistry.getAvailable();
	const providerModels = catalog.filter(
		(m: Model<Api>) => m.provider === (config.captureFrom ?? config.id),
	);
	if (providerModels.length === 0) return undefined;

	const allModels = providerModels.map((m: Model<Api>) =>
		modelToProviderConfig(m),
	);

	return createProviderState(pi, config, {
		allModels,
		baseUrl: providerModels[0].baseUrl,
		api: providerModels[0].api,
		apiKey: await resolveApiKey(config.id, ctx.modelRegistry),
		source: "captured",
		modelRegistry: ctx.modelRegistry,
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
		modelRegistry: CurrentModelRegistry;
	},
): BuiltInProviderState {
	const { allModels, baseUrl, api, apiKey, source } = options;
	let currentModelRegistry = options.modelRegistry;
	let stateForRefresh: BuiltInProviderState | undefined;
	const freeModels = allModels.filter((m: ProviderModelConfig) =>
		isFreeModel({ ...m, provider: config.id }, allModels),
	);

	const refreshModels = config.refreshEndpoint
		? async (context: RefreshModelsContext): Promise<ProviderModelConfig[]> => {
				if (!context.allowNetwork) {
					return stateForRefresh?.toggleState.getCurrentModels() ?? allModels;
				}
				const fetcher = config.fetchRefreshedModels ?? fetchRefreshedOpenCodeModels;
				const refreshed = await fetcher(
					config,
					stateForRefresh?.stored.all ?? allModels,
					context.signal,
				);
				if (context.signal.aborted || !stateForRefresh) {
					return stateForRefresh?.toggleState.getCurrentModels() ?? refreshed;
				}
				stateForRefresh.updateModels(refreshed);
				return stateForRefresh.toggleState.getCurrentModels();
			}
		: undefined;

	const reRegister = (models: ProviderModelConfig[]) => {
		// Ensure the opencode-dynamic API is registered in compat's global
		// registry so fallback code paths (compat streamSimple) can resolve it.
		if (isOpenCodeProvider(config.id)) {
			ensureOpenCodeApiProviderRegistered(getOpenCodeSession());
		}
		const providerConfig = {
			baseUrl,
			...(apiKey === undefined ? {} : { apiKey }),
			api: isOpenCodeProvider(config.id) ? OPENCODE_DYNAMIC_API : api,
			...(isOpenCodeProvider(config.id)
				? { streamSimple: createOpenCodeStreamSimple(getOpenCodeSession()) }
				: {}),
			models,
		};
		if (refreshModels) {
			Object.assign(providerConfig, { refreshModels });
		}

		// Event/command contexts expose the current session registry. Using it
		// avoids calling the stale ExtensionAPI captured before a session switch.
		// Keep the pi fallback for the initial load and older test/runtime shims.
		if (typeof currentModelRegistry?.registerProvider === "function") {
			(
				currentModelRegistry.registerProvider as (
					providerId: string,
					config: unknown,
				) => void
			).call(currentModelRegistry, config.id, providerConfig);
		} else {
			pi.registerProvider(config.id, providerConfig);
		}
	};

	const stored = { free: freeModels, all: allModels };
	const toggleState = createToggleState<ProviderModelConfig>({
		providerId: config.id,
		initialShowPaid: config.getShowPaid(),
		// undefined falls through to the `{id}_show_paid` default (openrouter).
		configKey: config.showPaidConfigKey,
		initialModels: stored,
	});

	const updateModels = (nextAllModels: ProviderModelConfig[]): void => {
		const nextStored = {
			free: nextAllModels.filter((m: ProviderModelConfig) =>
				isFreeModel({ ...m, provider: config.id }, nextAllModels),
			),
			all: nextAllModels,
		};
		toggleState.setModels(nextStored);
		// Keep the object handed to registerWithGlobalToggle stable. The global
		// filter retains that reference for the lifetime of the runner.
		const current = toggleState.getStored();
		stored.free = current.free;
		stored.all = current.all;
	};

	const state: BuiltInProviderState = {
		stored,
		reRegister,
		setModelRegistry: (registry) => {
			currentModelRegistry = registry;
		},
		updateModels,
		toggleState,
	};
	providerStates.set(config.id, state);
	stateForRefresh = state;

	registerWithGlobalToggle(config.id, stored, reRegister, true);

	_logger.info(
		`[built-in-toggle] ${config.id}: ${source} ${allModels.length} models (${freeModels.length} free)`,
	);

	return state;
}

function createDiscoveredOpenCodeModel(
	id: string,
	config: BuiltInToggleConfig,
): ProviderModelConfig {
	const api = resolveOpenCodeModelApi(id, config.id);
	const free = id.toLowerCase().includes("free");
	return {
		id,
		name: id,
		api,
		baseUrl: getOpenCodeModelBaseUrl(api, config.baseUrl),
		reasoning: true,
		input: ["text"],
		cost: {
			input: free ? 0 : 1,
			output: free ? 0 : 1,
			cacheRead: 0,
			cacheWrite: 0,
		},
		contextWindow: 200_000,
		maxTokens: 32_000,
		headers: createOpenCodeHeaders(getOpenCodeSession()) as Record<
			string,
			string
		>,
	};
}

async function fetchRefreshedOpenCodeModels(
	config: BuiltInToggleConfig,
	fallbackModels: ProviderModelConfig[],
	signal?: AbortSignal,
): Promise<ProviderModelConfig[]> {
	const ids = await fetchOpenCodeModelIds(config.baseUrl, signal);
	const knownById = new Map(fallbackModels.map((model) => [model.id, model]));
	return applyOpenCodeProtocolDefaults(
		ids.map(
			(id) => knownById.get(id) ?? createDiscoveredOpenCodeModel(id, config),
		),
		config.id,
		config.baseUrl,
	);
}

/**
 * Refresh the built-in openrouter catalog from the public keyless
 * /api/v1/models endpoint, which — unlike the Zen endpoint — returns full
 * metadata (pricing, context window, modalities). Known IDs keep Pi's curated
 * built-in metadata; models new to the built-in snapshot are synthesized from
 * the live response with OpenRouter wire defaults matching the generated JSON.
 */
async function fetchRefreshedOpenRouterModels(
	config: BuiltInToggleConfig,
	fallbackModels: ProviderModelConfig[],
	signal?: AbortSignal,
): Promise<ProviderModelConfig[]> {
	const fetched = await fetchOpenRouterCompatibleModels({
		providerId: config.id,
		baseUrl: config.baseUrl,
		signal,
	});
	const knownById = new Map(fallbackModels.map((model) => [model.id, model]));
	return fetched.map((model) => {
		const known = knownById.get(model.id);
		if (known) return known;
		return {
			...model,
			api: config.api,
			baseUrl: config.baseUrl,
			// Match the compat shape pi-ai's generated openrouter catalog uses.
			compat: { supportsDeveloperRole: false, thinkingFormat: "openrouter" },
		};
	});
}

/**
 * Refresh only after the initial capture has registered. Pi's built-in
 * OpenCode provider is a static catalog, so ModelRegistry.refresh() cannot
 * discover the public Zen endpoint for our renamed `opencode-free` provider.
 * Keeping this request detached preserves the fast session_start path.
 */
function scheduleEndpointRefresh(
	config: BuiltInToggleConfig,
	state: BuiltInProviderState,
): void {
	if (!config.refreshEndpoint || pendingEndpointRefreshes.has(config.id)) return;

	let task: Promise<void> | undefined;
	task = (async () => {
		try {
			const fetcher = config.fetchRefreshedModels ?? fetchRefreshedOpenCodeModels;
			const refreshed = await fetcher(config, state.stored.all);
			state.updateModels(refreshed);
			const applied = state.toggleState.applyCurrent(state.reRegister);
			_logger.info(
				`[built-in-toggle] ${config.id}: endpoint refresh ${applied.models.length}/${refreshed.length} ${applied.mode} models`,
			);
		} catch (error) {
			_logger.warn(`[built-in-toggle] ${config.id}: endpoint refresh failed`, {
				error: error instanceof Error ? error.message : String(error),
			});
			throw error;
		} finally {
			if (pendingEndpointRefreshes.get(config.id) === task) {
				pendingEndpointRefreshes.delete(config.id);
			}
		}
	})();

	pendingEndpointRefreshes.set(config.id, task);
	trackDetachedSessionStart(
		`built-in-toggle-refresh-${config.id}`,
		task,
		// The task already logs a credential-free, status-only failure.
		() => {},
	);
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
			// A detached session-start capture may still be in flight; wait for
			// it instead of racing a second capture (which would overwrite
			// provider state and could clobber the view the user is toggling).
			await pendingCaptures.get(config.id)?.task;
			let state = providerStates.get(config.id);
			if (!state) {
				// Models may have loaded after session_start — try capture again.
				state = await tryCaptureProvider(pi, config, ctx);
			} else if (ctx.modelRegistry) {
				// Commands run with the current session context; refresh the
				// registry even when the catalog was captured in an older session.
				state.setModelRegistry(ctx.modelRegistry);
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
	// OpenCode's backend treats a foreign client identity (e.g. pi's own
	// `x-opencode-client: pi` attribution stamp) as a third-party caller and
	// drops free-tier models to the fallback rate limit. Stamp the CLI
	// identity on the MODEL (pi-ai merges only model.headers into requests, and
	// pi's attribution merge lets model headers override its own stamp).
	const openCodeHeaders = isOpenCodeProvider(m.provider)
		? (createOpenCodeHeaders(getOpenCodeSession(), m.headers) as Record<
				string,
				string
			>)
		: undefined;
	const base: ProviderModelConfig = {
		id: m.id,
		name: m.name,
		api: m.api,
		// Pi's persisted OpenCode catalog may still contain the pre-/v1
		// Anthropic base URL. Preserve per-model routing when re-registering;
		// otherwise the first model's URL is shared by every model.
		baseUrl: isOpenCodeProvider(m.provider)
			? getOpenCodeModelBaseUrl(m.api, m.baseUrl)
			: m.baseUrl,
		reasoning: m.reasoning,
		input: m.input,
		cost: m.cost,
		contextWindow: m.contextWindow,
		maxTokens: m.maxTokens,
		headers: openCodeHeaders ?? m.headers,
		compat: (m as any).compat,
	};

	// The provider-level OpenCode wrapper still regenerates headers, while the
	// model-level API is preserved so Anthropic/Responses/Google routes remain
	// protocol-correct.
	return base;
}

async function resolveApiKey(
	providerId: string,
	modelRegistry: CurrentModelRegistry,
): Promise<string | undefined> {
	// OpenCode and OpenCode Go share the same Zen API key, but Pi persists
	// credentials by provider id. Reuse a stored Go key for the free OpenCode
	// catalog so free OpenCode models remain available after login.
	if (providerId === "opencode-free" || providerId === "opencode") {
		const sharedKey = await modelRegistry.getApiKeyForProvider?.("opencode-go");
		if (sharedKey) return sharedKey;
		const ownKey = await modelRegistry.getApiKeyForProvider?.(providerId);
		if (ownKey) return ownKey;
		const configKey = await getOpencodeApiKey();
		if (configKey) return configKey;
	}

	return getApiKeyEnvForProvider(providerId);
}

function getApiKeyEnvForProvider(providerId: string): string | undefined {
	// OpenRouter is Pi's built-in provider. Do not supply an apiKey here:
	// re-registerProvider merges only defined fields, so omitting it preserves
	// Pi-managed OAuth credentials from /login openrouter (and refresh support).
	const envMap: Record<string, string> = {
		opencode: "$OPENCODE_API_KEY",
		"opencode-free": "$OPENCODE_API_KEY",
		"opencode-go": "$OPENCODE_API_KEY",
	};
	return envMap[providerId];
}
