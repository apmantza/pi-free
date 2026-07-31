/**
 * Ollama Cloud Provider Extension
 *
 * Provides access to Ollama's cloud-hosted models via ollama.com API.
 * Fetches per-model capabilities via /api/show for accurate reasoning,
 * vision, and context window detection.
 *
 * Requires OLLAMA_API_KEY with cloud access.
 * Get a free key at: https://ollama.com/settings/keys
 *
 * Usage:
 *   pi install git:github.com/apmantza/pi-free
 *   # Set OLLAMA_API_KEY env var
 *   # Models appear in /model selector
 *   # Use /toggle-ollama to show all vs limited set
 *   # Use /probe-ollama to detect and hide 403 models
 *   # Use /ollama-cloud-refresh to re-fetch models live
 */

import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import { applyHidden, updateConfig } from "../../config.ts";
import {
	BASE_URL_OLLAMA,
	DEFAULT_FETCH_TIMEOUT_MS,
	PROVIDER_OLLAMA,
} from "../../constants.ts";
import { createLogger } from "../../lib/logger.ts";
import {
	loadProviderCache,
	saveProviderCache,
} from "../../lib/provider-cache.ts";
import {
	getModelsDueForProbe,
	recordModelProbeResults,
} from "../../lib/probe-cache.ts";
import { fetchWithRetry, fetchWithTimeout } from "../../lib/util.ts";
import { resolveThinkingMap } from "./thinking-levels.ts";
import {
	createOllamaProvider as createNativeOllamaProvider,
	registerOllamaProvider,
	type OllamaProviderDeps,
} from "./ollama-provider.ts";

const _logger = createLogger("ollama-cloud");

// =============================================================================
// Constants
// =============================================================================

/** Base URL for non-OpenAI-compatible endpoints (e.g. /api/show). */
const OLLAMA_API_BASE = BASE_URL_OLLAMA.replace(/\/v1\/?$/, "");
const DETAIL_FETCH_TIMEOUT_MS = 10000;
const DETAIL_CONCURRENCY = 8;

// =============================================================================
// Known 403 models (listed but return "access denied" on /v1/chat/completions)
// These are models that appear in /v1/models but aren't provisioned for chat.
// Add new IDs here as they surface via /probe-ollama command.
// =============================================================================
const OLLAMA_KNOWN_403_MODELS: ReadonlySet<string> = new Set([
	// Example entries - populate via probe-ollama.mjs
	// "model-id-that-403s",
]);

// =============================================================================
// Fallback models (used when API is unreachable and no cache exists)
// =============================================================================
export const FALLBACK_MODELS: ProviderModelConfig[] = [
	{
		id: "glm-5.1",
		name: "GLM 5.1",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 202752,
		maxTokens: 32768,
		compat: { supportsDeveloperRole: false },
	},
	{
		id: "gemma4:31b",
		name: "Gemma 4 31B",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 262144,
		maxTokens: 32768,
		compat: { supportsDeveloperRole: false },
	},
	{
		id: "deepseek-v4-pro",
		name: "DeepSeek V4 Pro",
		reasoning: true,
		thinkingLevelMap: resolveThinkingMap("deepseek-v4-pro", [
			"thinking",
			"tools",
		]),
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1000000,
		maxTokens: 32768,
		compat: { supportsDeveloperRole: false },
	},
	{
		id: "qwen3.5",
		name: "Qwen 3.5",
		reasoning: true,
		thinkingLevelMap: resolveThinkingMap("qwen3.5", ["thinking", "tools"]),
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 131072,
		maxTokens: 32768,
		compat: { supportsDeveloperRole: false },
	},
	{
		id: "kimi-k2.6",
		name: "Kimi K2.6",
		reasoning: true,
		thinkingLevelMap: resolveThinkingMap("kimi-k2.6", ["thinking", "tools"]),
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 131072,
		maxTokens: 32768,
		compat: { supportsDeveloperRole: false },
	},
];

// =============================================================================
// Types
// =============================================================================

/** Response from POST /api/show */
interface OllamaShowResponse {
	details: {
		parent_model: string;
		format: string;
		family: string;
		families: string[] | null;
		parameter_size: string;
		quantization_level: string;
	};
	model_info: Record<string, unknown>;
	capabilities: string[];
	modified_at: string;
}

// =============================================================================
// Utility: concurrent map with bounded parallelism
// =============================================================================

async function concurrentMap<T, R>(
	items: T[],
	workers: number,
	fn: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
	const results: PromiseSettledResult<R>[] = new Array(items.length);
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.max(1, workers) }, async () => {
			while (next < items.length) {
				const index = next++;
				try {
					results[index] = {
						status: "fulfilled",
						value: await fn(items[index]),
					};
				} catch (reason) {
					results[index] = { status: "rejected", reason };
				}
			}
			return undefined;
		}),
	);
	return results;
}

// =============================================================================
// Fetch: /v1/models → list of model IDs
// =============================================================================

