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
 * Set NVIDIA_SHOW_PAID=true to show paid-tier models (same key, uses credits).
 */

import type { ProviderModelConfig } from "@mariozechner/pi-coding-agent";
import {
	applyHidden,
	NVIDIA_SHOW_PAID,
	PROVIDER_NVIDIA,
} from "../../config.ts";
import {
	BASE_URL_NVIDIA,
	DEFAULT_FETCH_TIMEOUT_MS,
	NVIDIA_MIN_SIZE_B,
	URL_MODELS_DEV,
} from "../../constants.ts";
import type { ModelsDevProvider } from "../../lib/types.ts";
import { fetchWithRetry, isUsableModel } from "../../lib/util.ts";
import { createProvider } from "../../provider-factory.ts";

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
				// Embedding, speech-to-text, OCR, and image-gen models are excluded
				const modalities = m.modalities;
				if (modalities) {
					const output = modalities.output ?? [];
					const input = modalities.input ?? [];
					// Exclude models that don't output text (e.g., image generation)
					if (!output.includes("text")) return false;
					// Exclude models that don't accept text input (e.g., pure OCR, speech-to-text)
					if (!input.includes("text")) return false;
				}
				return true;
			})
			.filter((m) => {
				// All NVIDIA models are credit-based (no hard cost.input = 0 distinction).
				// Respect showPaid flag: without it, only expose models marked free.
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

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
	createReRegister,
	type StoredModels,
	setupProvider,
} from "../../provider-helper.ts";

// =============================================================================
// Extension Entry Point
// =============================================================================

export default async function (pi: ExtensionAPI) {
	// Track current mode (synced with config)
	let currentShowPaid = NVIDIA_SHOW_PAID;

	// Fetch initial models based on config
	let freeModels: ProviderModelConfig[] = [];
	let allModels: ProviderModelConfig[] = [];

	try {
		// Fetch free models initially
		freeModels = await fetchNvidiaModels(false);
		// Fetch all models for toggle (if paid mode enabled later)
		allModels = await fetchNvidiaModels(true);
	} catch (error) {
		console.error("[nvidia] Failed to fetch models at startup", error);
		return;
	}

	// Store both sets for toggle
	const stored: StoredModels = { free: freeModels, all: allModels };
	const initialModels = currentShowPaid ? allModels : freeModels;

	// Register provider with initial models
	pi.registerProvider(PROVIDER_NVIDIA, {
		baseUrl: BASE_URL_NVIDIA,
		apiKey: "NVIDIA_API_KEY",
		api: "openai-completions" as const,
		headers: {
			"User-Agent": "pi-free-providers",
		},
		models: initialModels,
	});

	// Create re-register function for toggle
	const reRegister = createReRegister(pi, {
		providerId: PROVIDER_NVIDIA,
		baseUrl: BASE_URL_NVIDIA,
		apiKey: "NVIDIA_API_KEY",
	});

	// Wire up toggle command and events
	setupProvider(pi, {
		providerId: PROVIDER_NVIDIA,
		initialShowPaid: NVIDIA_SHOW_PAID,
		reRegister: (models) => {
			// Update showPaid state based on which model set is being registered
			currentShowPaid = models === stored.all;
			reRegister(models);
		},
	}, stored);
}
