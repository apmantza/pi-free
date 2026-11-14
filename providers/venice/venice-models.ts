/**
 * Venice AI model catalog (api.venice.ai/api/v1/models?type=text).
 *
 * The schema is Venice-specific — nested `model_spec` with per-million-token
 * `pricing.{input,output,cache_input,cache_write}.usd` and a
 * `capabilities` flag block — so it is mapped here instead of through the
 * shared OpenRouter-compatible fetcher. Pricing is exposed inline for every
 * text model, which feeds pi-free's cost-based free-model detection (Route A)
 * without any curated list.
 *
 * Units: Venice reports USD per million tokens, the unit of `Model.cost`
 * (pi-ai's calculateCost divides by 1e6), so prices publish unchanged.
 *
 * Balance gate: Venice requires a POSITIVE account balance for ALL inference,
 * including zero-priced models — a $0/$0 catalog entry still answers HTTP 402
 * "Insufficient USD or Diem balance" for an unfunded key (verified live).
 * Classification intentionally follows the published pricing data anyway
 * (Route A): a $0-listed model is classified free and surfaces in the
 * free-only view; the balance requirement surfaces as a request-time error,
 * consistent with how every other keyed gateway behaves.
 */

import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { type ChatModelConfig } from "../../lib/types.ts";
import { applyHidden } from "../../config.ts";
import {
	BASE_URL_VENICE,
	DEFAULT_FETCH_TIMEOUT_MS,
	PROVIDER_VENICE,
} from "../../constants.ts";
import { createLogger } from "../../lib/logger.ts";
import { keepToolCallingModels } from "../../lib/model-map.ts";
import { fetchWithRetry, withSignal } from "../../lib/util.ts";

const _logger = createLogger("venice-models");

interface VeniceCatalogPrice {
	usd?: unknown;
}

interface VeniceCatalogModel {
	id?: unknown;
	type?: unknown;
	context_length?: unknown;
	model_spec?: {
		name?: unknown;
		pricing?: {
			input?: VeniceCatalogPrice;
			output?: VeniceCatalogPrice;
			cache_input?: VeniceCatalogPrice;
			cache_write?: VeniceCatalogPrice;
		};
		availableContextTokens?: unknown;
		maxCompletionTokens?: unknown;
		capabilities?: {
			supportsReasoning?: unknown;
			supportsReasoningEffort?: unknown;
			reasoningEffortOptions?: unknown;
			supportsVision?: unknown;
			supportsMultipleImages?: unknown;
			supportsFunctionCalling?: unknown;
		};
		description?: unknown;
	};
}

/** Fallback context window for entries that omit `context_length`. */
const FALLBACK_CONTEXT_WINDOW = 128_000;

/** Fallback max output tokens for entries that omit `maxCompletionTokens`. */
const FALLBACK_MAX_TOKENS = 4_096;

function asNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

/** A Venice USD-per-million price (the `Model.cost` unit), if published. */
function usdPerMillion(
	price: VeniceCatalogPrice | undefined,
): number | undefined {
	return asNumber(price?.usd);
}

/** The levels Venice accepts as `reasoning_effort`, one per pi level. */
const VENICE_EFFORT_LEVELS = [
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
] as const;

/**
 * pi thinking levels for a model whose catalog row lists the
 * `reasoning_effort` values it accepts (`reasoningEffortOptions`, e.g.
 * ["low","medium","high","xhigh","max"]). A level the row does not list is
 * marked unsupported (null) so pi-ai clamps to the nearest listed one instead
 * of sending a value the model was never declared to take; `off` maps to
 * "none" only where "none" is listed. Rows without the list keep pi-ai's
 * defaults.
 */
