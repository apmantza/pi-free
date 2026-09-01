import type {
	Api,
	ApiKeyAuth,
	ApiKeyCredential,
	AuthContext,
	AuthInteraction,
	AuthResult,
	Credential,
	Model,
	Provider,
	ProviderAuth,
	ProviderStreams,
	RefreshModelsContext,
} from "@earendil-works/pi-ai/compat";
import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import { applyHidden, saveConfig } from "../config.ts";
import { createLogger } from "./logger.ts";
import {
	getGlobalFreeOnly,
	getGlobalFreeOnlyForced,
	isFreeModel,
	registerWithGlobalToggle,
} from "./registry.ts";
import {
	trackDetachedSessionStart,
	wrapSessionStartHandler,
} from "./session-start-metrics.ts";
import type { ProviderProbe } from "./provider-probe.ts";
import { lazyOpenAICompletionsApi } from "./lazy-compat.ts";
import { enhanceWithCI, type StoredModels } from "../provider-helper.ts";
import {
	recordNativeAbort,
	recordNativeEmptyRetain,
	recordNativeRefreshOk,
	recordNativeRestored,
} from "./startup-timing.ts";

const _logger = createLogger("native-provider");

/**
 * Store entries older than this are flagged stale on restore (Mn2, #437).
 * A 7-day threshold catches long-idle sessions without nagging on normal
 * 4h-throttled refreshes.
 */
const STALE_STORE_WARN_MS = 7 * 24 * 60 * 60 * 1000;

/** Providers that already emitted their one-time stale-store warn (Mn2). */
const _staleWarnedProviders = new Set<string>();

/** Compatibility bridge for the native single-argument registrar. */
type NativeRegistrar = {
	registerProvider(provider: Provider): void;
};

export interface NativeApiKeyAuthOptions {
	name: string;
	prompt: string;
	source: string;
	getApiKey: () => string | undefined;
	/**
	 * Opt in to anonymous catalog resolution: when no stored credential or
	 * ambient key exists, `resolve()` returns a truthy keyless result so Pi's
	 * `MutableModels.refresh()` still runs `refreshModels()` and the provider's
	 * public catalog can populate. Chat requests still require a real key —
	 * the gateway rejects unauthenticated completions.
	 */
	anonymousCatalog?: boolean;
}

/** Build the standard persisted API-key auth used by keyed native providers. */
export function createNativeApiKeyAuth(
	options: NativeApiKeyAuthOptions,
): ProviderAuth {
	const apiKey: ApiKeyAuth = {
		name: options.name,
		async login(interaction: AuthInteraction): Promise<ApiKeyCredential> {
			const key = await interaction.prompt({
				type: "secret",
				message: options.prompt,
			});
			return { type: "api_key", key };
		},
		async resolve(input: {
			ctx: AuthContext;
			credential?: ApiKeyCredential;
		}): Promise<AuthResult | undefined> {
			const key = input.credential?.key ?? options.getApiKey();
			if (!key) {
				if (options.anonymousCatalog) {
					return { auth: {}, source: "public catalog (no account)" };
				}
				return undefined;
			}
			return {
				auth: { apiKey: key },
				source: input.credential?.key ? "stored API key" : options.source,
			};
		},
	};
	return { apiKey };
}

export interface NativeOpenAIProviderOptions {
	providerId: string;
	name: string;
	baseUrl: string;
	auth: ProviderAuth;
	getApiKey: () => string | undefined;
	getShowPaid: () => boolean;
	initialModels?: ProviderModelConfig[];
	fetchModels: (
		apiKey: string,
		signal?: AbortSignal,
	) => Promise<ProviderModelConfig[]>;
	/** Allow refresh to fetch a public catalog with an empty credential. */
	allowUnauthenticated?: boolean;
	tosUrl?: string;
	suppressTosWhenKey?: boolean;
	/**
	 * Optional stream override. Defaults to the shared lazy pi-ai bridge;
	 * providers with scoped streaming needs (e.g. a retry wrapper) pass their
	 * own thin wrapper built on that bridge. The compat entry point is still
	 * only ever loaded lazily through `lib/lazy-compat.ts`.
	 */
	streams?: ProviderStreams;
	/**
	 * Optional per-model wire-protocol override. Defaults to
	 * "openai-completions" for every model. Gateways serving some models over
	 * a different transport (e.g. CommandCode's claude-* models speak
	 * Anthropic Messages) return the right Api here; pair with a `streams`
	 * override whose implementations dispatch on `model.api` so the wire
	 * transport matches what each model was published with.
	 */
	apiForModel?: (modelId: string) => Api;
}

