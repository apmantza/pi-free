import type {
	Api,
	AssistantMessage,
	Credential,
	Model,
	Provider,
	RefreshModelsContext,
	SimpleStreamOptions,
	AssistantMessageEventStream,
	Context,
} from "@earendil-works/pi-ai/compat";
import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import { getTokenrouterApiKey, getTokenrouterShowPaid } from "../../config.ts";
import { BASE_URL_TOKENROUTER, PROVIDER_TOKENROUTER } from "../../constants.ts";
import {
	refreshNativeProviderModels,
	registerNativeProvider,
	registerNativeProviderRefresh,
	registerNativeProviderToggle,
} from "../../lib/native-provider.ts";
import {
	getGlobalFreeOnly,
	isFreeModel,
	registerWithGlobalToggle,
} from "../../lib/registry.ts";
import { loadProviderCache } from "../../lib/provider-cache.ts";
import { enhanceWithCI, type StoredModels } from "../../provider-helper.ts";
import { tokenRouterAuth } from "./tokenrouter-auth.ts";

export interface TokenRouterProviderDeps {
	fetchModels: (
		apiKey: string,
		signal?: AbortSignal,
	) => Promise<ProviderModelConfig[]>;
	streamSimple: (
		model: Model<Api>,
		context: Context,
		options?: SimpleStreamOptions,
	) => AssistantMessageEventStream;
	isModel: (model: { provider?: string }) => boolean;
	isMinimaxModel: (modelId: string) => boolean;
	normalizeMessage: (message: AssistantMessage) => AssistantMessage;
	patchPayload: (payload: unknown, force?: boolean) => unknown;
}

export interface TokenRouterNativeProvider {
	provider: Provider<"tokenrouter-openai-completions">;
	stored: StoredModels;
	setView: (models: ProviderModelConfig[]) => void;
	ingest: (all: ProviderModelConfig[], free: ProviderModelConfig[]) => void;
}

type TokenRouterNativeModel = Model<"tokenrouter-openai-completions">;

function credentialToken(credential?: Credential): string | undefined {
	if (!credential) return getTokenrouterApiKey();
	if (credential.type === "api_key") {
		return credential.key ?? getTokenrouterApiKey();
	}
	return getTokenrouterApiKey();
}

function toTokenRouterModel(
	model: ProviderModelConfig,
): TokenRouterNativeModel {
	return {
		...model,
		api: "tokenrouter-openai-completions",
		provider: PROVIDER_TOKENROUTER,
		baseUrl: BASE_URL_TOKENROUTER,
	} as TokenRouterNativeModel;
}

function toTokenRouterModels(
	models: ProviderModelConfig[],
): TokenRouterNativeModel[] {
	return models.map(toTokenRouterModel);
}

function classifyFreeModels(
	models: TokenRouterNativeModel[],
): TokenRouterNativeModel[] {
	return models.filter((model) =>
		isFreeModel({ ...model, provider: PROVIDER_TOKENROUTER }, models),
	);
}

export function createTokenRouterProvider(
	deps: TokenRouterProviderDeps,
	initialModels: ProviderModelConfig[] = loadProviderCache(
		PROVIDER_TOKENROUTER,
	) ?? [],
): TokenRouterNativeProvider {
	const stored: StoredModels = { free: [], all: [] };
	let currentView: TokenRouterNativeModel[] = [];

	function decideView(): ProviderModelConfig[] {
		if (!getGlobalFreeOnly()) {
			return stored.all.length > 0 ? stored.all : stored.free;
		}
		const showPaid = getTokenrouterShowPaid();
		return showPaid && stored.all.length > 0 ? stored.all : stored.free;
	}

	function setView(models: ProviderModelConfig[]): void {
		currentView = toTokenRouterModels(models);
	}

	function ingest(
		all: ProviderModelConfig[],
		free: ProviderModelConfig[],
	): void {
		stored.all = toTokenRouterModels(enhanceWithCI(all, PROVIDER_TOKENROUTER));
		stored.free = toTokenRouterModels(
			enhanceWithCI(free, PROVIDER_TOKENROUTER),
		);
		setView(decideView());
	}

	if (initialModels.length > 0) {
		const all = toTokenRouterModels(
			enhanceWithCI(initialModels, PROVIDER_TOKENROUTER),
		);
		stored.all = all;
		stored.free = classifyFreeModels(all);
		setView(decideView());
	}

	async function refreshModels(context: RefreshModelsContext): Promise<void> {
		await refreshNativeProviderModels(
			PROVIDER_TOKENROUTER,
			context,
			(storedModels: TokenRouterNativeModel[]) => {
				stored.all = storedModels;
				stored.free = classifyFreeModels(storedModels);
				setView(decideView());
			},
			async () => {
				const token = credentialToken(context.credential);
				if (!token) return [];
				const all = await deps.fetchModels(token, context.signal);
				return toTokenRouterModels(enhanceWithCI(all, PROVIDER_TOKENROUTER));
			},
			(models) => {
				stored.all = models;
				stored.free = classifyFreeModels(models);
				setView(decideView());
			},
		);
	}

	const provider: Provider<"tokenrouter-openai-completions"> = {
		id: PROVIDER_TOKENROUTER,
		name: "TokenRouter",
		baseUrl: BASE_URL_TOKENROUTER,
		headers: { "User-Agent": "pi-free-providers" },
		auth: tokenRouterAuth,
		getModels: () => currentView,
		refreshModels,
		stream: (model, context, options) =>
			deps.streamSimple(model, context, options),
		streamSimple: (model, context, options) =>
			deps.streamSimple(model, context, options),
	};

	return { provider, stored, setView, ingest };
}

export function registerTokenRouterProvider(
	pi: ExtensionAPI,
	deps: TokenRouterProviderDeps,
): void {
	const { provider, stored, setView } = createTokenRouterProvider(deps);
	registerNativeProvider(pi, provider);

	const reRegister = (models: ProviderModelConfig[]) => {
		setView(models);
		registerNativeProvider(pi, provider);
	};

	registerWithGlobalToggle(
		PROVIDER_TOKENROUTER,
		stored,
		reRegister,
		Boolean(getTokenrouterApiKey()),
	);
	registerNativeProviderToggle(pi, {
		providerId: PROVIDER_TOKENROUTER,
		stored,
		getShowPaid: getTokenrouterShowPaid,
		reRegister,
	});

	pi.on("before_provider_request", (event, ctx) =>
		deps.patchPayload(
			event.payload,
			deps.isModel(ctx.model ?? {}) && deps.isMinimaxModel(ctx.model?.id ?? ""),
		),
	);

	pi.on("message_end", (event, ctx) => {
		if (!deps.isModel(ctx.model ?? {})) return;
		if (event.message.role !== "assistant") return;
		return { message: deps.normalizeMessage(event.message) };
	});

	registerNativeProviderRefresh(pi, PROVIDER_TOKENROUTER);
}