async function fetchModelIds(
	apiKey: string,
	signal?: AbortSignal,
): Promise<string[]> {
	const response = await fetchWithRetry(
		`${BASE_URL_OLLAMA}/models`,
		{
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
			signal,
		},
		3,
		1000,
		DEFAULT_FETCH_TIMEOUT_MS,
	);

	if (!response.ok) {
		throw new Error(
			`Failed to fetch Ollama model list: ${response.status} ${response.statusText}`,
		);
	}

	const json = (await response.json()) as {
		data?: Array<{ id: string; owned_by?: string }>;
	};
	return (json.data ?? []).map((m) => m.id);
}

// =============================================================================
// Fetch: /api/show → per-model capabilities
// =============================================================================

async function fetchModelDetails(
	apiKey: string,
	modelId: string,
	signal?: AbortSignal,
): Promise<OllamaShowResponse> {
	const response = await fetchWithTimeout(
		`${OLLAMA_API_BASE}/api/show`,
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ model: modelId }),
			signal,
		},
		DETAIL_FETCH_TIMEOUT_MS,
	);

	if (!response.ok) {
		throw new Error(
			`/api/show failed for ${modelId}: ${response.status} ${response.statusText}`,
		);
	}

	return (await response.json()) as OllamaShowResponse;
}

// =============================================================================
// Assembly: raw /api/show data → ProviderModelConfig[]
// =============================================================================

function getContextLength(modelInfo: Record<string, unknown>): number {
	for (const [key, value] of Object.entries(modelInfo)) {
		if (key.endsWith(".context_length") && typeof value === "number") {
			return value;
		}
	}
	return 128000; // fallback
}

/**
 * Build a human-readable display name from model ID and details.
 * Enriches with parameter size and quantization when available.
 */
function buildModelName(
	id: string,
	details: OllamaShowResponse["details"],
): string {
	// Convert dashes/colons to spaces for readability
	const base = id.replace(/[:-]/g, " ");
	const parts: string[] = [base];

	const params = details?.parameter_size;
	const quant = details?.quantization_level;

	if (params && quant) {
		parts.push(`(${params}, ${quant})`);
	} else if (params) {
		parts.push(`(${params})`);
	}

	return parts.join(" ");
}

function assembleModels(
	raw: Record<string, OllamaShowResponse>,
): ProviderModelConfig[] {
	return Object.entries(raw)
		.filter(([, data]) => data.capabilities?.includes("tools"))
		.map(([id, data]) => {
			const reasoning = data.capabilities?.includes("thinking") ?? false;
			const thinkingMap = resolveThinkingMap(id, data.capabilities ?? []);

			return {
				id,
				name: buildModelName(id, data.details),
				reasoning,
				thinkingLevelMap: thinkingMap,
				input: (data.capabilities?.includes("vision")
					? ["text", "image"]
					: ["text"]) as ("text" | "image")[],
				cost: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
				},
				contextWindow: getContextLength(data.model_info ?? {}),
				maxTokens: 32768,
				compat: {
					supportsDeveloperRole: false,
					// When we provide a thinkingLevelMap, tell Pi not to use its own
					// reasoning_effort logic — we handle it ourselves.
					supportsReasoningEffort: thinkingMap != null,
				},
			};
		});
}

// =============================================================================
// Fetch all models (orchestrates /v1/models + /api/show)
// =============================================================================

export async function fetchAllModels(
	apiKey: string,
	cachedModels: ProviderModelConfig[] = loadProviderCache(PROVIDER_OLLAMA) ??
		[],
	signal?: AbortSignal,
): Promise<ProviderModelConfig[]> {
	// Step 1: Get model IDs
	const modelIds = await fetchModelIds(apiKey, signal);
	_logger.info(
		`[ollama-cloud] Found ${modelIds.length} model IDs, fetching details...`,
	);

	// Step 2: Filter out known-broken and embedding models early
	const candidateIds = modelIds.filter((id) => {
		if (OLLAMA_KNOWN_403_MODELS.has(id)) return false;
		const name = id.toLowerCase();
		if (name.includes("embed")) return false;
		return true;
	});

	// Step 3: Reuse derived capabilities for models already in the cache.
	// The model list expires hourly, but /api/show capabilities are retained
	// until a model disappears and is later discovered as new.
	const cachedById = new Map(cachedModels.map((model) => [model.id, model]));
	const newCandidateIds = candidateIds.filter((id) => !cachedById.has(id));
	let succeeded = 0;
	let failed = 0;

	const detailResults = await concurrentMap(
		newCandidateIds,
		DETAIL_CONCURRENCY,
		async (id) => {
			try {
				const result = await fetchModelDetails(apiKey, id, signal);
				succeeded++;
				return [id, result] as const;
			} catch {
				failed++;
				throw new Error(`detail fetch failed for ${id}`);
			} finally {
				if (
					(succeeded + failed) % 10 === 0 ||
					succeeded + failed === newCandidateIds.length
				) {
					_logger.debug(
						`[ollama-cloud] Detail progress: ${succeeded + failed}/${newCandidateIds.length} (${failed} failed)`,
					);
				}
			}
		},
	);

	// Step 4: Collect successful results
	const raw: Record<string, OllamaShowResponse> = {};
	for (const result of detailResults) {
		if (result.status === "fulfilled") {
			const [id, data] = result.value;
			raw[id] = data;
		}
	}

	_logger.info(
		`[ollama-cloud] Fetched ${Object.keys(raw).length} model details` +
			(failed ? ` (${failed} failed)` : ""),
	);

	// Step 5: Assemble new models and merge them with cached capabilities in the
	// API's current order. Existing cached models are not re-requested.
	const freshModels = assembleModels(raw);
	const freshById = new Map(freshModels.map((model) => [model.id, model]));
	const models = candidateIds
		.map((id) => cachedById.get(id) ?? freshById.get(id))
		.filter((model): model is ProviderModelConfig => model !== undefined);

	if (models.length === 0) {
		throw new Error("Failed to fetch any model details");
	}

	// Step 6: Apply user-configured hidden models
	return applyHidden(models, PROVIDER_OLLAMA);
}

