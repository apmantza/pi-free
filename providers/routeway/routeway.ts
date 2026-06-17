/**
 * Routeway AI Provider Extension
 *
 * Routeway exposes an OpenAI-compatible chat completions API with a model
 * catalog that includes free models marked by a `:free` suffix and zero token
 * pricing.
 *
 * API: https://api.routeway.ai/v1
 * Models: /v1/models
 * Docs: https://docs.routeway.ai
 *
 * Setup:
 *   ROUTEWAY_API_KEY=sk-...
 *   # or add routeway_api_key to ~/.pi/free.json
 */

import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import {
	getRoutewayApiKey,
	getRoutewayShowPaid,
	loadConfigFile,
	saveConfig,
} from "../../config.ts";
import {
	BASE_URL_ROUTEWAY,
	DEFAULT_FETCH_TIMEOUT_MS,
	PROVIDER_ROUTEWAY,
} from "../../constants.ts";
import { applyHidden } from "../../config.ts";
import { createLogger } from "../../lib/logger.ts";
import { safeEnrichModelsWithModelsDev } from "../../lib/model-metadata.ts";
import {
	getProxyModelCompat,
	isLikelyReasoningModel,
} from "../../lib/provider-compat.ts";
import {
	areAllModelsFresh,
	getModelsDueForProbe,
	recordModelProbeResults,
} from "../../lib/probe-cache.ts";
import { isFreeModel, registerWithGlobalToggle } from "../../lib/registry.ts";
import { wrapSessionStartHandler } from "../../lib/session-start-metrics.ts";
import { cleanModelName, fetchWithRetry } from "../../lib/util.ts";
import { fetchWithTimeout } from "../../lib/util.ts";
import { createReRegister, setupProvider } from "../../provider-helper.ts";

const _logger = createLogger("routeway");

interface RoutewayPrice {
	unit?: string;
	price_per_million_t?: number;
	price_per_token_usd?: string;
}

interface RoutewayModel {
	id: string;
	name?: string;
	short_name?: string;
	description?: string;
	context_length?: number;
	available?: boolean;
	type?: string;
	endpoints?: string[];
	pricing?: {
		input?: RoutewayPrice;
		output?: RoutewayPrice;
		caching?: { read?: RoutewayPrice; write?: RoutewayPrice };
	};
	supported_parameters?: string[];
	capabilities?: {
		vision?: boolean;
		function_call?: boolean;
		reasoning?: boolean;
	};
}

function parsePricePerToken(price: RoutewayPrice | undefined): number {
	if (!price) return 0;
	if (typeof price.price_per_token_usd === "string") {
		const parsed = Number.parseFloat(price.price_per_token_usd);
		if (!Number.isNaN(parsed)) return parsed;
	}
	if (typeof price.price_per_million_t === "number") {
		return price.price_per_million_t / 1_000_000;
	}
	return 0;
}

function isChatModel(model: RoutewayModel): boolean {
	return (
		model.available !== false &&
		(model.type === "chat.completions" ||
			(model.endpoints ?? []).includes("/v1/chat/completions"))
	);
}

function mapRoutewayModel(
	model: RoutewayModel,
): ProviderModelConfig & { _pricingKnown?: boolean } {
	const rawName = model.short_name || model.name || model.id;
	const name = cleanModelName(rawName);
	const inputCost = parsePricePerToken(model.pricing?.input);
	const outputCost = parsePricePerToken(model.pricing?.output);
	const cacheRead = parsePricePerToken(model.pricing?.caching?.read);
	const cacheWrite = parsePricePerToken(model.pricing?.caching?.write);
	const hasPricing = !!(model.pricing?.input || model.pricing?.output);
	const reasoning =
		model.capabilities?.reasoning === true ||
		(model.supported_parameters ?? []).includes("reasoning_effort") ||
		isLikelyReasoningModel({ id: model.id, name });
	const free = inputCost === 0 && outputCost === 0;

	return {
		id: model.id,
		name: `${name} (Routeway)${free ? "" : " 💰"}`,
		reasoning,
		input: model.capabilities?.vision ? ["text", "image"] : ["text"],
		cost: {
			input: inputCost,
			output: outputCost,
			cacheRead,
			cacheWrite,
		},
		contextWindow: model.context_length ?? 128_000,
		maxTokens: 16_384,
		compat: getProxyModelCompat({ id: model.id, name }),
		_pricingKnown: hasPricing,
	} as ProviderModelConfig & { _pricingKnown?: boolean };
}

