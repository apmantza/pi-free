import type {
	Credential,
	Model,
	Provider,
	RefreshModelsContext,
} from "@earendil-works/pi-ai/compat";
import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { getZenmuxApiKey, getZenmuxShowPaid } from "../../config.ts";
import { BASE_URL_ZENMUX, PROVIDER_ZENMUX } from "../../constants.ts";
import {
	filterNativeModels,
	refreshNativeProviderModels,
} from "../../lib/native-provider.ts";
import { lazyOpenAICompletionsApi } from "../../lib/lazy-compat.ts";
import { isFreeModel } from "../../lib/registry.ts";
import { enhanceWithCI, type StoredModels } from "../../provider-helper.ts";
import { zenmuxAuth } from "./zenmux-auth.ts";
import { fetchZenmuxCatalog, toZenmuxModels } from "./zenmux-models.ts";

type ZenmuxModel = Model<"openai-completions">;

export interface ZenmuxNativeProvider {
	provider: Provider<"openai-completions">;
	stored: StoredModels;
	ingest: (all: ProviderModelConfig[], free: ProviderModelConfig[]) => void;
}

function credentialToken(credential?: Credential): string | undefined {
	if (!credential) return getZenmuxApiKey();
	if (credential.type === "api_key") {
		return credential.key ?? getZenmuxApiKey();
	}
	return getZenmuxApiKey();
}

export function createZenmuxProvider(): ZenmuxNativeProvider {
	const streams = lazyOpenAICompletionsApi();
	const stored: StoredModels = { free: [], all: [] };

	function prepare(
		all: ProviderModelConfig[],
		free: ProviderModelConfig[],
	): { all: ZenmuxModel[]; free: ZenmuxModel[] } {
		return {
			all: toZenmuxModels(enhanceWithCI(all)),
			free: toZenmuxModels(enhanceWithCI(free)),
		};
	}

	function ingest(
		all: ProviderModelConfig[],
		free: ProviderModelConfig[],
	): void {
		const next = prepare(all, free);
		stored.all = next.all;
		stored.free = next.free;
	}

	async function refreshModels(context: RefreshModelsContext): Promise<void> {
		// Free split of the most recent fetch, kept beside the flat list the
		// shared helper passes through (see the fetch callback below).
		let fetchedFree: ZenmuxModel[] = [];
		// Shared skeleton: restore → allowNetwork gate → abort checks → fetch →
		// empty-retain → persist, with the M1 counters recorded centrally.
		await refreshNativeProviderModels(
			PROVIDER_ZENMUX,
			context,
			(storedModels: ZenmuxModel[]) => {
				stored.all = storedModels;
				stored.free = storedModels.filter((model) =>
					isFreeModel({ ...model, provider: PROVIDER_ZENMUX }, storedModels),
				);
			},
			async () => {
				const { all, free } = await fetchZenmuxCatalog({
					token: credentialToken(context.credential),
					signal: context.signal,
				});
				const next = prepare(all, free);
				fetchedFree = next.free;
				return next.all;
			},
			(next) => {
				stored.all = next;
				stored.free = fetchedFree;
			},
		);
	}

	const provider: Provider<"openai-completions"> = {
		id: PROVIDER_ZENMUX,
		name: "ZenMux",
		baseUrl: BASE_URL_ZENMUX,
		headers: {
			"User-Agent": "pi-free-providers",
		},
		auth: zenmuxAuth,
		getModels: () =>
			(stored.all.length > 0 ? stored.all : stored.free) as ZenmuxModel[],
		filterModels: (models) =>
			filterNativeModels(PROVIDER_ZENMUX, models, {
				showPaid: getZenmuxShowPaid(),
				freeModels: stored.free,
			}),
		refreshModels,
		stream: (model, context, options) => streams.stream(model, context, options),
		streamSimple: (model, context, options) =>
			streams.streamSimple(model, context, options),
	};

	return { provider, stored, ingest };
}
