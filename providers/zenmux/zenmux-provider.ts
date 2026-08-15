import type {
	Api,
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
	persistNativeProviderModels,
	restoreNativeProviderModels,
} from "../../lib/native-provider.ts";
import {
	recordNativeAbort,
	recordNativeEmptyRetain,
	recordNativeRefreshOk,
} from "../../lib/startup-timing.ts";
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
		await restoreNativeProviderModels(
			PROVIDER_ZENMUX,
			context,
			(storedModels: ZenmuxModel[]) => {
				stored.all = storedModels;
				stored.free = storedModels.filter((model) =>
					isFreeModel({ ...model, provider: PROVIDER_ZENMUX }, storedModels),
				);
			},
		);

		if (!context.allowNetwork) return;
		if (context.signal?.aborted) {
			recordNativeAbort(PROVIDER_ZENMUX);
			return;
		}

		const { all, free } = await fetchZenmuxCatalog({
			token: credentialToken(context.credential),
			signal: context.signal,
		});
		if (context.signal?.aborted) {
			recordNativeAbort(PROVIDER_ZENMUX);
			return;
		}
		if (all.length === 0) {
			recordNativeEmptyRetain(PROVIDER_ZENMUX);
			return;
		}

		const next = prepare(all, free);
		await persistNativeProviderModels(
			PROVIDER_ZENMUX,
			context,
			next.all as unknown as readonly Model<Api>[],
			() => {
				stored.all = next.all;
				stored.free = next.free;
			},
		);
		recordNativeRefreshOk(PROVIDER_ZENMUX, next.all.length);
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
