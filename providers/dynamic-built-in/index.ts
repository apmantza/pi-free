/**
 * Dynamic Built-in Provider Fetcher
 *
 * Fetches models dynamically from Pi's built-in providers via their
 * standard /models endpoints when the user has configured an API key.
 *
 * Uses a single generic fetch function instead of per-provider boilerplate.
 * Discovery runs concurrently with 1s timeout per provider, fire-and-forget
 * so extension init never blocks. Pi's built-in defaults serve until
 * discovery completes and replaces them.
 *
 * Providers handled:
 * - mistral (MISTRAL_API_KEY)
 * - groq (GROQ_API_KEY)
 * - cerebras (CEREBRAS_API_KEY)
 * - xai (XAI_API_KEY)
 * - huggingface (HF_TOKEN - optional, special-cased API shape)
 *
 * OpenAI is intentionally skipped per user request.
 */

import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@mariozechner/pi-coding-agent";
import {
	getCerebrasApiKey,
	getGroqApiKey,
	getHfToken,
	getMistralApiKey,
	getXaiApiKey,
} from "../../config.ts";
import { createLogger } from "../../lib/logger.ts";
import { getProxyModelCompat } from "../../lib/provider-compat.ts";
import { isFreeModel, registerWithGlobalToggle } from "../../lib/registry.ts";
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
		signal: AbortSignal.timeout(opts.timeoutMs ?? 1_000),
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
			...opts.modelDefaults,
			...(opts.compat ? { compat: opts.compat } : {}),
		} satisfies ProviderModelConfig;
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
		{ headers, signal: AbortSignal.timeout(1_000) },
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
	defaultShowPaid: boolean;
	/** Optional per-provider compat overrides (e.g., DeepSeek proxy). */
	compat?: ProviderModelConfig["compat"];
	/** Per-model field defaults when the API doesn't expose them. */
	modelDefaults?: Partial<ProviderModelConfig>;
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
		allModels = await fetchModelsFromEndpoint({
			baseUrl: config.baseUrl,
			apiKey,
			compat: config.compat,
			modelDefaults: config.modelDefaults,
			timeoutMs: 1_000,
		});

		// Apply DeepSeek proxy compat to matching models
		allModels = allModels.map((m) => ({
			...m,
			compat: getProxyModelCompat(m) ?? m.compat,
		}));
	} catch {
		_logger.info(
			`[dynamic] ${config.providerId}: discovery failed, Pi keeps its defaults`,
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
	} catch {
		_logger.info(
			"[dynamic] huggingface: discovery failed, Pi keeps its defaults",
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
		initialShowPaid: config.defaultShowPaid,
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
// Main Entry — Fire-and-Forget
// =============================================================================

/**
 * Kick off model discovery for all configured providers.
 * Runs each fetch concurrently with a 1s timeout so the worst-case
 * wall time is ~1s, not `n * 1s`. Extension init never blocks.
 *
 * Pi's built-in defaults serve until discovery completes and this
 * function replaces them via pi.registerProvider().
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

	if (fetchers.length === 0) return;

	_logger.info(
		`[dynamic] Kicking off discovery for ${fetchers.length} providers (1s timeout each, concurrent)...`,
	);

	// Fire-and-forget: log results, never block init
	void Promise.allSettled(fetchers).then((results) => {
		const succeeded = results.filter((r) => r.status === "fulfilled").length;
		const failed = results.filter((r) => r.status === "rejected").length;
		_logger.info(
			`[dynamic] Discovery complete: ${succeeded} succeeded, ${failed} failed/rejected`,
		);
	});
}
