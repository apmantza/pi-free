/**
 * NVIDIA NIM Provider Extension
 *
 * Provides access to NVIDIA-hosted large models via integrate.api.nvidia.com.
 * All models use NVIDIA's free credit system — requires NVIDIA_API_KEY.
 * Get a free key at: https://build.nvidia.com
 *
 * Small models (< 70B) are filtered out to keep the list focused on useful
 * chat/coding models. Non-chat models (embedding, speech-to-text, OCR,
 * image-gen) are filtered by their modalities (output must be ["text"],
 * input must include "text").
 *
 * Responds to global free-only filter for free/paid model filtering.
 */

import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@mariozechner/pi-coding-agent";
import {
	applyHidden,
	getNvidiaApiKey,
	loadConfigFile,
	PROVIDER_NVIDIA,
	saveConfig,
} from "../../config.ts";
import {
	BASE_URL_NVIDIA,
	DEFAULT_FETCH_TIMEOUT_MS,
	NVIDIA_MIN_SIZE_B,
	URL_MODELS_DEV,
} from "../../constants.ts";
import { registerWithGlobalToggle } from "../../lib/registry.ts";
import type { ModelsDevModel, ModelsDevProvider } from "../../lib/types.ts";
import { fetchWithRetry, isUsableModel } from "../../lib/util.ts";
import { createReRegister, enhanceWithCI } from "../../provider-helper.ts";

// =============================================================================
// Non-chat model heuristics for models not in models.dev
// =============================================================================

const NVIDIA_NON_CHAT_PATTERNS: RegExp[] = [
	/embed(?!.*instruct)/i,
	/whisper/i,
	/reward/i,
	/ocr(?!.*instruct)/i,
	/safety-guard|content-safety|nemoguard/i,
	/retriever-parse|nemotron-parse(?!.*instruct)/i,
	/detector/i,
	/deplot/i,
	/nvclip/i,
	/vila$/i,
	/neva(?!.*instruct)/i,
	/translate/i,
	/cosmos-reason/i,
	/kosmos/i,
	/bge-/i,
	/arctic-embed/i,
	/gliner/i,
	/nv-embed/i,
	/embedqa/i,
	/embedcode/i,
];

/**
 * Models that appear in NVIDIA's /v1/models but return 404 "Function not found"
 * on /v1/chat/completions. These are listed but not actually provisioned for
 * hosted chat inference. Community-reported; add new IDs as they surface.
 *
 * Users can also hide individual models via hidden_models in ~/.pi/free.json.
 */
const NVIDIA_KNOWN_404_MODELS: ReadonlySet<string> = new Set([
	"01-ai/yi-large",
	"adept/fuyu-8b",
	"ai21labs/jamba-1.5-large-instruct",
	"aisingapore/sea-lion-7b-instruct",
	"baai/bge-m3",
	"bigcode/starcoder2-15b",
	"databricks/dbrx-instruct",
	"deepseek-ai/deepseek-coder-6.7b-instruct",
	"google/codegemma-1.1-7b",
	"google/codegemma-7b",
	"google/deplot",
	"google/gemma-2b",
	"google/recurrentgemma-2b",
	"ibm/granite-3.0-3b-a800m-instruct",
	"ibm/granite-3.0-8b-instruct",
	"ibm/granite-34b-code-instruct",
	"ibm/granite-8b-code-instruct",
	"meta/codellama-70b",
	"meta/llama2-70b",
	"microsoft/kosmos-2",
	"microsoft/phi-3-vision-128k-instruct",
	"microsoft/phi-3.5-moe-instruct",
	"mistralai/codestral-22b-instruct-v0.1",
	"mistralai/mistral-7b-instruct-v0.3",
	"mistralai/mistral-large",
	"mistralai/mistral-large-2-instruct",
	"mistralai/mixtral-8x22b-v0.1",
	"nv-mistralai/mistral-nemo-12b-instruct",
	"nvidia/cosmos-reason2-8b",
	"nvidia/embed-qa-4",
	"nvidia/llama-3.1-nemotron-51b-instruct",
	"nvidia/llama-3.1-nemotron-70b-instruct",
	"nvidia/llama-3.1-nemotron-ultra-253b-v1",
	"nvidia/llama-3.2-nemoretriever-1b-vlm-embed-v1",
	"nvidia/llama-3.2-nemoretriever-300m-embed-v1",
	"nvidia/llama-3.2-nv-embedqa-1b-v1",
	"nvidia/llama-3.2-nv-embedqa-1b-v2",
	"nvidia/llama-nemotron-embed-1b-v2",
	"nvidia/llama-nemotron-embed-vl-1b-v2",
	"nvidia/llama3-chatqa-1.5-70b",
	"nvidia/mistral-nemo-minitron-8b-8k-instruct",
	"nvidia/nemotron-4-340b-instruct",
	"nvidia/nemotron-4-340b-reward",
	"nvidia/nemotron-nano-3-30b-a3b",
	"nvidia/neva-22b",
	"nvidia/nv-embed-v1",
	"nvidia/nv-embedcode-7b-v1",
	"nvidia/nv-embedqa-e5-v5",
	"nvidia/nv-embedqa-mistral-7b-v2",
	"nvidia/nvclip",
	"nvidia/riva-translate-4b-instruct",
	"snowflake/arctic-embed-l",
	"writer/palmyra-creative-122b",
	"writer/palmyra-fin-70b-32k",
	"writer/palmyra-med-70b",
	"writer/palmyra-med-70b-32k",
	"zyphra/zamba2-7b-instruct",
]);

