import type {
	Api,
	Model,
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
