/**
 * Dynamic Built-in Provider Fetcher
 *
 * Fetches models dynamically from Pi's built-in providers via their
 * standard /models endpoints when the user has configured an API key.
 *
 * Uses a single generic fetch function instead of per-provider boilerplate.
 * Discovery runs concurrently and is awaited by the extension entry point.
 * Pi only flushes provider registrations after async extension startup, so
 * dynamic providers must register before setup returns.
 *
 * Providers handled:
 * - mistral (MISTRAL_API_KEY)
 * - groq (GROQ_API_KEY)
 * - cerebras (CEREBRAS_API_KEY)
 * - xai (XAI_API_KEY)
 * - opencode (OPENCODE_API_KEY from auth.json)
 * - openrouter (OPENROUTER_API_KEY from auth.json)
 * - fastrouter (always discovered, FASTROUTER_API_KEY)
 * - huggingface (HF_TOKEN - optional, special-cased API shape)
 *
 * OpenAI is intentionally skipped per user request.
 */

import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import {
	getCerebrasApiKey,
	getFastrouterApiKey,
	getFastrouterShowPaid,
	getGroqApiKey,
	getHfToken,
	getMistralApiKey,
	getOpencodeApiKey,
	getOpencodeShowPaid,
	getOpenrouterApiKey,
	getOpenrouterShowPaid,
	getXaiApiKey,
} from "../../config.ts";
import { DEFAULT_FETCH_TIMEOUT_MS } from "../../constants.ts";
import { createLogger } from "../../lib/logger.ts";
import { getProxyModelCompat } from "../../lib/provider-compat.ts";
import { isFreeModel, registerWithGlobalToggle } from "../../lib/registry.ts";
import { fetchOpenRouterCompatibleModels } from "../model-fetcher.ts";
import { createToggleState } from "../../lib/toggle-state.ts";
import { enhanceWithCI } from "../../provider-helper.ts";

const _logger = createLogger("dynamic-built-in");

// =============================================================================
// Generic Model Fetcher
// =============================================================================

interface FetchModelsOptions {
	baseUrl: string;
	apiKey: string;
	compat?: ProviderModelConfig["compat"];
	modelDefaults?: Partial<ProviderModelConfig>;
	timeoutMs?: number;
}

/**
 * Fetch models from any standard {baseUrl}/models endpoint.
 * Handles both OpenAI-style { object: "list", data: [...] } and plain arrays.
 * Uses AbortSignal.timeout for non-retry, fail-fast behaviour.
 */
async function fetchModelsFromEndpoint(
	opts: FetchModelsOptions,
): Promise<ProviderModelConfig[]> {
	let cleanBase = opts.baseUrl;
	while (cleanBase.endsWith("/")) cleanBase = cleanBase.slice(0, -1);
	const url = `${cleanBase}/models`;
	const headers: Record<string, string> = {
		Accept: "application/json",
		Authorization: `Bearer ${opts.apiKey}`,
	};

	const response = await fetch(url, {
		headers,
		signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS),
	});

	if (!response.ok) {
		throw new Error(`HTTP ${response.status} ${response.statusText}`);
	}

	const body = (await response.json()) as
		| Array<Record<string, unknown>>
		| { data?: Array<Record<string, unknown>> };
	const rawModels: Array<Record<string, unknown>> = Array.isArray(body)
		? body
		: (body.data ?? []);

	return rawModels.map((m) => {
		const id = String(m.id ?? "");
		const inputModalities = m.input_modalities as string[] | undefined;
		return {
			id,
			name: (m.name as string) ?? (m.model as string) ?? id,
			reasoning: !!(m.reasoning ?? false),
			input: inputModalities?.includes("image")
				? (["text", "image"] as const)
				: (["text"] as const),
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow:
				((m.max_context_length ?? m.context_window) as number) ??
				opts.modelDefaults?.contextWindow ??
				128_000,
			maxTokens:
				((m.max_tokens ?? m.max_completion_tokens) as number) ??
				opts.modelDefaults?.maxTokens ??
				16_384,
			_pricingKnown: false as boolean | undefined,
			...opts.modelDefaults,
			...(opts.compat ? { compat: opts.compat } : {}),
		} satisfies ProviderModelConfig & { _pricingKnown?: boolean };
	});
}

// =============================================================================
// Hugging Face (special-cased: non-standard API shape)
// =============================================================================

async function fetchHuggingFaceModels(
	apiKey?: string,
): Promise<ProviderModelConfig[]> {
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};
	if (apiKey) {
		headers.Authorization = `Bearer ${apiKey}`;
	}

	const response = await fetch(
		"https://api-inference.huggingface.co/models?pipeline_tag=text-generation&limit=50",
		{ headers, signal: AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS) },
	);

	if (!response.ok) {
		throw new Error(`Hugging Face API error: ${response.status}`);
	}

	const body = (await response.json()) as Array<{
		id: string;
		modelId?: string;
	}>;

	const models = Array.isArray(body) ? body.slice(0, 50) : [];
	return models.map((m): ProviderModelConfig => {
		const id = m.id || m.modelId || "unknown";
		return {
			id,
			name: id.split("/").pop() || "Unknown",
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 4096,
			maxTokens: 2048,
		};
	});
}

