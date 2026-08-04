import {
	openAICompletionsApi,
	type Api,
	type ApiKeyAuth,
	type ApiKeyCredential,
	type AuthContext,
	type AuthInteraction,
	type AuthResult,
	type Credential,
	type Model,
	type Provider,
	type ProviderAuth,
	type RefreshModelsContext,
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
import { enhanceWithCI, type StoredModels } from "../provider-helper.ts";

const _logger = createLogger("native-provider");

/** Compatibility bridge for the native single-argument registrar. */
export type NativeRegistrar = {
	registerProvider(provider: Provider): void;
};

export interface NativeApiKeyAuthOptions {
	name: string;
	prompt: string;
	source: string;
	getApiKey: () => string | undefined;
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
			if (!key) return undefined;
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
	/** Override the persisted mode for providers whose legacy default is paid. */
	initialShowPaid?: boolean;
	initialModels?: ProviderModelConfig[];
	fetchModels: (
		apiKey: string,
		signal?: AbortSignal,
	) => Promise<ProviderModelConfig[]>;
	/** Allow refresh to fetch a public catalog with an empty credential. */
	allowUnauthenticated?: boolean;
	tosUrl?: string;
	suppressTosWhenKey?: boolean;
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

function toNativeOpenAIModel(
	model: ProviderModelConfig,
	providerId: string,
	baseUrl: string,
): Model<"openai-completions"> {
	return {
		...model,
		api: "openai-completions",
		provider: providerId,
		baseUrl,
	} as Model<"openai-completions">;
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
		(typeof getGlobalFreeOnlyForced === "function" &&
			getGlobalFreeOnlyForced());
	const freeOnly = getGlobalFreeOnly() && (forceFree || !options.showPaid);
	const freeIds = new Set(options.freeModels.map((model) => model.id));
	const visible = freeOnly
		? models.filter((model) => freeIds.has(model.id))
		: models;
	return applyHidden(
		visible as unknown as ProviderModelConfig[],
		providerId,
	) as T[];
}

/** Build a keyed OpenAI-compatible native provider with shared catalog lifecycle. */
export function createNativeOpenAIProvider(
	options: NativeOpenAIProviderOptions,
): NativeOpenAIProviderHandle {
	const streams = openAICompletionsApi();
	const stored: StoredModels = { free: [], all: [] };
	let showPaidOverride = options.initialShowPaid;

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
		if (options.initialShowPaid !== undefined) showPaidOverride = next;
	}

	function ingest(
		all: ProviderModelConfig[],
		free: ProviderModelConfig[],
	): void {
		stored.all = enhanceWithCI(all, options.providerId).map((model) =>
			toNativeOpenAIModel(model, options.providerId, options.baseUrl),
		);
		stored.free = enhanceWithCI(free, options.providerId).map((model) =>
			toNativeOpenAIModel(model, options.providerId, options.baseUrl),
		);
	}

	const initialModels = options.initialModels ?? [];
	if (initialModels.length > 0) {
		const all = enhanceWithCI(initialModels, options.providerId).map((model) =>
			toNativeOpenAIModel(model, options.providerId, options.baseUrl),
		);
		stored.all = all;
		stored.free = classifyFree(all);
	}

	async function refreshModels(context: RefreshModelsContext): Promise<void> {
		await refreshNativeProviderModels(
			options.providerId,
			context,
			(storedModels: Model<"openai-completions">[]) => {
				stored.all = storedModels;
				stored.free = classifyFree(storedModels);
			},
			async () => {
				const token = nativeCredentialToken(
					context.credential,
					options.getApiKey,
				);
				if (!token && !options.allowUnauthenticated) return [];
				const all = await options.fetchModels(token ?? "", context.signal);
				return enhanceWithCI(all, options.providerId).map((model) =>
					toNativeOpenAIModel(model, options.providerId, options.baseUrl),
				);
			},
			(models) => {
				stored.all = models;
				stored.free = classifyFree(models);
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
}

/** Register the standard free/all toggle used by native providers. */
export function registerNativeProviderToggle(
	pi: ExtensionAPI,
	options: NativeToggleOptions,
): void {
	const { providerId, stored, getShowPaid, reRegister } = options;

	pi.registerCommand(`toggle-${providerId}`, {
		description: `Toggle between free and all ${providerId} models`,
		handler: async (_args, ctx) => {
			const showPaid = !getShowPaid();
			await saveConfig({ [`${providerId}_show_paid`]: showPaid });
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

/** Nudge Pi's native model refresh at session start without owning refresh state. */
export function registerNativeProviderRefresh(
	pi: ExtensionAPI,
	providerId: string,
): void {
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
				if (
					result &&
					typeof (result as PromiseLike<unknown>).then === "function"
				) {
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
export async function restoreNativeProviderModels<T extends Model<Api>>(
	providerId: string,
	context: RefreshModelsContext,
	onModels: (models: T[]) => void,
): Promise<void> {
	try {
		const entry = await context.store.read();
		const models = (entry?.models ?? []).filter(
			(model) => model.provider === providerId,
		) as T[];
		if (models.length > 0) onModels(models);
	} catch (err) {
		_logger.warn(
			`Failed to read ${providerId} models store; continuing empty`,
			{
				error: err instanceof Error ? err.message : String(err),
			},
		);
	}
}

/** Refresh, publish, and persist a native provider catalog. */
export async function refreshNativeProviderModels<T extends Model<Api>>(
	providerId: string,
	context: RefreshModelsContext,
	onRestore: (models: T[]) => void,
	fetchModels: () => Promise<T[]>,
	onFetched: (models: T[]) => void | Promise<void>,
): Promise<void> {
	await restoreNativeProviderModels(providerId, context, onRestore);
	if (!context.allowNetwork || context.signal?.aborted) return;

	try {
		const models = await fetchModels();
		if (context.signal?.aborted || models.length === 0) return;
		await onFetched(models);
		await persistNativeProviderModels(providerId, context, models);
	} catch (err) {
		_logger.warn(`Failed to refresh ${providerId} models; retaining previous`, {
			error: err instanceof Error ? err.message : String(err),
		});
	}
}

/** Persist a native provider catalog while retaining the previous store on failure. */
export async function persistNativeProviderModels(
	providerId: string,
	context: RefreshModelsContext,
	models: readonly Model<Api>[],
): Promise<void> {
	try {
		await context.store.write({
			models,
			checkedAt: Date.now(),
		});
	} catch (err) {
		_logger.warn(`Failed to persist ${providerId} models to store`, {
			error: err instanceof Error ? err.message : String(err),
		});
	}
}
