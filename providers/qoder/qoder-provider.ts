/**
 * Qoder native Provider implementation.
 *
 * Qoder's catalog is a static curated list because its former catalog endpoint
 * is unavailable. Pi owns the models-store lifecycle: offline refresh restores
 * the last catalog, while an allowed online refresh republishes the static
 * catalog and persists it. No legacy cache freshness or startup network work is
 * performed here.
 */

import type {
	Api,
	Model,
	Provider,
	RefreshModelsContext,
} from "@earendil-works/pi-ai/compat";
import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { getProviderShowPaid } from "../../config.ts";
import { BASE_URL_QODER, PROVIDER_QODER } from "../../constants.ts";
import {
	filterNativeModels,
	refreshNativeProviderModels,
} from "../../lib/native-provider.ts";
import { enhanceWithCI, type StoredModels } from "../../provider-helper.ts";
import { qoderAuth } from "./auth.ts";
import { isBasicModel, staticModels } from "./models.ts";
import { streamQoder } from "./stream.ts";

type QoderModel = Model<"qoder-api">;

export interface QoderNativeProvider {
	provider: Provider<"qoder-api">;
	stored: StoredModels;
	/** Ingest a complete catalog, retaining Qoder's basic/premium split. */
	ingest: (all: ProviderModelConfig[]) => void;
}

function toQoderModel(model: ProviderModelConfig): QoderModel {
	return {
		...model,
		api: "qoder-api",
		provider: PROVIDER_QODER,
		baseUrl: BASE_URL_QODER,
	} as QoderModel;
}

function toQoderModels(models: ProviderModelConfig[]): QoderModel[] {
	return models.map(toQoderModel);
}

function staticCatalog(): { all: QoderModel[]; free: QoderModel[] } {
	const all = toQoderModels(enhanceWithCI(staticModels, PROVIDER_QODER));
	return { all, free: all.filter(isBasicModel) };
}

export function createQoderProvider(): QoderNativeProvider {
	const stored: StoredModels = { free: [], all: [] };

	function ingest(all: ProviderModelConfig[]): void {
		const models = toQoderModels(enhanceWithCI(all, PROVIDER_QODER));
		stored.all = models;
		stored.free = models.filter(isBasicModel);
	}

	const initial = staticCatalog();
	stored.all = initial.all;
	stored.free = initial.free;

	async function refreshModels(context: RefreshModelsContext): Promise<void> {
		// Shared skeleton: restore → allowNetwork gate → abort checks → fetch →
		// empty-retain → persist, with the M1 counters recorded centrally.
		await refreshNativeProviderModels(
			PROVIDER_QODER,
			context,
			(storedModels: QoderModel[]) => {
				stored.all = storedModels;
				stored.free = storedModels.filter(isBasicModel);
			},
			async () => {
				// Qoder has no supported catalog endpoint. Re-publish the curated
				// catalog through Pi's store instead of maintaining a second
				// cache/freshness policy.
				return staticCatalog().all;
			},
			(catalog) => {
				stored.all = catalog;
				stored.free = catalog.filter(isBasicModel);
			},
		);
	}

	const provider: Provider<"qoder-api"> = {
		id: PROVIDER_QODER,
		name: "Qoder",
		baseUrl: BASE_URL_QODER,
		headers: { "User-Agent": "pi-free-providers" },
		auth: qoderAuth,
		getModels: () =>
			(stored.all.length > 0 ? stored.all : stored.free) as QoderModel[],
		filterModels: (models) =>
			filterNativeModels(PROVIDER_QODER, models, {
				showPaid: getProviderShowPaid(PROVIDER_QODER),
				freeModels: stored.free,
			}),
		refreshModels,
		stream: (model, context, options) => streamQoder(model, context, options),
		streamSimple: (model, context, options) =>
			streamQoder(model, context, options),
	};

	return { provider, stored, ingest };
}

export { toQoderModel, toQoderModels };
