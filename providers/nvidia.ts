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

import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@mariozechner/pi-coding-agent";
import {
	applyHidden,
	NVIDIA_API_KEY as CONFIG_API_KEY,
	NVIDIA_SHOW_PAID,
	PROVIDER_NVIDIA,
} from "../config.ts";
import {
	BASE_URL_NVIDIA,
	DEFAULT_FETCH_TIMEOUT_MS,
	NVIDIA_MIN_SIZE_B,
	URL_MODELS_DEV,
} from "../constants.ts";
import { type StoredModels, setupProvider } from "../provider-helper.ts";
import type { ModelsDevProvider } from "../types.ts";
import { fetchWithRetry, isUsableModel, logWarning } from "../util.ts";

// =============================================================================
// Fetch + map
// =============================================================================

async function fetchNvidiaModels(): Promise<ProviderModelConfig[]> {
	const response = await fetchWithRetry(URL_MODELS_DEV, {
		headers: { "User-Agent": "pi-free-providers" },
		timeoutMs: DEFAULT_FETCH_TIMEOUT_MS,
	});

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
				// Respect NVIDIA_SHOW_PAID: without the flag, only expose models marked free (cost 0).
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
						cacheRead: m.cost?.cache_read,
						cacheWrite: m.cost?.cache_write,
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
	const apiKey = CONFIG_API_KEY;

	// Inject into process.env so Pi's apiKey lookup finds it even when loaded from ~/.pi/free.json.
	if (apiKey) process.env.NVIDIA_API_KEY = apiKey;

	if (!apiKey) {
		console.warn(
			"[nvidia] No API key found — set NVIDIA_API_KEY or add nvidia_api_key to ~/.pi/free.json. Free key at https://build.nvidia.com",
		);
		return;
	}

	let models: ProviderModelConfig[] = [];
	try {
		models = await fetchNvidiaModels();
	} catch (error) {
		logWarning("nvidia", "Failed to fetch models", error);
	}

	if (models.length === 0) return;

	// Shared model storage (single set — NVIDIA has no free/all split)
	const stored: StoredModels = { free: models, all: models };

	pi.registerProvider(PROVIDER_NVIDIA, {
		baseUrl: BASE_URL_NVIDIA,
		apiKey: "NVIDIA_API_KEY",
		api: "openai-completions" as const,
		headers: { "User-Agent": "pi-free-providers" },
		models,
	});

	// Wire up shared boilerplate (commands, model_select, turn_end)
	setupProvider(
		pi,
		{
			providerId: PROVIDER_NVIDIA,
			reRegister: (m) => {
				stored.free = m;
				stored.all = m;
				pi.registerProvider(PROVIDER_NVIDIA, {
					baseUrl: BASE_URL_NVIDIA,
					apiKey: "NVIDIA_API_KEY",
					api: "openai-completions" as const,
					headers: { "User-Agent": "pi-free-providers" },
					models: m,
				});
			},
		},
		stored,
	);

	pi.on("session_start", async (_event, ctx) => {
		const theme = ctx.ui.theme;
		ctx.ui.setStatus(
			"nvidia-status",
			theme.fg("accent", `⚡ NVIDIA (${models.length} models)`),
		);
	});
}