export interface NativeOpenAIProviderHandle {
	provider: Provider<"openai-completions">;
	stored: StoredModels;
	setShowPaid: (showPaid: boolean) => void;
	getShowPaid: () => boolean;
	ingest: (all: ProviderModelConfig[], free: ProviderModelConfig[]) => void;
}

function nativeCredentialToken(
	credential: Credential | undefined,
	getApiKey: () => string | undefined,
): string | undefined {
	if (credential?.type === "api_key") return credential.key ?? getApiKey();
	return getApiKey();
}

/**
 * Stamp gateway-safe compat on a native model.
 *
 * pi-ai defaults unknown providers to OpenAI's `developer` system-role
 * convention for reasoning models, but the aggregating gateways pi-free
 * registers forward it verbatim to upstreams that reject it — TokenRouter
 * answers with a wrapped `422 openai_error / bad_response_status_code` and
 * ZenMux with `400: developer is not one of ['system'...]` (both reproduced
 * live against Qwen-family models). `system` is universally accepted, so
 * every OpenAI-compatible model pi-free publishes opts out of the developer
 * role. Existing compat overrides are preserved.
 */
export function withGatewayCompat<
	T extends { compat?: ProviderModelConfig["compat"] },
>(model: T): T {
	return {
		...model,
		compat: { ...model.compat, supportsDeveloperRole: false },
	};
}

function toNativeOpenAIModel(
	model: ProviderModelConfig,
	providerId: string,
	baseUrl: string,
	apiForModel?: (modelId: string) => Api,
): Model<Api> {
	// SAFETY: the historical Model<"openai-completions"> nominal claim widens
	// to Model<Api>: when apiForModel overrides the transport (e.g.
	// anthropic-messages for CommandCode's claude-* models) the runtime object
	// carries the right Api and the provider's streams override must dispatch
	// on model.api. Call sites filing results into openai-completions-typed
	// stores cast deliberately - pi-ai reads the runtime api field, never the
	// compile-time type parameter.
	const api = apiForModel?.(model.id) ?? "openai-completions";
	// SAFETY: widening cast — pi-ai reads the runtime api field set above,
	// never this function's compile-time return parameter.
	return withGatewayCompat({
		...model,
		api,
		provider: providerId,
		baseUrl,
	} as unknown as Model<Api>);
}

/** Apply the shared global/provider free-model policy to a complete native catalog. */
export function filterNativeModels<T extends Model<Api>>(
	providerId: string,
	models: readonly T[],
	options: {
		showPaid: boolean;
		freeModels: readonly ProviderModelConfig[];
		forceFree?: boolean;
	},
): readonly T[] {
	const forceFree =
		options.forceFree === true ||
		(typeof getGlobalFreeOnlyForced === "function" && getGlobalFreeOnlyForced());
	const freeOnly = getGlobalFreeOnly() && (forceFree || !options.showPaid);
	const freeIds = new Set(options.freeModels.map((model) => model.id));
	const visible = freeOnly
		? models.filter((model) => freeIds.has(model.id))
		: models;
	// SAFETY: T extends Model<Api> (declared on the function), and every Model
	// carries the same fields as ProviderModelConfig plus provider/api/baseUrl.
	// applyHidden is a plain passthrough filter on shared fields, so the cast
	// is read-only and cannot widen/corrupt the object shape.
	return applyHidden(
		visible as unknown as ProviderModelConfig[],
		providerId,
	) as T[];
}

