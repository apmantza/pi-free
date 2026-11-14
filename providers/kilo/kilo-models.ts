/**
 * Kilo model fetching and mapping (OpenRouter-compatible format).
 */

import type { Model } from "@earendil-works/pi-ai/compat";
import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { isChatModelConfig } from "../../lib/types.ts";
import { applyHidden } from "../../config.ts";
import { PROVIDER_KILO } from "../../constants.ts";
import { isFreeModel } from "../../lib/registry.ts";
import { withGatewayCompat } from "../../lib/native-provider.ts";
import { fetchOpenRouterCompatibleModels } from "../model-fetcher.ts";

const KILO_API_BASE = process.env.KILO_API_URL || "https://api.kilo.ai";
export const KILO_GATEWAY_BASE = `${KILO_API_BASE}/api/gateway`;

/**
 * Honest pi-free identity headers, stamped on every Kilo model. pi-ai merges
 * only the MODEL's headers into requests (not provider.headers), so the
 * provider-level block was inert; see toKiloModel(). The genuine Kilo client
 * sends "Kilo CLI" / "opencode-kilo-provider" — adopting that identity is
 * tracked in the repo issue tracker; the gateway treats these as attribution
 * metadata and accepts requests without them.
 */
const KILO_IDENTITY_HEADERS: Record<string, string> = Object.freeze({
	"X-KILOCODE-EDITORNAME": "Pi",
	"User-Agent": "pi-free-providers",
});

// =============================================================================
// Compat shaping
// =============================================================================

/** Kilo Gateway compat overrides, borrowed from pi-kilo-provider. */
const KILO_COMPAT = {
	supportsStore: false,
	supportsDeveloperRole: false,
	supportsReasoningEffort: false,
	supportsUsageInStreaming: false,
	supportsStrictMode: false,
	thinkingFormat: "openrouter" as const,
	maxTokensField: "max_tokens" as const,
};

/**
 * Apply Kilo-specific compat overrides while preserving provider/model values.
 * Chat-only merge: image/classifier entries pass through (pi 1.x union).
 */
export function applyKiloCompat(
	models: ProviderModelConfig[],
): ProviderModelConfig[] {
	return models.map((m) => {
		if (!isChatModelConfig(m)) return m;
		return {
			...m,
			compat: {
				...KILO_COMPAT,
				...m.compat,
			},
		};
	});
}

// =============================================================================
// Fetch
// =============================================================================

/**
 * Routers (kilo-auto/*, openrouter/fusion, nvidia/switchyard, ...) list
 * prompt/completion "-1": billed at the routed model's rate. That is not a
 * price, so it must not become a negative cost; the model is stamped
 * pricing-unknown instead. Free/paid still comes from Kilo's `isFree` flag.
 */
function unpriceRoutedModel(model: ProviderModelConfig): ProviderModelConfig {
	if (!isChatModelConfig(model)) return model;
	if (model.cost.input >= 0 && model.cost.output >= 0) return model;
	const unpriced: typeof model & { _pricingKnown: false } = {
		...model,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		_pricingKnown: false,
	};
	return unpriced;
}

async function fetchKiloModels(options?: {
	token?: string | undefined;
	freeOnly?: boolean;
	signal?: AbortSignal | undefined;
}): Promise<ProviderModelConfig[]> {
	const models = await fetchOpenRouterCompatibleModels({
		providerId: PROVIDER_KILO,
		baseUrl: KILO_GATEWAY_BASE,
		apiKey: options?.token,
		freeOnly: options?.freeOnly,
		signal: options?.signal,
		// Gateways serve image/audio/video generators through the chat surface
		// with "text" beside the media output (gemini-*-image, gpt-5-image,
		// lyria-3-*, gpt-audio, gemini-omni); they are not chat models (#676).
		excludeOutputModalities: ["image", "audio", "video", "speech"],
	});

	return applyHidden(models.map(unpriceRoutedModel), PROVIDER_KILO);
}

/**
 * Fetch the full Kilo catalog (CI-enhanced + compat-shaped), falling back to a
 * free-only fetch when the authenticated catalog is unavailable. Returns the
 * catalog split into `{ all, free }` using the shared adaptive free detection.
 *
 * Never throws: on a total failure both arrays are empty so callers can register
 * an empty (dynamic) provider and recover on a later refresh.
 */
export async function fetchKiloCatalog(options?: {
	token?: string | undefined;
	signal?: AbortSignal;
}): Promise<{ all: ProviderModelConfig[]; free: ProviderModelConfig[] }> {
	const signal = options?.signal;
	let all: ProviderModelConfig[];
	try {
		all = await fetchKiloModels({
			token: options?.token,
			freeOnly: false,
			signal,
		});
	} catch {
		// Abort is cancellation, not failure: no free-only retry (convention 15).
		if (signal?.aborted) return { all: [], free: [] };
		try {
			all = await fetchKiloModels({
				token: options?.token,
				freeOnly: true,
				signal,
			});
		} catch {
			all = [];
		}
	}

	if (options?.signal?.aborted) {
		return { all: [], free: [] };
	}

	const free = all.filter((m) =>
		isFreeModel({ ...m, provider: PROVIDER_KILO }, all),
	);
	return { all, free };
}

// =============================================================================
// Mapping to pi-ai Model
// =============================================================================

/**
 * Convert a fetched/mapped ProviderModelConfig into the concrete pi-ai
 * `Model<"openai-completions">` shape a native provider's getModels() returns.
 * Adds the provider id, wire api, and gateway baseUrl that the legacy
 * registerProvider config form used to supply implicitly.
 */
function toKiloModel(m: ProviderModelConfig): Model<"openai-completions"> {
	return withGatewayCompat({
		...m,
		api: "openai-completions",
		provider: PROVIDER_KILO,
		baseUrl: m.baseUrl ?? KILO_GATEWAY_BASE,
		headers: KILO_IDENTITY_HEADERS,
	} as Model<"openai-completions">);
}

/**
 * Re-stamp identity headers on models restored from Pi's models store — a
 * store snapshot written before the headers existed (or by another client)
 * would otherwise reach the wire headerless (same pattern as Cline's
 * normalizeStoredClineModels).
 */
export function normalizeStoredKiloModels(
	models: Model<"openai-completions">[],
): Model<"openai-completions">[] {
	return models.map((m) => ({ ...m, headers: KILO_IDENTITY_HEADERS }));
}

/** Convert a batch of model configs to native Model objects. */
export function toKiloModels(
	models: ProviderModelConfig[],
): Model<"openai-completions">[] {
	// Chat-only catalog: image/classifier entries cannot be served as chat
	// models (pi 1.x union).
	return models.filter(isChatModelConfig).map(toKiloModel);
}