/**
 * Infer model metadata from a NVIDIA model ID for models not present in
 * models.dev. Returns null if the ID matches known non-chat patterns.
 */
function inferModelFromId(id: string): ModelsDevModel | null {
	for (const pattern of NVIDIA_NON_CHAT_PATTERNS) {
		if (pattern.test(id)) return null;
	}

	const name = id
		.split("/")
		.pop()!
		.replace(/-/g, " ")
		.replace(/\b\w/g, (c) => c.toUpperCase())
		.replace(/\b(\d+(?:\.\d+)?)b\b/gi, "$1B");

	const hasVision = /vision|multimodal|vl/i.test(id);
	const hasReasoning = /reason|r1|thinking/i.test(id);

	return {
		id,
		name,
		reasoning: hasReasoning,
		limit: { context: 128_000, output: 4096 },
		modalities: {
			input: hasVision ? ["text", "image"] : ["text"],
			output: ["text"],
		},
		cost: { input: 0, output: 0 },
	};
}

// =============================================================================
// Fetch + map
// =============================================================================

async function fetchNvidiaModels(
	apiKey?: string,
): Promise<ProviderModelConfig[]> {
	// ── 1. Query NVIDIA's actual API (source of truth) ─────────────────
	let apiModelIds = new Set<string>();
	if (apiKey) {
		try {
			const response = await fetchWithRetry(
				`${BASE_URL_NVIDIA}/models`,
				{
					headers: {
						Authorization: `Bearer ${apiKey}`,
						"User-Agent": "pi-free-providers",
					},
				},
				3,
				1000,
				DEFAULT_FETCH_TIMEOUT_MS,
			);
			if (response.ok) {
				const json = (await response.json()) as {
					data?: Array<{ id: string }>;
				};
				if (json.data) {
					apiModelIds = new Set(json.data.map((m) => m.id));
				}
			}
		} catch (error) {
			console.error("[nvidia] Failed to fetch models from NVIDIA API", error);
		}
	}

	// ── 2. Fetch models.dev for rich metadata (cost, limits, etc.) ─────
	const devModels = new Map<string, ModelsDevModel>();
	try {
		const response = await fetchWithRetry(
			URL_MODELS_DEV,
			{
				headers: { "User-Agent": "pi-free-providers" },
			},
			3,
			1000,
			DEFAULT_FETCH_TIMEOUT_MS,
		);
		if (response.ok) {
			const json = (await response.json()) as Record<string, ModelsDevProvider>;
			const provider = Object.values(json).find((p) => p?.id === "nvidia");
			if (provider?.models) {
				for (const m of Object.values(provider.models)) {
					devModels.set(m.id, m);
				}
			}
		}
	} catch (error) {
		console.error("[nvidia] Failed to fetch models.dev", error);
	}

	// ── 3. Build unified list (NVIDIA API wins; fallback to models.dev) ─
	const modelIds =
		apiModelIds.size > 0 ? [...apiModelIds] : [...devModels.keys()];

	const result = applyHidden(
		modelIds
			.map((id) => {
				const dev = devModels.get(id);
				if (dev) return dev;
				return inferModelFromId(id);
			})
			.filter((m): m is ModelsDevModel => m !== null)
			.filter((m) => isUsableModel(m.id, NVIDIA_MIN_SIZE_B))
			.filter((m) => {
				const modalities = m.modalities;
				if (modalities) {
					const output = modalities.output ?? [];
					const input = modalities.input ?? [];
					if (!output.includes("text")) return false;
					if (!input.includes("text")) return false;
				}
				return true;
			})
			// Filter out known 404 models (listed but not provisioned for chat)
			.filter((m) => {
				if (NVIDIA_KNOWN_404_MODELS.has(m.id)) {
					console.warn(`[nvidia] Skipping known 404 model: ${m.id}`);
					return false;
				}
				return true;
			})
			// NVIDIA is freemium — all models are usable with free credits.
			// No cost filtering applied.
			.map(
				(m): ProviderModelConfig => ({
					id: m.id,
					name: m.name,
					reasoning: m.reasoning,
					input: m.modalities?.input?.includes("image")
						? ["text", "image"]
						: ["text"],
					cost: {
						input: m.cost?.input ?? 0,
						output: m.cost?.output ?? 0,
						cacheRead: m.cost?.cache_read ?? 0,
						cacheWrite: m.cost?.cache_write ?? 0,
					},
					contextWindow: m.limit.context,
					maxTokens: m.limit.output,
				}),
			),
	);

	return result;
}

