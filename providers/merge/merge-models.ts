/**
 * Merge Gateway model catalog (api-gateway.merge.dev/v1/models).
 *
 * Merge (merge.dev) runs a multi-vendor LLM gateway with two surfaces: an
 * OpenAI-compatible chat shim under /v1/openai/ and a richer native Gateway
 * API under /v1/. This fetcher uses the NATIVE catalog endpoint because the
 * OpenAI shim exposes only {id, object, created, owned_by}, while the native
 * one carries everything pi-free needs:
 *   - display_name, provider/model id
 *   - per-vendor routes with availability_status, context_window,
 *     max_output_tokens, capabilities (input/output modalities, reasoning,
 *     streaming) and pricing in USD PER MILLION tokens
 *     (input_per_million / output_per_million, plus optional flex/priority
 *     tiers and cache_read_per_million)
 *
 * Multi-vendor models route to any available vendor; pi-free publishes the
 * price of the CHEAPEST available route (one route's input and output
 * together, never the cheapest of each across routes) and the LARGEST
 * context/output limits so no capability is understated. Only routes whose
 * outputs are all text or tool_use are chat routes.
 *
 * Pricing units: Model.cost fields are USD per million tokens (pi-ai's
 * calculateCost divides by 1e6), so the per-million values publish unchanged. Route A authority is
 * stamped (_pricingKnown) ONLY when both standard-tier prices arrived as
 * genuine non-negative finite numbers on one available route;
 * otherwise costs stay 0 without the stamp and detection degrades to Route B.
 *
 * Free models: verified live — nvidia/nemotron-3.5-lightning-30b-a3b is
 * $0/$0 per million via its nvidia route (2026-08-26 audit).
 */

import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { type ChatModelConfig } from "../../lib/types.ts";
import { applyHidden } from "../../config.ts";
import {
	BASE_URL_MERGE,
	DEFAULT_FETCH_TIMEOUT_MS,
	PROVIDER_MERGE,
} from "../../constants.ts";
import { createLogger } from "../../lib/logger.ts";
import { fetchWithRetry, withSignal } from "../../lib/util.ts";

const _logger = createLogger("merge-models");

/** Native Gateway root (chat shim lives under ${BASE_URL_MERGE}). */
const GATEWAY_API_ROOT = BASE_URL_MERGE.replace(/\/openai$/, "");

interface MergeVendorRoute {
	availability_status?: unknown;
	context_window?: unknown;
	max_output_tokens?: unknown;
	capabilities?: {
		input?: unknown;
		output?: unknown;
		supports_reasoning?: unknown;
	};
	pricing?: {
		input_per_million?: unknown;
		output_per_million?: unknown;
		cache_read_per_million?: unknown;
		cache_write_per_million?: unknown;
	};
}

interface MergeCatalogModel {
	model?: unknown;
	display_name?: unknown;
	vendors?: unknown;
}

interface RoutePrice {
	input: number;
	output: number;
	cacheRead: number | undefined;
}

interface VendorSummary {
	contextWindow: number | undefined;
	maxTokens: number | undefined;
	reasoning: boolean;
	imageInput: boolean;
	/** One route's known standard-tier price; undefined when none is known. */
	price: RoutePrice | undefined;
}

const FALLBACK_CONTEXT_WINDOW = 128_000;
const FALLBACK_MAX_TOKENS = 4_096;

function asNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

function asStringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value
				.filter((v): v is string => typeof v === "string")
				.map((v) => v.toLowerCase())
		: [];
}

/**
 * Chat outputs in the Gateway's documented output enum (text, tool_use,
 * embedding, image, audio, video, decision). A route qualifies only when
 * every output it lists is one of these: image/audio/video hybrids and any
 * value outside the enum are refused.
 */
const CHAT_OUTPUTS: ReadonlySet<string> = new Set(["text", "tool_use"]);

/** Agent chat needs text in and only text (plus tool calls) out. */
function isTextChatRoute(input: string[], output: string[]): boolean {
	return (
		input.includes("text") &&
		output.includes("text") &&
		output.every((modality) => CHAT_OUTPUTS.has(modality))
	);
}

/** A route's standard-tier price, when both halves are genuine numbers >= 0. */
function knownRoutePrice(
	pricing: MergeVendorRoute["pricing"],
): RoutePrice | undefined {
	const input = asNumber(pricing?.input_per_million);
	const output = asNumber(pricing?.output_per_million);
	if (input === undefined || output === undefined) return undefined;
	if (input < 0 || output < 0) return undefined;
	return {
		input,
		output,
		cacheRead: asNumber(pricing?.cache_read_per_million),
	};
}

/** Largest known value; undefined only while neither side publishes one. */
function maxDefined(
	a: number | undefined,
	b: number | undefined,
): number | undefined {
	return a === undefined ? b : b === undefined ? a : Math.max(a, b);
}

/**
 * Collapse a model's vendor routes into one summary over AVAILABLE text-chat
 * routes only: the price of ONE route (the cheapest by input + output among
 * routes with a known price, so a $0/$0 route wins and two partly free
 * routes never combine into a fabricated $0/$0), the largest context/output
 * window, and OR-ed capability flags.
 */