// =============================================================================
// Provider Definitions
// =============================================================================

interface DynamicProviderDef {
	providerId: string;
	getApiKey: () => string | undefined;
	baseUrl: string;
	api: "openai-completions" | "mistral-conversations" | "anthropic-messages";
	defaultShowPaid: boolean | (() => boolean);
	/** Optional per-provider compat overrides (e.g., DeepSeek proxy). */
	compat?: ProviderModelConfig["compat"];
	/** Per-model field defaults when the API doesn't expose them. */
	modelDefaults?: Partial<ProviderModelConfig>;
	/**
	 * Custom model fetcher (e.g., OpenRouter uses its own pricing-aware fetcher).
	 * When not provided, fetchModelsFromEndpoint is used (no pricing, _pricingKnown=false).
	 */
	fetchModels?: (apiKey: string) => Promise<ProviderModelConfig[]>;
}

const DYNAMIC_PROVIDERS: DynamicProviderDef[] = [
	{
		providerId: "mistral",
		getApiKey: getMistralApiKey,
		baseUrl: "https://api.mistral.ai/v1",
		api: "openai-completions",
		defaultShowPaid: false,
		modelDefaults: { contextWindow: 32_768, maxTokens: 16_384 },
	},
	{
		providerId: "groq",
		getApiKey: getGroqApiKey,
		baseUrl: "https://api.groq.com/openai/v1",
		api: "openai-completions",
		defaultShowPaid: false,
	},
	{
		providerId: "cerebras",
		getApiKey: getCerebrasApiKey,
		baseUrl: "https://api.cerebras.ai/v1",
		api: "openai-completions",
		defaultShowPaid: false,
	},
	{
		providerId: "xai",
		getApiKey: getXaiApiKey,
		baseUrl: "https://api.x.ai/v1",
		api: "openai-completions",
		defaultShowPaid: false,
	},
	{
		providerId: "opencode",
		getApiKey: getOpencodeApiKey,
		baseUrl: "https://opencode.ai/zen/v1",
		api: "openai-completions",
		defaultShowPaid: getOpencodeShowPaid,
		// OpenCode API returns no pricing — _pricingKnown=false, name-based detection
	},
	{
		providerId: "openrouter",
		getApiKey: getOpenrouterApiKey,
		baseUrl: "https://openrouter.ai/api/v1",
		api: "openai-completions",
		defaultShowPaid: getOpenrouterShowPaid,
		// OpenRouter returns full pricing — use its dedicated fetcher
		fetchModels: (apiKey) =>
			fetchOpenRouterCompatibleModels({
				baseUrl: "https://openrouter.ai/api/v1",
				apiKey,
				freeOnly: false,
			}),
	},
];

// =============================================================================
// Discovery + Registration per Provider
// =============================================================================

async function discoverAndRegister(
	pi: ExtensionAPI,
	config: DynamicProviderDef,
	apiKey: string,
): Promise<void> {
	let allModels: ProviderModelConfig[];

	try {
		if (config.fetchModels) {
			allModels = await config.fetchModels(apiKey);
		} else {
			allModels = await fetchModelsFromEndpoint({
				baseUrl: config.baseUrl,
				apiKey,
				compat: config.compat,
				modelDefaults: config.modelDefaults,
				timeoutMs: DEFAULT_FETCH_TIMEOUT_MS,
			});
		}

		// Apply DeepSeek proxy compat to matching models
		allModels = allModels.map((m) => ({
			...m,
			compat: getProxyModelCompat(m) ?? m.compat,
		}));
	} catch (error) {
		_logger.info(
			`[dynamic] ${config.providerId}: discovery failed, Pi keeps its defaults`,
			{ error: error instanceof Error ? error.message : String(error) },
		);
		return;
	}

	await registerProvider(pi, config, allModels, apiKey);
}

async function discoverAndRegisterHF(
	pi: ExtensionAPI,
	apiKey: string,
): Promise<void> {
	const config: DynamicProviderDef = {
		providerId: "huggingface",
		getApiKey: getHfToken,
		baseUrl: "https://api-inference.huggingface.co",
		api: "openai-completions",
		defaultShowPaid: false,
	};

	let allModels: ProviderModelConfig[];
	try {
		allModels = await fetchHuggingFaceModels(apiKey);
	} catch (error) {
		_logger.info(
			"[dynamic] huggingface: discovery failed, Pi keeps its defaults",
			{ error: error instanceof Error ? error.message : String(error) },
		);
		return;
	}

	await registerProvider(pi, config, allModels, apiKey);
}

