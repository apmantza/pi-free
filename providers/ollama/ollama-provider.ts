import type {
	Credential,
	Model,
	Provider,
	RefreshModelsContext,
} from "@earendil-works/pi-ai/compat";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import { getOllamaApiKey, getOllamaShowPaid } from "../../config.ts";
import { BASE_URL_OLLAMA, PROVIDER_OLLAMA } from "../../constants.ts";
import {
	filterNativeModels,
	refreshNativeProviderModels,
	registerNativeProvider,
	registerNativeProviderRefresh,
	registerNativeProviderToggle,
} from "../../lib/native-provider.ts";
import { areAllModelsFresh } from "../../lib/probe-cache.ts";
import {
	loadProviderCache,
	saveProviderCache,
} from "../../lib/provider-cache.ts";
import {
	trackDetachedSessionStart,
	wrapSessionStartHandler,
} from "../../lib/session-start-metrics.ts";
import { registerWithGlobalToggle } from "../../lib/registry.ts";
import { enhanceWithCI, type StoredModels } from "../../provider-helper.ts";
import { ollamaAuth } from "./ollama-auth.ts";

export interface OllamaProviderDeps {
	fallbackModels: ProviderModelConfig[];
	fetchModels: (
		apiKey: string,
		cachedModels?: ProviderModelConfig[],
		signal?: AbortSignal,
	) => Promise<ProviderModelConfig[]>;
	probeModels: (
		apiKey: string,
		models: ProviderModelConfig[],
		applyModels: (models: ProviderModelConfig[]) => void,
		options?: { useCache?: boolean },
	) => Promise<string[]>;
}

/** Native Ollama Cloud provider handle used by the extension factory and probes. */
export interface OllamaNativeProvider {
	provider: Provider<"openai-completions">;
	stored: StoredModels;
	ingest: (all: ProviderModelConfig[], free: ProviderModelConfig[]) => void;
}

type OllamaModel = Model<"openai-completions">;

function credentialToken(credential?: Credential): string | undefined {
	if (!credential) return getOllamaApiKey();
	if (credential.type === "api_key") {
		return credential.key ?? getOllamaApiKey();
	}
	return getOllamaApiKey();
}

function toOllamaModel(model: ProviderModelConfig): OllamaModel {
	return {
		...model,
		api: "openai-completions",
		provider: PROVIDER_OLLAMA,
		baseUrl: BASE_URL_OLLAMA,
	} as OllamaModel;
}

function toOllamaModels(models: ProviderModelConfig[]): OllamaModel[] {
	return models.map(toOllamaModel);
}

export function createOllamaProvider(
	deps: OllamaProviderDeps,
	initialModels: ProviderModelConfig[] = deps.fallbackModels,
): OllamaNativeProvider {
	const streams = openAICompletionsApi();
	const stored: StoredModels = { free: [], all: [] };

	function ingest(
		all: ProviderModelConfig[],
		free: ProviderModelConfig[],
	): void {
		stored.all = toOllamaModels(enhanceWithCI(all, PROVIDER_OLLAMA));
		stored.free = toOllamaModels(enhanceWithCI(free, PROVIDER_OLLAMA));
	}

	ingest(initialModels, initialModels);

	function restoreStoredModels(storedModels: OllamaModel[]): void {
		stored.all = storedModels;
		stored.free = storedModels;
	}

	async function refreshOllamaModels(
		context: RefreshModelsContext,
	): Promise<void> {
		await refreshNativeProviderModels(
			PROVIDER_OLLAMA,
			context,
			restoreStoredModels,
			async () => {
				const token = credentialToken(context.credential);
				if (!token) return [];
				const fresh = await deps.fetchModels(
					token,
					loadProviderCache(PROVIDER_OLLAMA),
					context.signal,
				);
				await saveProviderCache(PROVIDER_OLLAMA, fresh);
				return toOllamaModels(enhanceWithCI(fresh, PROVIDER_OLLAMA));
			},
			(models) => {
				stored.all = models;
				stored.free = models;
			},
		);
	}

	const provider: Provider<"openai-completions"> = {
		id: PROVIDER_OLLAMA,
		name: "Ollama Cloud",
		baseUrl: BASE_URL_OLLAMA,
		headers: { "User-Agent": "pi-free-providers" },
		auth: ollamaAuth,
		getModels: () =>
			(stored.all.length > 0 ? stored.all : stored.free) as OllamaModel[],
		filterModels: (models) =>
			filterNativeModels(PROVIDER_OLLAMA, models, {
				showPaid: getOllamaShowPaid(),
				freeModels: stored.free,
			}),
		refreshModels: refreshOllamaModels,
		stream: (model, context, options) =>
			streams.stream(model, context, options),
		streamSimple: (model, context, options) =>
			streams.streamSimple(model, context, options),
	};

	return { provider, stored, ingest };
}