/** Build a keyed OpenAI-compatible native provider with shared catalog lifecycle. */
export function createNativeOpenAIProvider(
	options: NativeOpenAIProviderOptions,
): NativeOpenAIProviderHandle {
	const streams = options.streams ?? lazyOpenAICompletionsApi();
	const stored: StoredModels = { free: [], all: [] };
	// In-session override only; starts undefined so the persisted config
	// getter (options.getShowPaid) is authoritative on startup. `setShowPaid`
	// records the live value while the toggle is running, but it must never
	// seed the boot state or a persisted toggle would be lost on restart.
	let showPaidOverride: boolean | undefined;

	function classifyFree(
		models: Model<"openai-completions">[],
	): Model<"openai-completions">[] {
		return models.filter((model) =>
			isFreeModel({ ...model, provider: options.providerId }, models),
		);
	}

	function getShowPaid(): boolean {
		return showPaidOverride ?? options.getShowPaid();
	}

	function setShowPaid(next: boolean): void {
		showPaidOverride = next;
	}

	function ingest(
		all: ProviderModelConfig[],
		free: ProviderModelConfig[],
	): void {
		stored.all = enhanceWithCI(all, options.providerId).map((model) =>
			toNativeOpenAIModel(
				model,
				options.providerId,
				options.baseUrl,
				options.apiForModel,
			),
		);
		stored.free = enhanceWithCI(free, options.providerId).map((model) =>
			toNativeOpenAIModel(
				model,
				options.providerId,
				options.baseUrl,
				options.apiForModel,
			),
		);
	}

	const initialModels = options.initialModels ?? [];
	if (initialModels.length > 0) {
		const all = enhanceWithCI(initialModels, options.providerId).map((model) =>
			toNativeOpenAIModel(
				model,
				options.providerId,
				options.baseUrl,
				options.apiForModel,
			),
		);
		stored.all = all;
		// SAFETY: classification only reads id/name/cost fields; per-model
		// transports (apiForModel) widen the nominal type parameter only.
		stored.free = classifyFree(all as Model<"openai-completions">[]);
	}

	async function refreshModels(context: RefreshModelsContext): Promise<void> {
		// SAFETY: per-model transports (apiForModel) widen elements to
		// Model<Api>; stored fields are ProviderModelConfig-shaped and pi-ai
		// dispatches on the runtime api field, so the casts below only relax a
		// nominal type parameter that no longer fits dual-transport providers.
		await refreshNativeProviderModels<Model<Api>>(
			options.providerId,
			context,
			(storedModels) => {
				stored.all = storedModels;
				stored.free = classifyFree(storedModels as Model<"openai-completions">[]);
			},
			async () => {
				const token = nativeCredentialToken(context.credential, options.getApiKey);
				if (!token && !options.allowUnauthenticated) return [];
				const all = await options.fetchModels(token ?? "", context.signal);
				return enhanceWithCI(all, options.providerId).map((model) =>
					toNativeOpenAIModel(
						model,
						options.providerId,
						options.baseUrl,
						options.apiForModel,
					),
				);
			},
			(models) => {
				stored.all = models;
				stored.free = classifyFree(models as Model<"openai-completions">[]);
			},
		);
	}

	const provider: Provider<"openai-completions"> = {
		id: options.providerId,
		name: options.name,
		baseUrl: options.baseUrl,
		headers: { "User-Agent": "pi-free-providers" },
		auth: options.auth,
		getModels: () =>
			(stored.all.length > 0
				? stored.all
				: stored.free) as Model<"openai-completions">[],
		filterModels: (models) =>
			filterNativeModels(options.providerId, models, {
				showPaid: getShowPaid(),
				freeModels: stored.free,
			}),
		refreshModels,
		stream: (model, context, streamOptions) =>
			streams.stream(model, context, streamOptions),
		streamSimple: (model, context, streamOptions) =>
			streams.streamSimple(model, context, streamOptions),
	};

	return {
		provider,
		stored,
		setShowPaid,
		getShowPaid,
		ingest,
	};
}

