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
 * CHEAPEST available route's price and the LARGEST context/output limits so
 * no capability is understated.
 *
 * Pricing units: pi-free Model.cost fields are USD per token (OpenRouter
 * convention) -> divide per-million values by 1e6. Route A authority is
 * stamped (_pricingKnown) ONLY when both standard-tier prices arrived as
 * genuine non-negative finite numbers on at least one available vendor;
 * otherwise costs stay 0 without the stamp and detection degrades to Route B.
 *
 * Free models: verified live — nvidia/nemotron-3.5-lightning-30b-a3b is
 * $0/$0 per million via its nvidia route (2026-08-26 audit).
 */

import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { applyHidden } from "../../config.ts";
import {
	BASE_URL_MERGE,
	DEFAULT_FETCH_TIMEOUT_MS,
	PROVIDER_MERGE,
} from "../../constants.ts";
import { createLogger } from "../../lib/logger.ts";
import { fetchWithRetry } from "../../lib/util.ts";

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

interface VendorSummary {
	contextWindow: number | undefined;
	maxTokens: number | undefined;
	reasoning: boolean;
	imageInput: boolean;
	textChat: boolean;
	inputPerMillion: number | undefined;
	outputPerMillion: number | undefined;
	cacheReadPerMillion: number | undefined;
}

const FALLBACK_CONTEXT_WINDOW = 128_000;
const FALLBACK_MAX_TOKENS = 4_096;

function asNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asStringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value
				.filter((v): v is string => typeof v === "string")
				.map((v) => v.toLowerCase())
		: [];
}

/**
 * Collapse a model's vendor routes into one summary over AVAILABLE vendors
 * only: cheapest price, largest context/output window, OR-ed capability
 * flags, and text-chat eligibility (input text AND output text).
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
		const output = asStringArray(caps.output);
		// Agent chat needs text in and text out (tool_use alone is not enough).
		if (!input.includes("text") || !output.includes("text")) continue;

		const pricing = route.pricing ?? {};
		const candidate: VendorSummary = {
			contextWindow: asNumber(route.context_window),
			maxTokens: asNumber(route.max_output_tokens),
			reasoning: caps.supports_reasoning === true,
			imageInput: input.includes("image"),
			textChat: true,
			inputPerMillion: asNumber(pricing.input_per_million),
			outputPerMillion: asNumber(pricing.output_per_million),
			cacheReadPerMillion: asNumber(pricing.cache_read_per_million),
		};
		if (!summary) {
			summary = candidate;
			continue;
		}
		// Largest KNOWN window across routes; stays undefined while no route
		// publishes one — the fallback must never participate as a candidate.
		const maxDefined = (
			a: number | undefined,
			b: number | undefined,
		): number | undefined =>
			a === undefined ? b : b === undefined ? a : Math.max(a, b);
		summary.contextWindow = maxDefined(
			summary.contextWindow,
			candidate.contextWindow,
		);
		summary.maxTokens = maxDefined(summary.maxTokens, candidate.maxTokens);
		summary.reasoning = summary.reasoning || candidate.reasoning;
		summary.imageInput = summary.imageInput || candidate.imageInput;
		// Cheapest available route wins per field across vendors (input price
		// may legitimately come from a different vendor than output price),
		// treating absent as worst.
		for (const key of [
			"inputPerMillion",
			"outputPerMillion",
			"cacheReadPerMillion",
		] as const) {
			const cur = summary[key];
			const next = candidate[key];
			if (cur === undefined || (next !== undefined && next < cur)) {
				summary[key] = next;
			}
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
): ProviderModelConfig | undefined {
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
	// non-negative finite numbers on some available vendor (verified live for
	// every chat route audited); otherwise detection falls back to Route B.
	const pricingKnown =
		summary.inputPerMillion !== undefined &&
		summary.outputPerMillion !== undefined &&
		summary.inputPerMillion >= 0 &&
		summary.outputPerMillion >= 0;

	return {
		id,
		name,
		reasoning: summary.reasoning,
		input: summary.imageInput
			? (["text", "image"] as const)
			: (["text"] as const),
		cost: {
			input: pricingKnown ? (summary.inputPerMillion ?? 0) / 1_000_000 : 0,
			output: pricingKnown ? (summary.outputPerMillion ?? 0) / 1_000_000 : 0,
			// Clamp: a malformed negative cache price must not publish negative cost.
			cacheRead: Math.max(0, summary.cacheReadPerMillion ?? 0) / 1_000_000,
			cacheWrite: 0,
		},
		contextWindow: summary.contextWindow ?? FALLBACK_CONTEXT_WINDOW,
		maxTokens: summary.maxTokens || FALLBACK_MAX_TOKENS,
		// SAFETY: the _pricingKnown marker (consumed by isFreeModel, never by
		// pi-ai) is stamped only when real catalog pricing was parsed; see the
		// pricingKnown guard above.
		_pricingKnown: pricingKnown,
	} as ProviderModelConfig & { _pricingKnown?: boolean };
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
			{ headers, signal },
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
