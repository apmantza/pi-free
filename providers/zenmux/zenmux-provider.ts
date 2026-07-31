import type {
	Api,
	Credential,
	Model,
	Provider,
	RefreshModelsContext,
} from "@earendil-works/pi-ai/compat";
import { openAICompletionsApi } from "@earendil-works/pi-ai/compat";
import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { getZenmuxApiKey, getZenmuxShowPaid } from "../../config.ts";
import { BASE_URL_ZENMUX, PROVIDER_ZENMUX } from "../../constants.ts";
import {
	persistNativeProviderModels,
	restoreNativeProviderModels,
} from "../../lib/native-provider.ts";
import { getGlobalFreeOnly, isFreeModel } from "../../lib/registry.ts";
import { enhanceWithCI, type StoredModels } from "../../provider-helper.ts";
import { zenmuxAuth } from "./zenmux-auth.ts";
import { fetchZenmuxCatalog, toZenmuxModels } from "./zenmux-models.ts";

type ZenmuxModel = Model<"openai-completions">;

export interface ZenmuxNativeProvider {
	provider: Provider<"openai-completions">;
	stored: StoredModels;
	setView: (models: ProviderModelConfig[]) => void;
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
	const streams = openAICompletionsApi();
	const stored: StoredModels = { free: [], all: [] };
	let currentView: ZenmuxModel[] = [];

	function decideView(): ProviderModelConfig[] {
		if (!getGlobalFreeOnly()) {
			return stored.all.length > 0 ? stored.all : stored.free;
		}
		const showPaid = getZenmuxShowPaid();
		return showPaid && stored.all.length > 0 ? stored.all : stored.free;
	}

	function setView(models: ProviderModelConfig[]): void {
		currentView = toZenmuxModels(models);
	}

	function ingest(
		all: ProviderModelConfig[],
		free: ProviderModelConfig[],
	): void {
		stored.all = toZenmuxModels(enhanceWithCI(all));
		stored.free = toZenmuxModels(enhanceWithCI(free));
		setView(decideView());
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
				setView(decideView());
			},
		);

		if (!context.allowNetwork || context.signal?.aborted) return;

		const { all, free } = await fetchZenmuxCatalog({
			token: credentialToken(context.credential),
			signal: context.signal,
		});
		if (context.signal?.aborted || all.length === 0) return;

		ingest(all, free);
		await persistNativeProviderModels(
			PROVIDER_ZENMUX,
			context,
			stored.all as unknown as readonly Model<Api>[],
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
		getModels: () => currentView,
		refreshModels,
		stream: (model, context, options) =>
			streams.stream(model, context, options),
		streamSimple: (model, context, options) =>
			streams.streamSimple(model, context, options),
	};

	return { provider, stored, setView, ingest };
}