// =============================================================================
// Registration Logic (sets up toggles, commands, status bar)
// =============================================================================

async function registerProvider(
	pi: ExtensionAPI,
	config: DynamicProviderDef,
	allModels: ProviderModelConfig[],
	apiKey: string,
): Promise<void> {
	const freeModels = allModels.filter((m) =>
		isFreeModel({ ...m, provider: config.providerId }, allModels),
	);

	_logger.info(
		`[dynamic] ${config.providerId}: ${allModels.length} total, ${freeModels.length} free`,
	);

	// Re-register function: called by toggle and initial apply
	const reRegister = (models: ProviderModelConfig[]) => {
		pi.registerProvider(config.providerId, {
			baseUrl: config.baseUrl,
			apiKey,
			api: config.api,
			models: enhanceWithCI(models, config.providerId),
		});
	};

	// Toggle state
	const toggleState = createToggleState({
		providerId: config.providerId,
		initialShowPaid:
			typeof config.defaultShowPaid === "function"
				? config.defaultShowPaid()
				: config.defaultShowPaid,
		initialModels: { free: freeModels, all: allModels },
	});

	// Toggle command
	pi.registerCommand(`toggle-${config.providerId}`, {
		description: `Toggle between free and all ${config.providerId} models`,
		handler: async (_args, ctx) => {
			const applied = toggleState.toggle(reRegister);
			ctx.ui.notify(
				applied.mode === "all"
					? `${config.providerId}: showing all ${allModels.length} models`
					: `${config.providerId}: showing ${freeModels.length} free models`,
				"info",
			);
		},
	});

	// Global toggle
	registerWithGlobalToggle(
		config.providerId,
		{ free: freeModels, all: allModels },
		reRegister,
		true,
	);

	// Status bar
	const pid = config.providerId;
	pi.on("model_select", (_event, ctx) => {
		if (_event.model?.provider !== pid) {
			ctx.ui.setStatus(`${pid}-status`, undefined);
			return;
		}
		const f = freeModels.length;
		const t = allModels.length;
		const p = t - f;
		const mode = toggleState.getCurrentMode();
		const status =
			p === 0
				? `${pid}: ${f} free models`
				: mode === "all"
					? `${pid}: ${t} models (free + paid)`
					: `${pid}: ${f} free \u00b7 ${p} paid`;
		ctx.ui.setStatus(`${pid}-status`, `${status} 🔑`);
	});

	// Register models (this swaps in our discovered models over Pi's defaults)
	toggleState.applyCurrent(reRegister);
	_logger.info(`[dynamic] ${config.providerId}: registered`);
}

// =============================================================================
// Main Entry
// =============================================================================

/**
 * Kick off model discovery for all configured providers.
 * Runs each fetch concurrently so startup waits for the slowest provider,
 * not `n * provider latency`.
 *
 * Pi flushes provider registrations after async extension startup completes,
 * so this function must await discovery before returning. Otherwise late
 * pi.registerProvider() calls may not be visible to startup flows such as
 * `pi --list-models` or the initial model picker.
 */
export async function setupDynamicBuiltInProviders(
	pi: ExtensionAPI,
): Promise<void> {
	const fetchers: Promise<void>[] = [];

	for (const config of DYNAMIC_PROVIDERS) {
		const apiKey = config.getApiKey();
		if (!apiKey) continue;
		fetchers.push(discoverAndRegister(pi, config, apiKey));
	}

	const hfKey = getHfToken();
	if (hfKey) {
		fetchers.push(discoverAndRegisterHF(pi, hfKey));
	}

	// FastRouter: always discovered (model listing needs no auth)
	// Uses OpenRouter-compatible format with full pricing
	fetchers.push(
		discoverAndRegister(
			pi,
			{
				providerId: "fastrouter",
				getApiKey: getFastrouterApiKey,
				baseUrl: "https://api.fastrouter.ai/api/v1",
				api: "openai-completions",
				defaultShowPaid: getFastrouterShowPaid,
				fetchModels: () =>
					fetchOpenRouterCompatibleModels({
						baseUrl: "https://api.fastrouter.ai/api/v1",
						freeOnly: false,
					}),
			},
			"" /* no key needed for listing */,
		),
	);

	if (fetchers.length === 0) return;

	_logger.info(
		`[dynamic] Kicking off discovery for ${fetchers.length} providers (concurrent)...`,
	);

	const results = await Promise.allSettled(fetchers);
	const succeeded = results.filter((r) => r.status === "fulfilled").length;
	const failed = results.filter((r) => r.status === "rejected").length;
	_logger.info(
		`[dynamic] Discovery complete: ${succeeded} succeeded, ${failed} failed/rejected`,
	);
}