function summarizeVendors(
	vendors: Record<string, MergeVendorRoute>,
): VendorSummary | undefined {
	let summary: VendorSummary | undefined;
	for (const route of Object.values(vendors)) {
		if (!route || typeof route !== "object") continue;
		if (route.availability_status !== "available") continue;

		const caps = route.capabilities ?? {};
		const input = asStringArray(caps.input);
		if (!isTextChatRoute(input, asStringArray(caps.output))) continue;

		const price = knownRoutePrice(route.pricing);
		const contextWindow = asNumber(route.context_window);
		const maxTokens = asNumber(route.max_output_tokens);
		const reasoning = caps.supports_reasoning === true;
		const imageInput = input.includes("image");
		if (!summary) {
			summary = { contextWindow, maxTokens, reasoning, imageInput, price };
			continue;
		}
		summary.contextWindow = maxDefined(summary.contextWindow, contextWindow);
		summary.maxTokens = maxDefined(summary.maxTokens, maxTokens);
		summary.reasoning = summary.reasoning || reasoning;
		summary.imageInput = summary.imageInput || imageInput;
		if (
			price &&
			(!summary.price ||
				price.input + price.output < summary.price.input + summary.price.output)
		) {
			summary.price = price;
		}
	}
	return summary;
}

/**
 * Map one native-catalog entry to the pi-free model config shape. Returns
 * undefined for entries without a usable id or with no available text-chat
 * vendor route rather than guessing.
 */
export function mapMergeModel(
	entry: MergeCatalogModel,
): ChatModelConfig | undefined {
	const id = typeof entry.model === "string" ? entry.model : undefined;
	if (!id) return undefined;
	if (!entry.vendors || typeof entry.vendors !== "object") return undefined;

	const summary = summarizeVendors(
		entry.vendors as Record<string, MergeVendorRoute>,
	);
	if (!summary) return undefined;

	const name =
		typeof entry.display_name === "string" && entry.display_name.length > 0
			? entry.display_name
			: id;

	// Route A authority requires BOTH standard-tier prices as genuine
	// non-negative finite numbers on one available route; otherwise
	// detection falls back to Route B.
	const price = summary.price;

	return {
		id,
		name,
		reasoning: summary.reasoning,
		input: summary.imageInput
			? (["text", "image"] as const)
			: (["text"] as const),
		cost: {
			input: price?.input ?? 0,
			output: price?.output ?? 0,
			// Clamp: a malformed negative cache price must not publish negative cost.
			cacheRead: Math.max(0, price?.cacheRead ?? 0),
			cacheWrite: 0,
		},
		contextWindow: summary.contextWindow ?? FALLBACK_CONTEXT_WINDOW,
		maxTokens: summary.maxTokens || FALLBACK_MAX_TOKENS,
		// SAFETY: the _pricingKnown marker (consumed by isFreeModel, never by
		// pi-ai) is stamped only when one route's real catalog pricing was
		// parsed (knownRoutePrice).
		_pricingKnown: price !== undefined,
	} as ChatModelConfig & { _pricingKnown?: boolean };
}

interface MergeCatalogPage {
	data?: unknown;
	has_more?: unknown;
	next_cursor?: unknown;
}

/**
 * Fetch the complete native catalog, following cursor pagination. The
 * endpoint is keyed — anonymous requests return HTTP 401 (verified live) —
 * so a real key is required even for discovery.
 */
export async function fetchMergeModels(
	apiKey: string,
	signal?: AbortSignal,
): Promise<ProviderModelConfig[]> {
	if (!apiKey) {
		_logger.warn("Merge catalog requires an API key; skipping fetch");
		return [];
	}
	const headers: Record<string, string> = {
		Authorization: `Bearer ${apiKey}`,
		Accept: "application/json",
	};

	const models: ProviderModelConfig[] = [];
	let cursor: string | undefined;
	// Hard page cap: 500/page means this can only trip on a runaway gateway.
	for (let page = 0; page < 20; page++) {
		// String-built query (no URL constructor): GATEWAY_API_ROOT is a
		// compile-time constant and the cursor is percent-encoded below.
		const url =
			`${GATEWAY_API_ROOT}/models?limit=500` +
			(cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");

		const response = await fetchWithRetry(
			url,
			withSignal({ headers }, signal),
			1,
			1_000,
			DEFAULT_FETCH_TIMEOUT_MS,
		);
		if (!response.ok) {
			throw new Error(`Merge catalog returned HTTP ${response.status}`);
		}
		const payload = (await response.json()) as MergeCatalogPage;
		const entries = Array.isArray(payload.data)
			? (payload.data as MergeCatalogModel[])
			: [];
		for (const entry of entries) {
			const mapped = mapMergeModel(entry);
			if (mapped) models.push(mapped);
		}
		if (payload.has_more === true && typeof payload.next_cursor === "string") {
			cursor = payload.next_cursor;
		} else {
			break;
		}
	}

	if (models.length === 0) {
		_logger.warn("Merge catalog returned no usable chat models");
	} else {
		_logger.info(`Merge catalog mapped ${models.length} chat models`);
	}
	return applyHidden(models, PROVIDER_MERGE);
}
