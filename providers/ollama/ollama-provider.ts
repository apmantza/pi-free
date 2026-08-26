import type {
	Credential,
	Model,
	Provider,
	RefreshModelsContext,
} from "@earendil-works/pi-ai/compat";
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
	withGatewayCompat,
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
import { registerWithGlobalToggle, isFreeModel } from "../../lib/registry.ts";
import { lazyOpenAICompletionsApi } from "../../lib/lazy-compat.ts";
import {
	fetchUsage,
	formatUsage,
	formatUsageStatusColored,
} from "./ollama-usage.ts";
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
	return withGatewayCompat({
		...model,
		api: "openai-completions",
		provider: PROVIDER_OLLAMA,
		baseUrl: BASE_URL_OLLAMA,
	} as OllamaModel);
}

function toOllamaModels(models: ProviderModelConfig[]): OllamaModel[] {
	return models.map(toOllamaModel);
}

export function createOllamaProvider(
	deps: OllamaProviderDeps,
	initialModels: ProviderModelConfig[] = deps.fallbackModels,
): OllamaNativeProvider {
	const streams = lazyOpenAICompletionsApi();
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
		// Reclassify free/paid like every other custom native provider — a blind
		// `stored.free = storedModels` made the free-only view show paid models
		// after a store restore.
		stored.free = storedModels.filter((model) =>
			isFreeModel({ ...model, provider: PROVIDER_OLLAMA }, storedModels),
		);
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
				// A degenerate/empty fetch must not overwrite the capability cache —
				// return before saving so refreshNativeProviderModels' empty-retain
				// path keeps both the previous catalog AND the previous cache.
				if (fresh.length === 0) return [];
				await saveProviderCache(PROVIDER_OLLAMA, fresh);
				return toOllamaModels(enhanceWithCI(fresh, PROVIDER_OLLAMA));
			},
			(models) => {
				stored.all = models;
				stored.free = models.filter((model) =>
					isFreeModel({ ...model, provider: PROVIDER_OLLAMA }, models),
				);
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
		stream: (model, context, options) => streams.stream(model, context, options),
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
		cachedModels && cachedModels.length > 0 ? cachedModels : deps.fallbackModels;
	const { provider, stored, ingest } = createOllamaProvider(deps, initialModels);
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
		// PROVIDER_OLLAMA is "ollama-cloud", but getOllamaShowPaid reads
		// `ollama_show_paid`. Persist under that key so /toggle-ollama-cloud
		// survives a restart.
		configKey: "ollama_show_paid",
	});

	// =========================================================================
	// Usage integration (undocumented /api/usage endpoint)
	// =========================================================================

	const USAGE_STATUS_KEY = "ollama-usage";
	const USAGE_REFRESH_MS = 5 * 60_000;
	let usageTimer: ReturnType<typeof setInterval> | null = null;
	let lastUsageRefreshAt = 0;

	async function refreshUsageStatus(ctx: {
		ui: ExtensionCommandContext["ui"];
	}): Promise<void> {
		const apiKey = getOllamaApiKey();
		if (!apiKey) return;
		try {
			const data = await fetchUsage(apiKey);
			lastUsageRefreshAt = Date.now();
			const formatted = formatUsageStatusColored(ctx.ui.theme, data);
			ctx.ui.setStatus(USAGE_STATUS_KEY, formatted);
		} catch {
			// Silent: the endpoint is undocumented and may change; failed fetches
			// must not degrade the user experience.
		}
	}

	pi.registerCommand("ollama-cloud-usage", {
		description: "Show Ollama Cloud session and weekly usage limits",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			const apiKey = getOllamaApiKey();
			if (!apiKey) {
				ctx.ui.notify("OLLAMA_API_KEY not set", "error");
				return;
			}
			try {
				const data = await fetchUsage(apiKey);
				ctx.ui.notify(formatUsage(data), "info");
			} catch (error) {
				ctx.ui.notify(
					`Usage fetch failed: ${error instanceof Error ? error.message : String(error)}`,
					"error",
				);
			}
		},
	});

	pi.on("agent_end", async (_event, ctx) => {
		if (ctx.model?.provider !== PROVIDER_OLLAMA) return;
		if (Date.now() - lastUsageRefreshAt < USAGE_REFRESH_MS) return;
		await refreshUsageStatus(ctx);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		if (usageTimer) {
			clearInterval(usageTimer);
			usageTimer = null;
		}
		ctx.ui.setStatus(USAGE_STATUS_KEY, "");
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
