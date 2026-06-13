/**
 * Together AI Provider Extension
 *
 * Together AI provides fast inference on 200+ open-source models through an
 * OpenAI-compatible API. Known for Llama, DeepSeek, Qwen, Mixtral, and other
 * popular models at competitive per-token pricing.
 *
 * Free tier:
 *   - $1 one-time credit on signup (no credit card)
 *   - 60 RPM, 600 RPD (varies by model)
 *   - Sign up at https://api.together.ai/
 *
 * Paid: pay-per-token after credits exhaust
 *
 * NOTE: Together AI's /v1/models returns a plain array (not { data: [...] }),
 * uses per-million-token pricing (not per-token), and includes a "type" field
 * we use to filter to chat models only.
 *
 * Endpoint:
 *   Chat: https://api.together.xyz/v1/chat/completions
 *
 * Setup:
 *   1. Sign up at https://api.together.ai/
 *   2. Get API key from https://api.together.ai/settings/api-keys
 *   3. Set TOGETHER_AI_API_KEY env var (or add to ~/.pi/free.json)
 *
 * Usage:
 *   pi install git:github.com/apmantza/pi-free
 *   # Set TOGETHER_AI_API_KEY env var
 *   # Models appear in /model selector as "together/deepseek-ai/..."
 */

import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import { getTogetherApiKey, getTogetherShowPaid } from "../../config.ts";
import {
	BASE_URL_TOGETHER,
	DEFAULT_FETCH_TIMEOUT_MS,
	PROVIDER_TOGETHER,
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

const _logger = createLogger("together");

// =============================================================================
// Types
// =============================================================================

interface TogetherModel {
	id: string;
	display_name?: string;
	type?: string;
	context_length?: number;
	pricing?: {
		input?: number;
		output?: number;
		cached_input?: number;
	};
}

// =============================================================================
// Fetch
// =============================================================================

async function fetchTogetherModels(
	apiKey: string,
): Promise<ProviderModelConfig[]> {
	const response = await fetchWithRetry(
		`${BASE_URL_TOGETHER}/models`,
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
		throw new Error(
			`Together AI API error: ${response.status} ${response.statusText}`,
		);
	}

	// Together AI returns a plain array (not { data: [...] })
	const models = (await response.json()) as TogetherModel[];

	_logger.info(`[together] Fetched ${models.length} models`);

	const mapped = models
		.filter((m) => m.type === "chat" && m.id && !m.id.includes("embed"))
		.map((m): ProviderModelConfig => {
			const name = m.display_name || m.id.split("/").pop() || m.id;

			// Together AI pricing is per-MILLION tokens.
			// Divide by 1_000_000 to get per-token cost (Pi convention).
			const inputCost = (m.pricing?.input ?? 0) / 1_000_000;
			const outputCost = (m.pricing?.output ?? 0) / 1_000_000;
			const cacheReadCost = (m.pricing?.cached_input ?? 0) / 1_000_000;

			return {
				id: m.id,
				name,
				reasoning: isLikelyReasoningModel({ id: m.id, name }),
				input: ["text"],
				cost: {
					input: inputCost,
					output: outputCost,
					cacheRead: cacheReadCost,
					cacheWrite: 0,
				},
				contextWindow: m.context_length ?? 128_000,
				maxTokens: 16_384,
				compat: getProxyModelCompat({ id: m.id, name }),
				_pricingKnown: m.pricing !== undefined,
			} as ProviderModelConfig & { _pricingKnown?: boolean };
		});

	return await safeEnrichModelsWithModelsDev(mapped, {
		providerId: PROVIDER_TOGETHER,
	});
}

// =============================================================================
// Extension Entry Point
// =============================================================================

export default async function togetherProvider(pi: ExtensionAPI) {
	const apiKey = getTogetherApiKey();

	if (!apiKey) {
		_logger.info(
			"[together] Skipping — TOGETHER_AI_API_KEY not set. Sign up at https://api.together.ai/",
		);
		return;
	}

	// Fetch models
	const allModels = await fetchTogetherModels(apiKey);

	if (allModels.length === 0) {
		_logger.warn("[together] No chat models available");
		return;
	}

	// Together AI is a pay-per-token provider with $1 trial credit.
	// Use isFreeModel for consistent detection across all providers.
	const freeModels = allModels.filter((m) =>
		isFreeModel({ ...m, provider: PROVIDER_TOGETHER }, allModels),
	);
	const stored = { free: freeModels, all: allModels };

	_logger.info(
		`[together] ${allModels.length} chat models (${freeModels.length} free)`,
	);

	// Create re-register function
	const reRegister = createReRegister(pi, {
		providerId: PROVIDER_TOGETHER,
		baseUrl: BASE_URL_TOGETHER,
		apiKey,
	});

	// Register with global toggle
	registerWithGlobalToggle(PROVIDER_TOGETHER, stored, reRegister, true);

	// Setup provider with toggle command
	setupProvider(
		pi,
		{
			providerId: PROVIDER_TOGETHER,
			initialShowPaid: getTogetherShowPaid(),
			tosUrl: "https://api.together.ai/",
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

	// Initial registration — show all models (trial credit provider)
	reRegister(stored.all);

	// ── Probe support ──────────────────────────────────────────────
	const probe = createProviderProbe({
		providerId: PROVIDER_TOGETHER,
		probeModel: async (_apiKey: string, modelId: string) => {
			try {
				const response = await fetchWithTimeout(
					`${BASE_URL_TOGETHER}/chat/completions`,
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
	pi.registerCommand(`probe-${PROVIDER_TOGETHER}`, {
		description: "Test all Together AI models for availability",
		handler: async (_args, ctx) => {
			ctx.ui.notify(`Probing ${allModels.length} Together AI models…`, "info");
			const broken = await probe.run(apiKey, allModels, {
				onBroken: (ids) => {
					ctx.ui.notify(
						`Found ${ids.length} broken models (auto-hidden):\n${ids.join("\n")}`,
						"warning",
					);
				},
			});
			if (broken.length === 0) {
				ctx.ui.notify("All Together AI models are accessible ✅", "info");
			}
		},
	});

	// Lazy auto-probe on first session_start
	pi.on(
		"session_start",
		wrapSessionStartHandler(
			`${PROVIDER_TOGETHER}-auto-probe`,
			probe.autoProbeHandler(apiKey, freeModels),
		),
	);
}