// =============================================================================
// Extension Entry Point
// =============================================================================

/**
 * Probe a single NVIDIA model with a minimal chat request.
 * Returns true if the model is routable (not 404), false if it 404s.
 */
async function probeNvidiaModel(
	apiKey: string,
	modelId: string,
): Promise<boolean> {
	try {
		const response = await fetch(`${BASE_URL_NVIDIA}/chat/completions`, {
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
		});
		// 404 = function not found (model not provisioned)
		// 200/400/401/etc = at least routable
		return response.status !== 404;
	} catch {
		return true; // Network errors are not "model not found"
	}
}

export default async function (pi: ExtensionAPI) {
	const apiKey = getNvidiaApiKey();
	const hasKey = !!apiKey;

	let allModels: ProviderModelConfig[] = [];

	try {
		allModels = await fetchNvidiaModels(apiKey);
	} catch (error) {
		console.error("[nvidia] Failed to fetch models at startup", error);
		return;
	}

	// Store both sets for global toggle (same list — NVIDIA is freemium)
	const stored = { free: allModels, all: allModels };

	// Create re-register function
	const reRegister = createReRegister(pi, {
		providerId: PROVIDER_NVIDIA,
		baseUrl: BASE_URL_NVIDIA,
		apiKey: apiKey || "NVIDIA_API_KEY",
	});

	// Register with global toggle system
	registerWithGlobalToggle(PROVIDER_NVIDIA, stored, reRegister, hasKey);

	// Register initial models (global toggle will apply filter if needed)
	const initialModels = allModels;
	pi.registerProvider(PROVIDER_NVIDIA, {
		baseUrl: BASE_URL_NVIDIA,
		apiKey: apiKey || "NVIDIA_API_KEY",
		api: "openai-completions" as const,
		authHeader: true,
		headers: {
			"User-Agent": "pi-free-providers",
		},
		models: enhanceWithCI(initialModels),
	});

	// ── Probe command: test all registered models for 404s ─────────────
	pi.registerCommand("probe-nvidia", {
		description: "Test all NVIDIA models for 404 'Function not found' errors",
		handler: async (_args, ctx) => {
			if (!apiKey) {
				ctx.ui.notify("NVIDIA_API_KEY not set", "error");
				return;
			}

			const modelsToTest = allModels;
			ctx.ui.notify(`Probing ${modelsToTest.length} NVIDIA models…`, "info");

			const notFound: string[] = [];
			const batchSize = 5;

			for (let i = 0; i < modelsToTest.length; i += batchSize) {
				const batch = modelsToTest.slice(i, i + batchSize);
				const results = await Promise.all(
					batch.map(async (m) => {
						const ok = await probeNvidiaModel(apiKey, m.id);
						return { id: m.id, ok };
					}),
				);
				for (const r of results) {
					if (!r.ok) notFound.push(r.id);
				}
			}

			if (notFound.length === 0) {
				ctx.ui.notify("All NVIDIA models are routable ✅", "info");
				return;
			}

			// Auto-hide 404 models in config
			const config = loadConfigFile();
			const existingHidden = new Set(config.hidden_models ?? []);
			for (const id of notFound) existingHidden.add(id);
			saveConfig({ hidden_models: Array.from(existingHidden) });

			// Re-register so hidden models disappear immediately
			const filtered = await fetchNvidiaModels(apiKey);
			stored.free = filtered;
			stored.all = filtered;
			reRegister(filtered);

			ctx.ui.notify(
				`Found ${notFound.length} broken models (auto-hidden):\n${notFound.join("\n")}`,
				"warning",
			);
		},
	});

	// Registration complete - models registered silently (use LOG_LEVEL=info to see details)
}
