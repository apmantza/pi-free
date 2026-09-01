/**
 * LLM7 model catalog and conversion.
 *
 * LLM7.io routes requests across multiple upstream providers through a single
 * OpenAI-compatible endpoint. Its "models" are routing selectors, not specific
 * model IDs:
 *
 *   - "default" — first available free model (free)
 *   - "fast" — lowest latency option (free)
 *   - "pro" — highest quality, longer reasoning (paid, $12/mo subscription)
 *
 * The catalog is STATIC (no network fetch): the selectors never change, so
 * `fetchLlm7Catalog` builds them locally. The native provider's refreshModels
 * therefore performs zero network I/O even when `allowNetwork` is true.
 */

import type { Model } from "@earendil-works/pi-ai/compat";
import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { applyHidden } from "../../config.ts";
import { BASE_URL_LLM7, PROVIDER_LLM7 } from "../../constants.ts";
import { isFreeModel } from "../../lib/registry.ts";
import { withGatewayCompat } from "../../lib/native-provider.ts";

// =============================================================================
// Model Definitions
// =============================================================================

const LLM7_MODELS: ProviderModelConfig[] = [
	{
		id: "default",
		name: "LLM7 Default",
		reasoning: false,
		input: ["text"],
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
		},
		contextWindow: 32_000,
		maxTokens: 4_096,
	},
	{
		id: "fast",
		name: "LLM7 Fast",
		reasoning: false,
		input: ["text"],
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
		},
		contextWindow: 32_000,
		maxTokens: 4_096,
	},
	{
		id: "pro",
		name: "LLM7 Pro",
		reasoning: false,
		input: ["text"],
		cost: {
			input: 0.3, // Requires $12/mo LLM7 Pro subscription
			output: 0.9,
			cacheRead: 0,
			cacheWrite: 0,
		},
		contextWindow: 32_000,
		maxTokens: 4_096,
	},
];

// =============================================================================
// Catalog (static — no network)
// =============================================================================

/**
 * Build the LLM7 catalog, split into `{ all, free }` using the shared adaptive
 * free detection (Route A: "pro" exposes non-zero pricing, so free = zero-cost
 * input AND output → the "default" and "fast" selectors).
 *
 * Purely local: no fetch, no credential, never throws. `applyHidden` lets users
 * hide selectors via `hidden_models` (e.g. "llm7/pro"), consistent with every
 * other pi-free provider.
 */
export function fetchLlm7Catalog(): {
	all: ProviderModelConfig[];
	free: ProviderModelConfig[];
} {
	const all = applyHidden(LLM7_MODELS, PROVIDER_LLM7);
	const free = all.filter((m) =>
		isFreeModel({ ...m, provider: PROVIDER_LLM7 }, all),
	);
	return { all, free };
}

// =============================================================================
// Mapping to pi-ai Model
// =============================================================================

/**
 * Convert a ProviderModelConfig into the concrete pi-ai
 * `Model<"openai-completions">` shape a native provider's getModels() returns.
 * Adds the provider id, wire api, and gateway baseUrl that the legacy
 * registerProvider config form used to supply implicitly.
 */
function toLlm7Model(m: ProviderModelConfig): Model<"openai-completions"> {
	return withGatewayCompat({
		...m,
		api: "openai-completions",
		provider: PROVIDER_LLM7,
		baseUrl: m.baseUrl ?? BASE_URL_LLM7,
	} as Model<"openai-completions">);
}

/** Convert a batch of model configs to native Model objects. */
export function toLlm7Models(
	models: ProviderModelConfig[],
): Model<"openai-completions">[] {
	return models.map(toLlm7Model);
}