export function registerOllamaProvider(
	pi: ExtensionAPI,
	deps: OllamaProviderDeps,
): void {
	const cachedModels = loadProviderCache(PROVIDER_OLLAMA);
	const initialModels =
		cachedModels && cachedModels.length > 0
			? cachedModels
			: deps.fallbackModels;
	const { provider, stored, ingest } = createOllamaProvider(
		deps,
		initialModels,
	);
	registerNativeProvider(pi, provider);

	const reRegister = () => {
		registerNativeProvider(pi, provider);
	};
	const applyModelList = (models: ProviderModelConfig[]) => {
		ingest(models, models);
		registerNativeProvider(pi, provider);
	};
	const currentModels = () => stored.all;

	registerWithGlobalToggle(
		PROVIDER_OLLAMA,
		stored,
		reRegister,
		Boolean(getOllamaApiKey()),
		{ native: true, invalidate: reRegister },
	);
	registerNativeProviderToggle(pi, {
		providerId: PROVIDER_OLLAMA,
		stored,
		getShowPaid: getOllamaShowPaid,
		reRegister,
	});

	pi.registerCommand("ollama-cloud-refresh", {
		description:
			"Re-fetch Ollama Cloud models from the API and update the provider live",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			const apiKey = getOllamaApiKey();
			if (!apiKey) {
				ctx.ui.notify("OLLAMA_API_KEY not set", "error");
				return;
			}
			ctx.ui.notify("Refreshing Ollama Cloud models…", "info");
			try {
				const fresh = await deps.fetchModels(
					apiKey,
					loadProviderCache(PROVIDER_OLLAMA),
				);
				await saveProviderCache(PROVIDER_OLLAMA, fresh);
				applyModelList(fresh);
				ctx.ui.notify(
					`Registered ${fresh.length} Ollama Cloud models (refresh complete)`,
					"info",
				);
			} catch (error) {
				ctx.ui.notify(
					`Refresh failed: ${error instanceof Error ? error.message : String(error)}`,
					"error",
				);
			}
		},
	});

	pi.registerCommand("probe-ollama", {
		description: "Test all Ollama Cloud models for 403 'access denied' errors",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			const apiKey = getOllamaApiKey();
			if (!apiKey) {
				ctx.ui.notify("OLLAMA_API_KEY not set", "error");
				return;
			}

			const modelsToTest = currentModels();
			ctx.ui.notify(`Probing ${modelsToTest.length} Ollama models…`, "info");
			const notFound = await deps.probeModels(
				apiKey,
				modelsToTest,
				applyModelList,
			);

			if (notFound.length === 0) {
				ctx.ui.notify("All Ollama models are accessible ✅", "info");
				return;
			}
			ctx.ui.notify(
				`Found ${notFound.length} broken models (auto-hidden):\n${notFound.join("\n")}`,
				"warning",
			);
		},
	});

	const runProbeInBackground = (
		models: ProviderModelConfig[],
	): Promise<string[]> | undefined => {
		if (
			areAllModelsFresh(
				PROVIDER_OLLAMA,
				models.map((model) => model.id),
			)
		) {
			return;
		}
		const apiKey = getOllamaApiKey();
		if (!apiKey) return;
		return deps.probeModels(apiKey, models, applyModelList, { useCache: true });
	};

	// Pi owns the native model refresh; this handler preserves Ollama's
	// background accessibility probe without reintroducing a second catalog fetch.
	pi.on(
		"session_start",
		wrapSessionStartHandler("ollama-cloud", () => {
			const task = runProbeInBackground(currentModels());
			if (task) {
				trackDetachedSessionStart("ollama-cloud-probe", task);
			}
		}),
	);
	registerNativeProviderRefresh(pi, PROVIDER_OLLAMA);
}
