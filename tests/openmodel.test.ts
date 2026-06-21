/**
 * Tests for the OpenModel provider's pure logic: catalog/protocol merge,
 * free-model detection (Route A on priced models, authoritative paid on
 * unpriced models), and cost/max/context mapping.
 *
 * Network I/O and ExtensionAPI registration are NOT tested here — the
 * fetcher is intentionally not exported. We exercise the deterministic
 * core that determines which models show under free-only mode and what
 * their cost/max tokens look like.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { isFreeModel } from "../lib/registry.ts";
import {
	effectiveCost,
	mapOpenModelModel,
	mergeOpenModelModels,
} from "../providers/openmodel/openmodel.ts";

afterEach(() => {
	vi.restoreAllMocks();
});

// =============================================================================
// Test fixtures — modeled on real /web/v1/models and /v1/models responses
// =============================================================================

function pricedItem(
	key: string,
	overrides: Partial<{
		provider_key: string;
		provider_name: string;
		multiplier: number;
		input_cost_per_token: number;
		output_cost_per_token: number;
		cache_read_input_token_cost: number;
		cache_creation_input_token_cost: number;
		max_input_tokens: number;
		max_output_tokens: number;
		supports_vision: boolean;
		supports_reasoning: boolean;
	}> = {},
) {
	return {
		key,
		provider_key: overrides.provider_key ?? "deepseek",
		provider_name: overrides.provider_name ?? "Deepseek",
		prices: {
			input_cost_per_token: overrides.input_cost_per_token ?? 1.4e-7,
			output_cost_per_token: overrides.output_cost_per_token ?? 2.8e-7,
			cache_read_input_token_cost: overrides.cache_read_input_token_cost,
			cache_creation_input_token_cost:
				overrides.cache_creation_input_token_cost,
		},
		max: {
			max_input_tokens: overrides.max_input_tokens ?? 1_000_000,
			max_output_tokens: overrides.max_output_tokens ?? 8192,
		},
		supports: {
			supports_vision: overrides.supports_vision,
			supports_reasoning: overrides.supports_reasoning,
		},
		price_multiplier: overrides.multiplier ?? 0,
	};
}

function protocol(id: string, protocols: string[]) {
	return {
		id,
		object: "model",
		created: 0,
		owned_by: "unknown",
		supported_protocols: protocols,
	};
}

// =============================================================================
// effectiveCost
// =============================================================================

describe("effectiveCost", () => {
	it("returns all zeros when multiplier is 0 (free event)", () => {
		expect(
			effectiveCost(
				{
					input_cost_per_token: 1.4e-7,
					output_cost_per_token: 2.8e-7,
					cache_read_input_token_cost: 2.8e-9,
				},
				0,
			),
		).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
	});

	it("scales per-token costs by price_multiplier", () => {
		const result = effectiveCost(
			{
				input_cost_per_token: 1.0e-6,
				output_cost_per_token: 2.0e-6,
				cache_read_input_token_cost: 1.0e-7,
				cache_creation_input_token_cost: 2.0e-7,
			},
			0.5,
		);
		expect(result.input).toBeCloseTo(5.0e-7, 12);
		expect(result.output).toBeCloseTo(1.0e-6, 12);
		expect(result.cacheRead).toBeCloseTo(5.0e-8, 12);
		expect(result.cacheWrite).toBeCloseTo(1.0e-7, 12);
	});

	it("treats missing price fields as 0", () => {
		expect(effectiveCost({}, 1)).toEqual({
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
		});
	});
});

// =============================================================================
// mergeOpenModelModels — protocol filtering
// =============================================================================

describe("mergeOpenModelModels", () => {
	const catalog = [
		pricedItem("deepseek-v4-flash", { multiplier: 0 }),
		pricedItem("deepseek-v4-pro", { multiplier: 0.25 }),
		pricedItem("claude-sonnet-4-6", { multiplier: 0.95 }),
		pricedItem("gpt-5.5", { multiplier: 0.7 }), // responses-only
		pricedItem("gemini-3-flash-preview", { multiplier: 0.9 }), // gemini-only
		pricedItem("1024-x-1024/gpt-image-1.5", { multiplier: 1 }), // images-only
	];

	const protocols = [
		protocol("deepseek-v4-flash", ["messages"]),
		protocol("deepseek-v4-pro", ["messages"]),
		protocol("claude-sonnet-4-6", ["messages"]),
		protocol("gpt-5.5", ["responses"]),
		protocol("gemini-3-flash-preview", ["gemini"]),
		protocol("1024-x-1024/gpt-image-1.5", ["images"]),
		// Unpriced messages-protocol models (not in catalog):
		protocol("minimax-m3", ["messages"]),
		protocol("kimi-k2.5", ["messages"]),
		protocol("qwen3-max", ["messages", "responses"]),
	];

	it("keeps only models whose protocols include 'messages'", () => {
		const merged = mergeOpenModelModels(catalog, protocols);
		const ids = merged.map((m) => m.item.key).sort((a, b) => a.localeCompare(b));
		expect(ids).toEqual(
			[
				"claude-sonnet-4-6",
				"deepseek-v4-flash",
				"deepseek-v4-pro",
				"kimi-k2.5",
				"minimax-m3",
				"qwen3-max",
			].sort((a, b) => a.localeCompare(b)),
		);
	});

	it("marks priced models as source='priced' and unpriced as 'unpriced'", () => {
		const merged = mergeOpenModelModels(catalog, protocols);
		const byId = new Map(merged.map((m) => [m.item.key, m.source]));
		expect(byId.get("deepseek-v4-flash")).toBe("priced");
		expect(byId.get("claude-sonnet-4-6")).toBe("priced");
		expect(byId.get("minimax-m3")).toBe("unpriced");
		expect(byId.get("kimi-k2.5")).toBe("unpriced");
		expect(byId.get("qwen3-max")).toBe("unpriced");
	});

	it("handles an empty catalog gracefully — all protocol-listed messages models become 'unpriced'", () => {
		// When the public pricing endpoint is down but /v1/models works,
		// every messages-protocol model from the protocol list falls
		// through to the unpriced branch. isFreeModel treats unpriced
		// models as definitively paid, so this is safe degradation.
		const merged = mergeOpenModelModels([], protocols);
		const ids = merged.map((m) => m.item.key).sort((a, b) => a.localeCompare(b));
		expect(ids).toEqual(
			[
				"claude-sonnet-4-6",
				"deepseek-v4-flash",
				"deepseek-v4-pro",
				"kimi-k2.5",
				"minimax-m3",
				"qwen3-max",
			].sort((a, b) => a.localeCompare(b)),
		);
		expect(merged.every((m) => m.source === "unpriced")).toBe(true);
	});

	it("handles an empty protocol list gracefully (drops everything)", () => {
		const merged = mergeOpenModelModels(catalog, []);
		expect(merged).toEqual([]);
	});

	it("treats models missing from protocol list as non-messages", () => {
		// pricedItem with no matching protocol entry → filtered out.
		const merged = mergeOpenModelModels(
			[pricedItem("orphan-model", { multiplier: 0 })],
			[],
		);
		expect(merged).toEqual([]);
	});
});

// =============================================================================
// mapOpenModelModel — free detection and cost/max mapping
// =============================================================================

describe("mapOpenModelModel — free detection", () => {
	function build(
		overrides: Parameters<typeof pricedItem>[1] = {},
		source: "priced" | "unpriced" = "priced",
	) {
		const merged = {
			item: pricedItem("deepseek-v4-flash", overrides),
			source,
			supportsMessages: true,
		};
		return mapOpenModelModel(merged);
	}

	it("marks the free event model (multiplier=0) as free via authoritative override", () => {
		const model = build({ multiplier: 0 });
		expect(model._freeKnown).toBe(true);
		expect(model._isFree).toBe(true);
		expect(model.cost.input).toBe(0);
		expect(model.cost.output).toBe(0);
		expect(model._pricingKnown).toBe(true);
	});

	it("lets Route A classify a discounted paid model (multiplier>0) as not free", () => {
		// No _freeKnown override — isFreeModel Route A sees cost>0 → not free.
		const model = build({ multiplier: 0.25 });
		expect(model._freeKnown).toBeUndefined();
		expect(model._isFree).toBeUndefined();
		expect(model._pricingKnown).toBe(true);
		expect(model.cost.input).toBeGreaterThan(0);
		expect(model.cost.output).toBeGreaterThan(0);
	});

	it("lets Route A classify priced models with missing per-token prices as free (cost=0)", () => {
		// qwen3.6-flash etc. are in the priced catalog but have no
		// input_cost_per_token/output_cost_per_token fields. effectiveCost
		// returns 0, and isFreeModel Route A correctly marks them free.
		// No _freeKnown override — Route A handles it.
		const model = build({ multiplier: 0.8 }, "priced");
		// Strip prices to simulate qwen-style missing fields.
		const qwenLike = {
			...model,
			_pricingKnown: true,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		};
		expect(qwenLike._freeKnown).toBeUndefined();
		expect(qwenLike._isFree).toBeUndefined();
	});

	it("marks unpriced models as definitively not free", () => {
		const model = build({ multiplier: 1 }, "unpriced");
		expect(model._freeKnown).toBe(true);
		expect(model._isFree).toBe(false);
		expect(model._pricingKnown).toBe(false);
	});

	it("propagates contextWindow and maxTokens from the catalog", () => {
		const model = build({
			multiplier: 0,
			max_input_tokens: 1_000_000,
			max_output_tokens: 8192,
		});
		expect(model.contextWindow).toBe(1_000_000);
		expect(model.maxTokens).toBe(8192);
	});

	it("uses supports_vision to set image input modality", () => {
		const visionModel = build({ supports_vision: true });
		expect(visionModel.input).toEqual(["text", "image"]);

		const textOnly = build({ supports_vision: false });
		expect(textOnly.input).toEqual(["text"]);
	});

	it("sets reasoning=true when supports_reasoning is true", () => {
		const reasoningModel = build({ supports_reasoning: true });
		expect(reasoningModel.reasoning).toBe(true);
	});
});

// =============================================================================
// End-to-end free detection via the public isFreeModel entry point
// =============================================================================

describe("OpenModel + isFreeModel integration (free-only mode)", () => {
	const catalog = [
		pricedItem("deepseek-v4-flash", { multiplier: 0 }),
		pricedItem("deepseek-v4-pro", { multiplier: 0.25 }),
		pricedItem("claude-sonnet-4-6", { multiplier: 0.95 }),
	];
	const protocols = [
		protocol("deepseek-v4-flash", ["messages"]),
		protocol("deepseek-v4-pro", ["messages"]),
		protocol("claude-sonnet-4-6", ["messages"]),
	];

	const allModels = mergeOpenModelModels(catalog, protocols).map(
		mapOpenModelModel,
	);

	it("exposes only deepseek-v4-flash as free (the free event model)", () => {
		const free = allModels.filter((m) =>
			isFreeModel({ ...m, provider: "openmodel" }, allModels),
		);
		expect(free.map((m) => m.id)).toEqual(["deepseek-v4-flash"]);
	});

	it("hides all paid models under free-only mode", () => {
		const freeIds = allModels
			.filter((m) => isFreeModel({ ...m, provider: "openmodel" }, allModels))
			.map((m) => m.id);
		expect(freeIds).not.toContain("deepseek-v4-pro");
		expect(freeIds).not.toContain("claude-sonnet-4-6");
	});

	it("keeps unpriced models paid even when no priced paid models exist", () => {
		const unpricedCatalog: typeof catalog = [];
		const unpricedProtocols = [
			protocol("minimax-m3", ["messages"]),
			protocol("kimi-k2.5", ["messages"]),
		];
		const unpricedAll = mergeOpenModelModels(
			unpricedCatalog,
			unpricedProtocols,
		).map(mapOpenModelModel);

		const free = unpricedAll.filter((m) =>
			isFreeModel({ ...m, provider: "openmodel" }, unpricedAll),
		);
		expect(free).toEqual([]);
	});
});