async function fetchRoutewayModels(
	apiKey: string,
): Promise<ProviderModelConfig[]> {
	_logger.info("[routeway] Fetching models from Routeway API...");

	try {
		const response = await fetchWithRetry(
			`${BASE_URL_ROUTEWAY}/models`,
			{
				headers: {
					Authorization: `Bearer ${apiKey}`,
					Accept: "application/json",
					"Content-Type": "application/json",
				},
			},
			3,
			1000,
			DEFAULT_FETCH_TIMEOUT_MS,
		);

		if (!response.ok) {
			throw new Error(`Routeway API error: ${response.status}`);
		}

		const json = (await response.json()) as { data?: RoutewayModel[] };
		const models = (json.data ?? []).filter(isChatModel);

		_logger.info(`[routeway] Fetched ${models.length} chat models`);
		const enriched = await safeEnrichModelsWithModelsDev(
			models.map(mapRoutewayModel),
			{
				providerId: PROVIDER_ROUTEWAY,
			},
		);
		return applyHidden(enriched, PROVIDER_ROUTEWAY);
	} catch (error) {
		_logger.error("[routeway] Failed to fetch models", {
			error: error instanceof Error ? error.message : String(error),
		});
		return [];
	}
}

// =============================================================================
// Probe
// =============================================================================

async function probeRoutewayModel(
	apiKey: string,
	modelId: string,
): Promise<"ok" | "broken" | "unknown"> {
	try {
		const response = await fetchWithTimeout(
			`${BASE_URL_ROUTEWAY}/chat/completions`,
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
			10000, // 10 second timeout
		);

		// 5xx = upstream server error (model unavailable)
		if (response.status >= 500) return "broken";
		// 404 = model not found / not provisioned
		if (response.status === 404) return "broken";
		// 429 = rate limited (model works)
		if (response.status === 429) return "ok";
		// 401 = auth issue (model exists, key issue)
		if (response.status === 401) return "ok";
		// 400 = bad request (model exists, param issue)
		if (response.status === 400) return "ok";
		// 200 = success
		if (response.ok) return "ok";
		return "ok";
	} catch {
		return "unknown";
	}
}

async function runRoutewayProbe(
	apiKey: string,
	modelsToTest: ProviderModelConfig[],
	stored: { free: ProviderModelConfig[]; all: ProviderModelConfig[] },
	reRegister: (models: ProviderModelConfig[]) => void,
	options: { useCache?: boolean } = {},
): Promise<string[]> {
	const modelIdsToProbe = options.useCache
		? new Set(
				getModelsDueForProbe(
					PROVIDER_ROUTEWAY,
					modelsToTest.map((m) => m.id),
				),
			)
		: undefined;
	const probeCandidates = modelIdsToProbe
		? modelsToTest.filter((m) => modelIdsToProbe.has(m.id))
		: modelsToTest;

	if (probeCandidates.length === 0) {
		_logger.info("Auto-probe: Routeway probe cache is fresh");
		return [];
	}

	const broken: string[] = [];
	const cacheableResults: Array<{ modelId: string; status: "ok" | "broken" }> =
		[];
	const batchSize = 5;

	for (let i = 0; i < probeCandidates.length; i += batchSize) {
		const batch = probeCandidates.slice(i, i + batchSize);
		const results = await Promise.all(
			batch.map(async (m) => {
				const status = await probeRoutewayModel(apiKey, m.id);
				return { id: m.id, status };
			}),
		);
		for (const r of results) {
			if (r.status === "broken") broken.push(r.id);
			if (r.status !== "unknown") {
				cacheableResults.push({ modelId: r.id, status: r.status });
			}
		}
	}

	await recordModelProbeResults(PROVIDER_ROUTEWAY, cacheableResults);

	if (broken.length === 0) {
		_logger.info("Auto-probe: all checked Routeway models are routable");
		return [];
	}

	// Auto-hide broken models in config (provider-scoped)
	const cfg = loadConfigFile();
	const existingHidden = new Set(cfg.hidden_models ?? []);
	for (const id of broken) existingHidden.add(`${PROVIDER_ROUTEWAY}/${id}`);
	saveConfig({ hidden_models: Array.from(existingHidden) });

	// Re-register so hidden models disappear immediately
	const filtered = await fetchRoutewayModels(apiKey);
	stored.free = filtered;
	stored.all = filtered;
	reRegister(filtered);

	_logger.info(
		`Auto-probe: found ${broken.length} broken models (auto-hidden)`,
	);
	return broken;
}

