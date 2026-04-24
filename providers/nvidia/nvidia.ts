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
	getNvidiaShowPaid,
	PROVIDER_NVIDIA,
} from "../../config.ts";
import {
	BASE_URL_NVIDIA,
	DEFAULT_FETCH_TIMEOUT_MS,
	NVIDIA_MIN_SIZE_B,
	URL_MODELS_DEV,
} from "../../constants.ts";
import { registerWithGlobalToggle } from "../../lib/registry.ts";
import type { ModelsDevProvider } from "../../lib/types.ts";
import { fetchWithRetry, isUsableModel } from "../../lib/util.ts";
import { createReRegister, enhanceWithCI } from "../../provider-helper.ts";

// =============================================================================
// Fetch + map
// =============================================================================

async function fetchNvidiaModels(
	showPaid = false,
): Promise<ProviderModelConfig[]> {
	const response = await fetchWithRetry(
		URL_MODELS_DEV,
		{
			headers: { "User-Agent": "pi-free-providers" },
		},
		3,
		1000,
		DEFAULT_FETCH_TIMEOUT_MS,
	);

	if (!response.ok) {
		throw new Error(
			`Failed to fetch models.dev: ${response.status} ${response.statusText}`,
		);
	}

	const json = (await response.json()) as Record<string, ModelsDevProvider>;
	const provider = Object.values(json).find((p) => p?.id === "nvidia");
	if (!provider?.models)
		throw new Error("nvidia provider not found in models.dev");

	const result = applyHidden(
		Object.values(provider.models)
			.filter((m) => isUsableModel(m.id, NVIDIA_MIN_SIZE_B))
			.filter((m) => {
				// Filter non-chat models by modalities
				const modalities = m.modalities;
				if (modalities) {
					const output = modalities.output ?? [];
					const input = modalities.input ?? [];
					if (!output.includes("text")) return false;
					if (!input.includes("text")) return false;
				}
				return true;
			})
			.filter((m) => {
				// Filter by cost - free models have input cost of 0
				if (!showPaid && (m.cost?.input ?? 0) > 0) return false;
				return true;
			})
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
	// Fetch both free and all models
	let freeModels: ProviderModelConfig[] = [];
	let allModels: ProviderModelConfig[] = [];

	try {
		freeModels = await fetchNvidiaModels(false);
		allModels = await fetchNvidiaModels(true);
	} catch (error) {
		console.error("[nvidia] Failed to fetch models at startup", error);
		return;
	}

	// Store both sets for global toggle
	const stored = { free: freeModels, all: allModels };
	const apiKey = getNvidiaApiKey();
	const hasKey = !!(apiKey || process.env.NVIDIA_API_KEY);

	// Create re-register function
	const reRegister = createReRegister(pi, {
		providerId: PROVIDER_NVIDIA,
		baseUrl: BASE_URL_NVIDIA,
		apiKey: apiKey || "NVIDIA_API_KEY",
	});

	// Register with global toggle system
	registerWithGlobalToggle(PROVIDER_NVIDIA, stored, reRegister, hasKey);

	// Register initial models (global toggle will apply filter if needed)
	const initialModels = getNvidiaShowPaid() ? allModels : freeModels;
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