/** Register a shared keyed OpenAI-compatible native provider and its lifecycle. */
export function registerNativeOpenAIProvider(
	pi: ExtensionAPI,
	options: NativeOpenAIProviderOptions,
): NativeOpenAIProviderHandle {
	const handle = createNativeOpenAIProvider(options);
	registerNativeProvider(pi, handle.provider);
	const reRegister = () => {
		registerNativeProvider(pi, handle.provider);
	};
	registerWithGlobalToggle(
		options.providerId,
		handle.stored,
		reRegister,
		Boolean(options.getApiKey()),
		{ native: true, invalidate: reRegister },
	);
	registerNativeProviderToggle(pi, {
		providerId: options.providerId,
		stored: handle.stored,
		getShowPaid: handle.getShowPaid,
		setShowPaid: handle.setShowPaid,
		reRegister,
	});
	if (options.tosUrl) {
		let tosShown = false;
		pi.on("model_select", (_event, ctx) => {
			if (tosShown || ctx.model?.provider !== options.providerId) return;
			tosShown = true;
			if (options.suppressTosWhenKey && options.getApiKey()) return;
			_logger.debug("Free-model terms notice", {
				provider: options.providerId,
				termsUrl: options.tosUrl,
			});
		});
	}
	registerNativeProviderRefresh(pi, options.providerId);
	return handle;
}

/** Register a standard availability probe for a native OpenAI provider. */
export function registerNativeAvailabilityProbe(
	pi: ExtensionAPI,
	options: {
		providerId: string;
		label: string;
		apiKey: string;
		probe: ProviderProbe;
		handle: NativeOpenAIProviderHandle;
	},
): void {
	const { providerId, label, apiKey, probe, handle } = options;
	pi.registerCommand(`probe-${providerId}`, {
		description: `Test all ${label} models for availability`,
		handler: async (_args, ctx) => {
			const models = handle.stored.all;
			ctx.ui.notify(`Probing ${models.length} ${label} models…`, "info");
			const broken = await probe.run(apiKey, models, {
				onBroken: (ids) => {
					ctx.ui.notify(
						`Found ${ids.length} broken models (auto-hidden):\n${ids.join("\n")}`,
						"warning",
					);
					registerNativeProvider(pi, handle.provider);
				},
			});
			if (broken.length === 0) {
				ctx.ui.notify(`All ${label} models are accessible ✅`, "info");
			}
		},
	});
	pi.on(
		"session_start",
		wrapSessionStartHandler(
			`${providerId}-auto-probe`,
			probe.autoProbeHandler(apiKey, handle.stored.free, () =>
				registerNativeProvider(pi, handle.provider),
			),
			{ detached: true },
		),
	);
}

/** Register a native provider across the current dev snapshot and >=0.81 peers. */
export function registerNativeProvider(
	pi: ExtensionAPI,
	provider: Provider,
): void {
	// SAFETY: this bridge exists only because the declared peer minimum
	// registerProvider(provider) single-arg signature is not satisfiable with
	// the pinned dev snapshot's ExtensionAPI. Provider is the exact runtime
	// value pi-ai expects; the cast changes no data, only the nominal type.
	(pi as unknown as NativeRegistrar).registerProvider(provider);
}

interface NativeToggleOptions {
	providerId: string;
	stored: {
		free: ProviderModelConfig[];
		all: ProviderModelConfig[];
	};
	getShowPaid: () => boolean;
	setShowPaid?: (showPaid: boolean) => void;
	reRegister: () => void;
	/**
	 * Config key to persist the toggle under. Defaults to
	 * `{providerId}_show_paid`; providers whose config key diverges from their
	 * provider id (e.g. Ollama registers as `ollama-cloud` but reads
	 * `ollama_show_paid`) must pass it so the toggle survives a restart.
	 */
	configKey?: string;
}

/** Register the standard free/all toggle used by native providers. */
export function registerNativeProviderToggle(
	pi: ExtensionAPI,
	options: NativeToggleOptions,
): void {
	const {
		providerId,
		stored,
		getShowPaid,
		reRegister,
		configKey = `${providerId}_show_paid`,
	} = options;

	pi.registerCommand(`toggle-${providerId}`, {
		description: `Toggle between free and all ${providerId} models`,
		handler: async (_args, ctx) => {
			const showPaid = !getShowPaid();
			await saveConfig({ [configKey]: showPaid });
			options.setShowPaid?.(showPaid);

			reRegister();

			const freeCount = stored.free.length;
			const paidCount = stored.all.length - freeCount;
			if (showPaid && stored.all.length > 0) {
				ctx.ui.notify(
					`${providerId}: showing all ${stored.all.length} models (${freeCount} free, ${paidCount} paid)`,
					"info",
				);
			} else {
				ctx.ui.notify(
					`${providerId}: showing ${freeCount} free models (${paidCount} paid hidden)`,
					"info",
				);
			}
		},
	});
}

