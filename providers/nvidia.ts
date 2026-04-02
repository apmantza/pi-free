/**
 * NVIDIA NIM Provider Extension
 *
 * Provides access to NVIDIA-hosted large models via integrate.api.nvidia.com.
 * All models use NVIDIA's free credit system — requires NVIDIA_API_KEY.
 * Get a free key at: https://build.nvidia.com
 *
 * Small models (< 70B), embedding, speech, OCR, and image-gen models are
 * filtered out to keep the list focused on useful chat/coding models.
 *
 * Set NVIDIA_SHOW_PAID=true to show paid-tier models (same key, uses credits).
 */

import type { ProviderModelConfig } from "@mariozechner/pi-coding-agent";
import { applyHidden, NVIDIA_SHOW_PAID, PROVIDER_NVIDIA } from "../config.ts";
import {
	BASE_URL_NVIDIA,
	DEFAULT_FETCH_TIMEOUT_MS,
	NVIDIA_MIN_SIZE_B,
	URL_MODELS_DEV,
} from "../constants.ts";
import type { ModelsDevProvider } from "../lib/types.ts";
import { fetchWithRetry, isUsableModel } from "../lib/util.ts";
import { createProvider } from "../provider-factory.ts";

// =============================================================================
// Fetch + map
// =============================================================================

async function fetchNvidiaModels(): Promise<ProviderModelConfig[]> {
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
				// All NVIDIA models are credit-based (no hard cost.input = 0 distinction).
				// Respect NVIDIA_SHOW_PAID: without the flag, only expose models marked free.
				if (!NVIDIA_SHOW_PAID && (m.cost?.input ?? 0) > 0) return false;
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

export default function (pi: Parameters<typeof createProvider>[0]) {
	return createProvider(pi, {
		providerId: PROVIDER_NVIDIA,
		baseUrl: BASE_URL_NVIDIA,
		apiKeyEnvVar: "NVIDIA_API_KEY",
		apiKeyConfigKey: "nvidia_api_key",
		// Note: NVIDIA_SHOW_PAID filtering is handled inside fetchNvidiaModels
		fetchModels: fetchNvidiaModels,
	});
}