function veniceThinkingLevelMap(
	capabilities: NonNullable<VeniceCatalogModel["model_spec"]>["capabilities"],
): ChatModelConfig["thinkingLevelMap"] | undefined {
	const options = capabilities?.reasoningEffortOptions;
	if (
		capabilities?.supportsReasoningEffort !== true ||
		!Array.isArray(options) ||
		options.length === 0
	) {
		return undefined;
	}
	const listed = new Set(options.filter((o) => typeof o === "string"));
	const map: NonNullable<ChatModelConfig["thinkingLevelMap"]> = {
		off: listed.has("none") ? "none" : null,
	};
	for (const level of VENICE_EFFORT_LEVELS) {
		map[level] = listed.has(level) ? level : null;
	}
	return map;
}

/**
 * Map one catalog entry to the pi-free model config shape. Returns undefined
 * for non-text endpoints and unusable entries rather than guessing.
 */
export function mapVeniceModel(
	entry: VeniceCatalogModel,
): ChatModelConfig | undefined {
	if (typeof entry.id !== "string" || entry.id.length === 0) return undefined;
	// The /models endpoint also serves image, audio, video, and embedding
	// models; only chat-completions ("text") models are usable as agent
	// models. Strict check: entries missing `type` are rejected rather than
	// assumed text (matches the Agnes defensive posture).
	if (entry.type !== "text") return undefined;

	const spec = entry.model_spec ?? {};
	const capabilities = spec.capabilities ?? {};
	const vision =
		capabilities.supportsVision === true ||
		capabilities.supportsMultipleImages === true;
	const inputPrice = usdPerMillion(spec.pricing?.input);
	const outputPrice = usdPerMillion(spec.pricing?.output);
	const reasoning = capabilities.supportsReasoning === true;
	const thinkingLevelMap = reasoning
		? veniceThinkingLevelMap(capabilities)
		: undefined;

	return {
		id: entry.id,
		name:
			typeof spec.name === "string" && spec.name.length > 0
				? spec.name
				: entry.id,
		reasoning,
		...(thinkingLevelMap && { thinkingLevelMap }),
		input: vision ? (["text", "image"] as const) : (["text"] as const),
		cost: {
			input: inputPrice ?? 0,
			output: outputPrice ?? 0,
			cacheRead: usdPerMillion(spec.pricing?.cache_input) ?? 0,
			cacheWrite: usdPerMillion(spec.pricing?.cache_write) ?? 0,
		},
		contextWindow:
			asNumber(entry.context_length) ??
			asNumber(spec.availableContextTokens) ??
			FALLBACK_CONTEXT_WINDOW,
		maxTokens: asNumber(spec.maxCompletionTokens) ?? FALLBACK_MAX_TOKENS,
		// Route A trusts the cost only when both token prices were published:
		// the $0 above is a placeholder for a missing price, never a free
		// signal (defect shape 15). Metadata only; pi-ai never reads it.
		_pricingKnown: inputPrice !== undefined && outputPrice !== undefined,
	} as ChatModelConfig & { _pricingKnown?: boolean };
}

/**
 * Fetch the complete text-model catalog. The key is optional for /models; it
 * is only sent when configured so public discovery works for logged-out users.
 */
export async function fetchVeniceModels(
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
		`${BASE_URL_VENICE}/models?type=text`,
		withSignal(
			{
				headers,
			},
			signal,
		),
		1,
		1_000,
		DEFAULT_FETCH_TIMEOUT_MS,
	);
	if (!response.ok) {
		throw new Error(`Venice catalog returned HTTP ${response.status}`);
	}
	const payload: unknown = await response.json();
	const entries =
		payload &&
		typeof payload === "object" &&
		Array.isArray((payload as { data?: unknown }).data)
			? ((payload as { data: unknown[] }).data as VeniceCatalogModel[])
			: [];
	const models: ProviderModelConfig[] = [];
	const toolCalling = keepToolCallingModels(
		PROVIDER_VENICE,
		entries,
		(entry) => entry.model_spec?.capabilities?.supportsFunctionCalling === true,
	);
	for (const entry of toolCalling) {
		const mapped = mapVeniceModel(entry);
		if (mapped) models.push(mapped);
	}
	if (models.length === 0) {
		_logger.warn("Venice catalog returned no usable chat models");
	}
	return applyHidden(models, PROVIDER_VENICE);
}