/**
 * Nudge Pi's native model refresh once per extension session.
 *
 * Pi 0.84 supersedes an in-flight refresh for each provider when a newer
 * refresh starts. Registering this handler once per provider while calling a
 * global refresh caused every handler to abort the previous providers' fetches
 * in a tight loop on session resume.
 */
const nativeRefreshRegistrations = new WeakSet<object>();

export function registerNativeProviderRefresh(
	pi: ExtensionAPI,
	providerId: string,
): void {
	if (nativeRefreshRegistrations.has(pi as object)) return;
	nativeRefreshRegistrations.add(pi as object);

	pi.on(
		"session_start",
		wrapSessionStartHandler(providerId, (_event, ctx) => {
			try {
				const registry = (
					ctx as {
						modelRegistry?: { refresh?: (opts?: unknown) => unknown };
					}
				).modelRegistry;
				const result = registry?.refresh?.({ allowNetwork: true });
				if (result && typeof (result as PromiseLike<unknown>).then === "function") {
					const refreshTask = Promise.resolve(result).then((value) => {
						const errors = (value as { errors?: { size?: number } } | undefined)
							?.errors;
						if (errors?.size && errors.size > 0) {
							throw new Error(
								`Pi model refresh reported ${errors.size} provider error(s)`,
							);
						}
					});
					trackDetachedSessionStart(
						`${providerId}-model-refresh`,
						refreshTask,
						(err) => logRefreshFailure(providerId, err),
					);
				}
			} catch (err) {
				logRefreshFailure(providerId, err);
			}
			return Promise.resolve();
		}),
	);
}

function logRefreshFailure(providerId: string, error: unknown): void {
	_logger.warn(`Model refresh nudge failed for ${providerId}`, {
		error: error instanceof Error ? error.message : String(error),
	});
}

/** Restore one provider's catalog from Pi's native models store. */
type NativeModelsStoreEntry = {
	models: readonly Model<Api>[];
	checkedAt: number;
};

type NativeRefreshContext = {
	allowNetwork: boolean;
	signal?: AbortSignal;
	/** Pi 0.84+ immutable store snapshot. */
	stored?: NativeModelsStoreEntry;
	/** Pi 0.84+ generation-checked publication API. */
	publish?: (publication: {
		persist?: NativeModelsStoreEntry | null;
		update?: () => void;
	}) => Promise<boolean>;
	/** Pi <=0.83 legacy provider store. */
	store?: {
		read: () => Promise<NativeModelsStoreEntry | undefined>;
		write: (entry: NativeModelsStoreEntry) => Promise<void>;
	};
};

function getNativeRefreshContext(
	context: RefreshModelsContext,
): NativeRefreshContext {
	// SAFETY: NativeRefreshContext is a superset of RefreshModelsContext (the
	// published/stored fields are optional on both), so the cast only lets
	// callers read the extra optional fields; it never fabricates data.
	return context as unknown as NativeRefreshContext;
}

function usesNativePublication(context: RefreshModelsContext): boolean {
	return typeof getNativeRefreshContext(context).publish === "function";
}