// =============================================================================
// Extension Entry Point
// =============================================================================

export default async function routewayProvider(pi: ExtensionAPI) {
	const apiKey = getRoutewayApiKey();

	if (!apiKey) {
		_logger.info(
			"[routeway] Skipping — ROUTEWAY_API_KEY not set. Sign up at https://routeway.ai/",
		);
		return;
	}

	const allModels = await fetchRoutewayModels(apiKey);

	if (allModels.length === 0) {
		_logger.warn("[routeway] No chat models available");
		return;
	}

	const freeModels = allModels.filter((m) =>
		isFreeModel({ ...m, provider: PROVIDER_ROUTEWAY }, allModels),
	);
	const stored = { free: freeModels, all: allModels };

	_logger.info(
		`[routeway] Registered ${allModels.length} models (${freeModels.length} free)`,
	);

	const reRegister = createReRegister(pi, {
		providerId: PROVIDER_ROUTEWAY,
		baseUrl: BASE_URL_ROUTEWAY,
		apiKey,
	});

	registerWithGlobalToggle(PROVIDER_ROUTEWAY, stored, reRegister, true);

	setupProvider(
		pi,
		{
			providerId: PROVIDER_ROUTEWAY,
			initialShowPaid: getRoutewayShowPaid(),
			tosUrl: "https://routeway.ai/terms",
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

	// ── Lazy auto-probe on first session_start ──────────────────────
	let _autoProbeDone = false;
	pi.on(
		"session_start",
		wrapSessionStartHandler("routeway", async () => {
			if (_autoProbeDone || !apiKey) return;
			_autoProbeDone = true;
			if (
				areAllModelsFresh(
					PROVIDER_ROUTEWAY,
					allModels.map((m) => m.id),
				)
			) {
				_logger.info("Auto-probe: Routeway probe cache is fresh");
				return;
			}
			_logger.info("Starting lazy auto-probe of Routeway models...");
			runRoutewayProbe(apiKey, allModels, stored, reRegister, {
				useCache: true,
			}).catch((err) => {
				_logger.warn("Auto-probe failed", {
					error: err instanceof Error ? err.message : String(err),
				});
			});
		}),
	);

	// ── Probe command: test all registered models for 5xx ─────────────
	pi.registerCommand("probe-routeway", {
		description:
			"Test all Routeway models for server errors and auto-hide broken ones",
		handler: async (_args, ctx) => {
			if (!apiKey) {
				ctx.ui.notify("ROUTEWAY_API_KEY not set", "error");
				return;
			}

			const modelsToTest = allModels;
			ctx.ui.notify(`Probing ${modelsToTest.length} Routeway models…`, "info");

			await runRoutewayProbe(apiKey, modelsToTest, stored, reRegister);

			// Check if any were hidden (re-read config)
			const cfgAfter = loadConfigFile();
			const newHidden = (cfgAfter.hidden_models ?? []).filter((h) =>
				h.startsWith(`${PROVIDER_ROUTEWAY}/`),
			);
			if (newHidden.length > 0) {
				ctx.ui.notify(
					`Found ${newHidden.length} broken models (auto-hidden):\n${newHidden.join("\n")}`,
					"warning",
				);
			} else {
				ctx.ui.notify("All Routeway models are routable ✅", "info");
			}
		},
	});

	const showPaid = getRoutewayShowPaid();
	const initialModels =
		showPaid && stored.all.length > 0 ? stored.all : freeModels;
	reRegister(initialModels);
}
