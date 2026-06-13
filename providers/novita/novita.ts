/**
 * Novita AI Provider Extension
 *
 * Novita AI deploys 100+ open-source models with an OpenAI-compatible API.
 * Known for competitive pricing, globally distributed GPU infrastructure,
 * and support for chat, vision, and Anthropic-compatible endpoints.
 *
 * API: https://api.novita.ai/openai/v1
 * Models: /v1/models returns non-standard pricing fields (input_token_price_per_m,
 * output_token_price_per_m) plus rich metadata (context_size, max_output_tokens,
 * features for reasoning, input_modalities for vision).
 *
 * Setup:
 *   1. Sign up at https://novita.ai
 *   2. Get API key from dashboard
 *   3. Set NOVITA_API_KEY env var or add to ~/.pi/free.json
 *
 * Usage:
 *   pi install git:github.com/apmantza/pi-free
 *   # Set NOVITA_API_KEY env var
 *   # Models appear in /model selector
 */

import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import { getNovitaApiKey, getNovitaShowPaid } from "../../config.ts";
import {
	BASE_URL_NOVITA,
	DEFAULT_FETCH_TIMEOUT_MS,
	PROVIDER_NOVITA,
} from "../../constants.ts";
import { createLogger } from "../../lib/logger.ts";
import { safeEnrichModelsWithModelsDev } from "../../lib/model-metadata.ts";
import {
	getProxyModelCompat,
	isLikelyReasoningModel,
} from "../../lib/provider-compat.ts";
import { createProviderProbe } from "../../lib/provider-probe.ts";
import { isFreeModel, registerWithGlobalToggle } from "../../lib/registry.ts";
import { wrapSessionStartHandler } from "../../lib/session-start-metrics.ts";
import { fetchWithRetry, fetchWithTimeout } from "../../lib/util.ts";
import { createReRegister, setupProvider } from "../../provider-helper.ts";

const _logger = createLogger("novita");

// =============================================================================
// Types
// =============================================================================

interface NovitaModel {
	id: string;
	display_name?: string;
	description?: string;
	input_token_price_per_m?: number;
	output_token_price_per_m?: number;
	context_size?: number;
	max_output_tokens?: number;
	features?: string[];
	input_modalities?: string[];
	output_modalities?: string[];
	model_type?: string;
	endpoints?: string[];
	status?: number;
}

// =============================================================================
// Fetch
// =============================================================================

async function fetchNovitaModels(
	apiKey: string,
): Promise<ProviderModelConfig[]> {
	_logger.info("[novita] Fetching models from Novita API...");

	try {
		const response = await fetchWithRetry(
			`${BASE_URL_NOVITA}/models`,
			{
				headers: {
					Authorization: `Bearer ${apiKey}`,
					"Content-Type": "application/json",
				},
			},
			3,
			1000,
			DEFAULT_FETCH_TIMEOUT_MS,
		);

		if (!response.ok) {
			throw new Error(`Novita API error: ${response.status}`);
		}

		const json = (await response.json()) as { data?: NovitaModel[] };
		const models = (json.data ?? []).filter(
			(m) => m.status === 1 && m.model_type === "chat",
		);

		_logger.info(`[novita] Fetched ${models.length} models`);

		const mapped = models.map((m): ProviderModelConfig => {
			const name = m.display_name || m.id.split("/").pop() || m.id;
			const reasoning =
				(m.features ?? []).includes("reasoning") ||
				isLikelyReasoningModel({ id: m.id, name });
			const hasVision = m.input_modalities?.includes("image") ?? false;

			// Novita pricing is per-MILLION tokens. Divide for per-token (Pi convention).
			const inputCost = (m.input_token_price_per_m ?? 0) / 1_000_000;
			const outputCost = (m.output_token_price_per_m ?? 0) / 1_000_000;
			const hasPricing =
				m.input_token_price_per_m !== undefined ||
				m.output_token_price_per_m !== undefined;

			return {
				id: m.id,
				name,
				reasoning,
				input: hasVision ? ["text", "image"] : ["text"],
				cost: {
					input: inputCost,
					output: outputCost,
					cacheRead: 0,
					cacheWrite: 0,
				},
				contextWindow: m.context_size ?? 128_000,
				maxTokens: m.max_output_tokens ?? 16_384,
				compat: getProxyModelCompat({ id: m.id, name }),
				_pricingKnown: hasPricing,
			} as ProviderModelConfig & { _pricingKnown?: boolean };
		});

		return await safeEnrichModelsWithModelsDev(mapped, {
			providerId: PROVIDER_NOVITA,
		});
	} catch (error) {
		_logger.error("[novita] Failed to fetch models:", {
			error: error instanceof Error ? error.message : String(error),
		});
		return [];
	}
}