/** Restore one provider's catalog from Pi's native models store. */
export async function restoreNativeProviderModels<T extends Model<Api>>(
	providerId: string,
	context: RefreshModelsContext,
	onModels: (models: T[]) => void,
): Promise<void> {
	const nativeContext = getNativeRefreshContext(context);
	try {
		// Pi 0.84+ has already read the provider-scoped store and supplies an
		// immutable snapshot. Never read the old context.store in this path.
		const entry = usesNativePublication(context)
			? nativeContext.stored
			: await nativeContext.store?.read();
		const restored = (entry?.models ?? []).filter(
			(model) => model.provider === providerId,
		);
		// Restored entries may predate the gateway-compat stamp (written by an
		// older build); re-stamp so the offline window before the next refresh
		// still sends `system` instead of `developer`.
		const models = restored.map((model) => withGatewayCompat(model)) as T[];
		if (entry) {
			// M1: a store restore happened (even with 0 models — that is how
			// "refresh ok with 0 models" is later distinguished from "never ran").
			const storeAgeMs =
				typeof entry.checkedAt === "number"
					? Date.now() - entry.checkedAt
					: undefined;
			recordNativeRestored(providerId, storeAgeMs);
			// Mn2: warn once per provider when the restored entry is stale.
			if (
				storeAgeMs !== undefined &&
				storeAgeMs > STALE_STORE_WARN_MS &&
				!_staleWarnedProviders.has(providerId)
			) {
				_staleWarnedProviders.add(providerId);
				_logger.warn(`Stale ${providerId} models store`, {
					ageMs: Math.round(storeAgeMs),
					ageDays: Number((storeAgeMs / (24 * 60 * 60 * 1000)).toFixed(1)),
					modelCount: models.length,
				});
			}
		}
		if (models.length > 0) onModels(models);
	} catch (err) {
		_logger.warn(`Failed to read ${providerId} models store; continuing empty`, {
			error: err instanceof Error ? err.message : String(err),
		});
	}
}

/** Refresh, publish, and persist a native provider catalog. */
export async function refreshNativeProviderModels<T extends Model<Api>>(
	providerId: string,
	context: RefreshModelsContext,
	onRestore: (models: T[]) => void,
	fetchModels: () => Promise<T[]>,
	onFetched: (models: T[]) => void,
): Promise<void> {
	await restoreNativeProviderModels(providerId, context, onRestore);
	// Offline init (allowNetwork=false) is not an abort: the refresh never ran.
	if (!context.allowNetwork) return;
	if (context.signal?.aborted) {
		// M1: cancellation is expected — count it, never log as an error (#15).
		recordNativeAbort(providerId);
		return;
	}

	try {
		const models = await fetchModels();
		if (context.signal?.aborted) {
			recordNativeAbort(providerId);
			return;
		}
		if (models.length === 0) {
			// M1: a completed refresh that returned nothing retained the previous
			// list — recorded so it is distinguishable from "refresh never ran".
			recordNativeEmptyRetain(providerId);
			return;
		}
		// Only count as "ok" if persistence actually published: a superseded
		// generation (publish() returns false — update never ran) or a store
		// write failure must not inflate the success counter.
		if (
			await persistNativeProviderModels(providerId, context, models, () =>
				onFetched(models),
			)
		) {
			recordNativeRefreshOk(providerId, models.length);
		}
	} catch (err) {
		// Pi may abort a superseded refresh; cancellation is not a provider error.
		if (context.signal?.aborted) {
			recordNativeAbort(providerId);
			return;
		}
		_logger.warn(`Failed to refresh ${providerId} models; retaining previous`, {
			error: err instanceof Error ? err.message : String(err),
		});
	}
}

/**
 * Persist a native provider catalog while retaining the previous store on
 * failure. Returns true when the catalog was actually published (a superseded
 * generation, where Pi's publish() returns false and the update never ran,
 * yields false — callers must not count it as a successful refresh).
 */
export async function persistNativeProviderModels(
	providerId: string,
	context: RefreshModelsContext,
	models: readonly Model<Api>[],
	onPublished?: () => void,
): Promise<boolean> {
	const nativeContext = getNativeRefreshContext(context);
	try {
		if (usesNativePublication(context) && nativeContext.publish) {
			const published = await nativeContext.publish({
				persist: {
					models,
					checkedAt: Date.now(),
				},
				// Pi runs this only if this refresh generation is still current.
				update: onPublished,
			});
			return published !== false;
		}

		onPublished?.();
		await nativeContext.store?.write({
			models,
			checkedAt: Date.now(),
		});
		return true;
	} catch (err) {
		_logger.warn(`Failed to persist ${providerId} models to store`, {
			error: err instanceof Error ? err.message : String(err),
		});
		return false;
	}
}
