import type {
	Api,
	Model,
	Provider,
	RefreshModelsContext,
} from "@earendil-works/pi-ai/compat";
import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import { saveConfig } from "../config.ts";
import { createLogger } from "./logger.ts";
import { wrapSessionStartHandler } from "./session-start-metrics.ts";

const _logger = createLogger("native-provider");

/** Compatibility bridge for the native single-argument registrar. */
export type NativeRegistrar = {
	registerProvider(provider: Provider): void;
};

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
	reRegister: (models: ProviderModelConfig[]) => void;
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

			const modelsToShow =
				showPaid && stored.all.length > 0 ? stored.all : stored.free;
			reRegister(modelsToShow);

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
				if (result && typeof (result as Promise<void>).catch === "function") {
					(result as Promise<void>).catch((err: unknown) =>
						logRefreshFailure(providerId, err),
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
