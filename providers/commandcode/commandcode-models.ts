/**
 * CommandCode model catalog (api.commandcode.ai/provider/v1/models).
 *
 * CommandCode (commandcode.ai) is an AI subscription gateway routing to
 * ~60 models across OpenAI, Anthropic, Google, xAI, Moonshot, Qwen, GLM,
 * MiniMax, DeepSeek, Meta, and more. The catalog endpoint is PUBLIC
 * (anonymous GET returns 200, verified live) while chat requires an
 * account whose plan includes Provider API access.
 *
 * The shim catalog carries only {id, object, created, owned_by, name,
 * context_length} — no pricing, modalities, or reasoning flags. Those come
 * from curated tables in commandcode-pricing.ts (ported from the MIT-licensed
 * patlux/pi-commandcode-provider extension, verified against CommandCode's
 * official pricing page 2026-08-25).
 *
 * Wire protocol: claude-* models are served over Anthropic Messages; every
 * other model speaks OpenAI Chat Completions (see apiForModelId). The
 * provider pairs this with a dual-stream override that dispatches on the
 * runtime model api.
 */

import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import type { Api } from "@earendil-works/pi-ai/compat";
import { applyHidden } from "../../config.ts";
import {
	BASE_URL_COMMANDCODE,
	DEFAULT_FETCH_TIMEOUT_MS,
	PROVIDER_COMMANDCODE,
} from "../../constants.ts";
import { createLogger } from "../../lib/logger.ts";
import { fetchWithRetry } from "../../lib/util.ts";
import {
	MODEL_COSTS,
	MODEL_INPUT_MODALITIES,
	MODEL_REASONING,
	MODEL_MAX_OUTPUT_TOKENS,
	TEMPORARY_PRICING,
} from "./commandcode-pricing.ts";

const _logger = createLogger("commandcode-models");

/** Fallback context window for entries missing `context_length`. */
const FALLBACK_CONTEXT_WINDOW = 128_000;

interface CommandCodeCatalogModel {
	id?: unknown;
	name?: unknown;
	context_length?: unknown;
}

/**
 * Wire transport per model: CommandCode serves claude-* models over its
 * Anthropic Messages route and everything else over OpenAI Chat Completions
 * (mirrors patlux/pi-commandcode-provider's apiForModelId).
 */
export function apiForCommandCodeModel(modelId: string): Api {
	return modelId.startsWith("claude-")
		? "anthropic-messages"
		: "openai-completions";
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asPositiveNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value > 0
		? value
		: undefined;
}

/**
 * Map one catalog entry to the pi-free model config shape. Returns undefined
 * for entries without a usable id rather than guessing.
 */
export function mapCommandCodeModel(
	entry: CommandCodeCatalogModel,
): ProviderModelConfig | undefined {
	const id = asString(entry.id);
	if (!id) return undefined;

	const name = asString(entry.name) ?? id;
	const cost = MODEL_COSTS[id];
	const inputModalities = MODEL_INPUT_MODALITIES[id];
	const maxOutputTokens =
		asPositiveNumber(MODEL_MAX_OUTPUT_TOKENS[id]) ?? 16_384;

	return {
		id,
		name,
		reasoning: MODEL_REASONING[id] === true,
		input: inputModalities?.includes("image")
			? (["text", "image"] as const)
			: (["text"] as const),
		cost: {
			// Catalog prices are USD per million tokens -> pi-free stores per token.
			input: (cost?.input ?? 0) / 1_000_000,
			output: (cost?.output ?? 0) / 1_000_000,
			cacheRead: (cost?.cacheRead ?? 0) / 1_000_000,
			cacheWrite: (cost?.cacheWrite ?? 0) / 1_000_000,
		},
		contextWindow:
			asPositiveNumber(entry.context_length) ?? FALLBACK_CONTEXT_WINDOW,
		maxTokens: maxOutputTokens,
		// SAFETY: _pricingKnown is stamped ONLY for ids present in the curated
		// MODEL_COSTS table (verified against CommandCode's official pricing
		// page); unknown ids keep zero costs WITHOUT the stamp so detection
		// degrades to Route B instead of trusting fabricated $0 costs.
		_pricingKnown: cost !== undefined,
	} as ProviderModelConfig & { _pricingKnown?: boolean };
}
/**
 * Fetch the complete catalog. The endpoint is public (anonymous GET returns
 * 200, verified live), but chat requires an account whose plan includes
 * Provider API access.
 */
export async function fetchCommandCodeModels(
	apiKey: string,
	signal?: AbortSignal,
): Promise<ProviderModelConfig[]> {
	const headers: Record<string, string> = {
		Accept: "application/json",
	};
	if (apiKey) {
		headers.Authorization = `Bearer ${apiKey}`;
	}
	const response = await fetchWithRetry(
		`${BASE_URL_COMMANDCODE}/models`,
		{
			headers,
			signal,
		},
		1,
		1_000,
		DEFAULT_FETCH_TIMEOUT_MS,
	);
	if (!response.ok) {
		throw new Error(`CommandCode catalog returned HTTP ${response.status}`);
	}
	const payload: unknown = await response.json();
	const entries =
		payload &&
		typeof payload === "object" &&
		Array.isArray((payload as { data?: unknown }).data)
			? ((payload as { data: unknown[] }).data as CommandCodeCatalogModel[])
			: [];
	const models: ProviderModelConfig[] = [];
	for (const entry of entries) {
		const mapped = mapCommandCodeModel(entry);
		if (mapped) models.push(mapped);
	}
	if (models.length === 0) {
		_logger.warn("CommandCode catalog returned no usable models");
	}
	return applyHidden(models, PROVIDER_COMMANDCODE);
}

/**
 * Per-model wire transport for the shared native-provider helper: claude-*
 * models speak Anthropic Messages, everything else OpenAI Chat Completions.
 * Pair with the dual-stream override in commandcode.ts.
 */
export function apiForModel(modelId: string): Api {
	return apiForCommandCodeModel(modelId);
}

export { TEMPORARY_PRICING };