// =============================================================================
// Extension Entry Point
// =============================================================================

export default async function novitaProvider(pi: ExtensionAPI) {
	const apiKey = getNovitaApiKey();

	if (!apiKey) {
		_logger.info(
			"[novita] Skipping — NOVITA_API_KEY not set. Sign up at https://novita.ai/",
		);
		return;
	}

	// Fetch models
	const allModels = await fetchNovitaModels(apiKey);

	if (allModels.length === 0) {
		_logger.warn("[novita] No chat models available");
		return;
	}

	// Use isFreeModel with allModels for proper detection
	// Novita returns pricing for all models → _pricingKnown=true → Route A OR logic
	const freeModels = allModels.filter((m) =>
		isFreeModel({ ...m, provider: PROVIDER_NOVITA }, allModels),
	);

	const stored = { free: freeModels, all: allModels };

	_logger.info(
		`[novita] Registered ${allModels.length} models (${freeModels.length} free)`,
	);

	// Create re-register function
	const reRegister = createReRegister(pi, {
		providerId: PROVIDER_NOVITA,
		baseUrl: BASE_URL_NOVITA,
		apiKey,
	});

	// Register with global toggle
	registerWithGlobalToggle(PROVIDER_NOVITA, stored, reRegister, true);

	// Setup provider with toggle command
	setupProvider(
		pi,
		{
			providerId: PROVIDER_NOVITA,
			initialShowPaid: getNovitaShowPaid(),
			tosUrl: "https://novita.ai/terms",
			reRegister: (models, _stored) => {
				if (_stored) {
					stored.free = _stored.free;
					stored.all = _stored.all;
				}
				reRegister(models);
			},
		},
		stored,
	);

	// Initial registration — respect persisted toggle state
	const showPaid = getNovitaShowPaid();
	const initialModels =
		showPaid && stored.all.length > 0 ? stored.all : freeModels;
	reRegister(initialModels);

	// ── Probe support ──────────────────────────────────────────────
	const probe = createProviderProbe({
		providerId: PROVIDER_NOVITA,
		probeModel: async (_apiKey: string, modelId: string) => {
			try {
				const response = await fetchWithTimeout(
					`${BASE_URL_NOVITA}/chat/completions`,
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
					10_000,
				);
				if (response.status === 404 || response.status >= 500) return "broken";
				if (response.status === 429) return "ok";
				if (response.ok) return "ok";
				return "ok";
			} catch {
				return "unknown";
			}
		},
	});

	// Probe command
	pi.registerCommand(`probe-${PROVIDER_NOVITA}`, {
		description: "Test all Novita AI models for availability",
		handler: async (_args, ctx) => {
			ctx.ui.notify(`Probing ${allModels.length} Novita AI models…`, "info");
			const broken = await probe.run(apiKey, allModels, {
				onBroken: (ids) => {
					ctx.ui.notify(
						`Found ${ids.length} broken models (auto-hidden):\n${ids.join("\n")}`,
						"warning",
					);
				},
			});
			if (broken.length === 0) {
				ctx.ui.notify("All Novita AI models are accessible ✅", "info");
			}
		},
	});

	// Lazy auto-probe on first session_start
	pi.on(
		"session_start",
		wrapSessionStartHandler(
			`${PROVIDER_NOVITA}-auto-probe`,
			probe.autoProbeHandler(apiKey, freeModels),
		),
	);
}
