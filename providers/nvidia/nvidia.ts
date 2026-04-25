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
import { applyHidden, getNvidiaApiKey, PROVIDER_NVIDIA } from "../../config.ts";
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
		headers: {
			"User-Agent": "pi-free-providers",
		},
		models: enhanceWithCI(initialModels),
	});

	// Registration complete - models registered silently (use LOG_LEVEL=info to see details)
}