export async function runOllamaProbe(
	apiKey: string,
	modelsToTest: ProviderModelConfig[],
	applyModels: (models: ProviderModelConfig[]) => void,
	options: { useCache?: boolean } = {},
): Promise<string[]> {
	const modelIdsToProbe = options.useCache
		? new Set(
				getModelsDueForProbe(
					PROVIDER_OLLAMA,
					modelsToTest.map((m) => m.id),
				),
			)
		: undefined;
	const probeCandidates = modelIdsToProbe
		? modelsToTest.filter((m) => modelIdsToProbe.has(m.id))
		: modelsToTest;

	if (probeCandidates.length === 0) {
		_logger.info("Auto-probe: Ollama probe cache is fresh");
		return [];
	}

	const notFound: string[] = [];
	const cacheableResults: Array<{ modelId: string; status: "ok" | "broken" }> =
		[];
	const batchSize = 5;

	for (let i = 0; i < probeCandidates.length; i += batchSize) {
		const batch = probeCandidates.slice(i, i + batchSize);
		const results = await Promise.all(
			batch.map(async (m) => {
				const status = await probeOllamaModel(apiKey, m.id);
				return { id: m.id, status };
			}),
		);
		for (const r of results) {
			if (r.status === "broken") notFound.push(r.id);
			if (r.status !== "unknown") {
				cacheableResults.push({ modelId: r.id, status: r.status });
			}
		}
	}

	await recordModelProbeResults(PROVIDER_OLLAMA, cacheableResults);

	if (notFound.length === 0) {
		_logger.info("Auto-probe: all checked Ollama models are accessible");
		return [];
	}

	// Auto-hide 403 models in config (provider-scoped).
	// Use updateConfig for atomic RMW to prevent concurrent probes from
	// clobbering each other's hidden_models.
	await updateConfig((cfg) => {
		const existingHidden = new Set(cfg.hidden_models ?? []);
		for (const id of notFound) existingHidden.add(`${PROVIDER_OLLAMA}/${id}`);
		return { hidden_models: Array.from(existingHidden) };
	});

	// Re-fetch and re-register so hidden models disappear immediately
	try {
		const fresh = await fetchAllModels(
			apiKey,
			loadProviderCache(PROVIDER_OLLAMA),
		);
		await saveProviderCache(PROVIDER_OLLAMA, fresh);
		applyModels(fresh);
	} catch {
		// If refresh fails, keep current models. The next refresh/probe will retry.
	}

	_logger.info(
		`Auto-probe: found ${notFound.length} broken Ollama models (auto-hidden)`,
	);
	return notFound;
}

const OLLAMA_PROVIDER_DEPS: OllamaProviderDeps = {
	fallbackModels: FALLBACK_MODELS,
	fetchModels: fetchAllModels,
	probeModels: runOllamaProbe,
};

export function createOllamaProvider(initialModels?: ProviderModelConfig[]) {
	return initialModels === undefined
		? createNativeOllamaProvider(OLLAMA_PROVIDER_DEPS)
		: createNativeOllamaProvider(OLLAMA_PROVIDER_DEPS, initialModels);
}

export default function ollamaProvider(pi: ExtensionAPI): Promise<void> {
	registerOllamaProvider(pi, OLLAMA_PROVIDER_DEPS);
	return Promise.resolve();
}

// =============================================================================
// Probe helper
// =============================================================================

/**
 * Probe a single Ollama model with a minimal chat request.
 * Returns "broken" only for deterministic 403s; network errors are unknown.
 */
async function probeOllamaModel(
	apiKey: string,
	modelId: string,
): Promise<"ok" | "broken" | "unknown"> {
	try {
		const response = await fetchWithTimeout(
			`${BASE_URL_OLLAMA}/chat/completions`,
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${apiKey}`,
					"Content-Type": "application/json",
					"User-Agent": "pi-free-providers",
				},
				body: JSON.stringify({
					model: modelId,
					messages: [{ role: "user", content: "hi" }],
					max_tokens: 1,
				}),
			},
			10000,
		);
		// 403 = access denied (model not provisioned)
		// 200/400/401/etc = at least accessible
		return response.status === 403 ? "broken" : "ok";
	} catch {
		// Network errors / timeouts are not "access denied"
		return "unknown";
	}
}
