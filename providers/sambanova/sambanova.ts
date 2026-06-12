/**
 * SambaNova Provider Extension
 *
 * SambaNova Cloud offers fast inference on custom RDU hardware with an
 * OpenAI-compatible API. Known for running Llama 3.3 70B faster than
 * competitors.
 *
 * Free tier (no credit card, no payment method):
 *   - Production models: 20-480 RPM, 400-9600 RPD
 *   - Preview models: 10-150 RPM, 200-3000 RPD
 *   - Forever free, no token pricing
 *
 * Developer tier (add payment method):
 *   - Higher rate limits, same models
 *
 * Endpoint:
 *   Chat: https://api.sambanova.ai/v1/chat/completions
 *
 * Setup:
 *   1. Sign up at https://cloud.sambanova.ai/
 *   2. Get API key from https://cloud.sambanova.ai/apis
 *   3. Set SAMBANOVA_API_KEY env var (or add to ~/.pi/free.json)
 *
 * Usage:
 *   pi install git:github.com/apmantza/pi-free
 *   # Set SAMBANOVA_API_KEY env var
 *   # Models appear in /model selector as "sambanova/Meta-Llama-3.3-70B-Instruct"
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getSambanovaApiKey, getSambanovaShowPaid } from "../../config.ts";
import { BASE_URL_SAMBANOVA, PROVIDER_SAMBANOVA } from "../../constants.ts";
import { createLogger } from "../../lib/logger.ts";
import { createProviderProbe } from "../../lib/provider-probe.ts";
import { isFreeModel, registerWithGlobalToggle } from "../../lib/registry.ts";
import { wrapSessionStartHandler } from "../../lib/session-start-metrics.ts";
import {
	fetchOpenAICompatibleModels,
	fetchWithTimeout,
} from "../../lib/util.ts";
import { createReRegister, setupProvider } from "../../provider-helper.ts";

const _logger = createLogger("sambanova");

// =============================================================================
// Extension Entry Point
// =============================================================================

export default async function sambanovaProvider(pi: ExtensionAPI) {
	const apiKey = getSambanovaApiKey();

	if (!apiKey) {
		_logger.info(
			"[sambanova] Skipping — SAMBANOVA_API_KEY not set. Sign up at https://cloud.sambanova.ai/",
		);
		return;
	}

	// Fetch models via shared OpenAI-compatible helper
	const allModels = await fetchOpenAICompatibleModels(
		"sambanova",
		BASE_URL_SAMBANOVA,
		apiKey,
		{ maxTokens: 8_192 },
	);

	if (allModels.length === 0) {
		_logger.warn("[sambanova] No models available");
		return;
	}

	// All SambaNova models are free-tier (no payment method required).
	// Rate limits are lower on free tier but all models are accessible.
	// Override _pricingKnown so isFreeModel trusts the zero costs.
	for (const m of allModels) {
		(m as unknown as { _pricingKnown?: boolean })._pricingKnown = true;
	}
	const freeModels = allModels.filter((m) =>
		isFreeModel({ ...m, provider: PROVIDER_SAMBANOVA }, allModels),
	);
	const stored = { free: freeModels, all: allModels };

	_logger.info(
		`[sambanova] Registered ${allModels.length} models (all free tier)`,
	);

	// Create re-register function
	const reRegister = createReRegister(pi, {
		providerId: PROVIDER_SAMBANOVA,
		baseUrl: BASE_URL_SAMBANOVA,
		apiKey,
	});

	// Register with global toggle
	registerWithGlobalToggle(PROVIDER_SAMBANOVA, stored, reRegister, true);

	// Setup provider with toggle command
	setupProvider(
		pi,
		{
			providerId: PROVIDER_SAMBANOVA,
			initialShowPaid: getSambanovaShowPaid(),
			tosUrl: "https://sambanova.ai/terms",
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
	const showPaid = getSambanovaShowPaid();
	const initialModels =
		showPaid && stored.all.length > 0 ? stored.all : freeModels;
	reRegister(initialModels);

	// ── Probe support ──────────────────────────────────────────────
	const probe = createProviderProbe({
		providerId: PROVIDER_SAMBANOVA,
		probeModel: async (_apiKey: string, modelId: string) => {
			try {
				const response = await fetchWithTimeout(
					`${BASE_URL_SAMBANOVA}/chat/completions`,
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
				// SambaNova may return 404 for preview/unavailable models
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
	pi.registerCommand(`probe-${PROVIDER_SAMBANOVA}`, {
		description: "Test all SambaNova models for availability",
		handler: async (_args, ctx) => {
			ctx.ui.notify(`Probing ${allModels.length} SambaNova models…`, "info");
			const broken = await probe.run(apiKey, allModels, {
				onBroken: (ids) => {
					ctx.ui.notify(
						`Found ${ids.length} broken models (auto-hidden):\n${ids.join("\n")}`,
						"warning",
					);
				},
			});
			if (broken.length === 0) {
				ctx.ui.notify("All SambaNova models are accessible ✅", "info");
			}
		},
	});

	// Lazy auto-probe on first session_start
	pi.on(
		"session_start",
		wrapSessionStartHandler(
			`${PROVIDER_SAMBANOVA}-auto-probe`,
			probe.autoProbeHandler(apiKey, freeModels),
		),
	);
}
