/**
 * Merge Gateway provider tests.
 *
 * Covers the native-catalog mapper (per-vendor route summarization:
 * availability filtering, cheapest-price selection, capability OR-ing,
 * Route A pricing authority) against the live Gateway schema documented at
 * docs.merge.dev/merge-gateway/api-overview/models/list.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
	fetchMergeModels,
	mapMergeModel,
} from "../providers/merge/merge-models.ts";

/** One vendor route with sensible defaults matching the live schema. */
function vendor(overrides: Record<string, unknown> = {}) {
	return {
		availability_status: "available",
		context_window: 128_000,
		max_output_tokens: 16_384,
		capabilities: {
			input: ["text"],
			output: ["text", "tool_use"],
			supports_reasoning: false,
		},
		pricing: {
			input_per_million: 0.1,
			output_per_million: 0.4,
			cache_read_per_million: null,
		},
		...overrides,
	};
}

function catalogEntry(overrides: Record<string, unknown> = {}) {
	return {
		model: "nvidia/nemotron-3.5-lightning-30b-a3b",
		display_name: "Nemotron 3.5 Lightning 30B A3B",
		vendors: {
			nvidia: vendor({
				context_window: 1_000_000,
				max_output_tokens: 262_144,
				capabilities: {
					input: ["text"],
					output: ["text", "tool_use"],
					supports_reasoning: true,
				},
				pricing: {
					input_per_million: 0,
					output_per_million: 0,
					cache_read_per_million: null,
				},
			}),
		},
		aliases: [],
		availability_status: "available",
		...overrides,
	};
}

describe("mapMergeModel", () => {
	it("maps the live-verified free Nemotron Lightning route", () => {
		const model = mapMergeModel(catalogEntry());
		expect(model).toBeDefined();
		expect(model?.id).toBe("nvidia/nemotron-3.5-lightning-30b-a3b");
		expect(model?.name).toBe("Nemotron 3.5 Lightning 30B A3B");
		// $0/$0 per million -> per-token zero, stamped Route A authoritative.
		expect(model?.cost.input).toBe(0);
		expect(model?.cost.output).toBe(0);
		expect((model as unknown as { _pricingKnown?: boolean })._pricingKnown).toBe(
			true,
		);
		expect(model?.reasoning).toBe(true);
		expect(model?.contextWindow).toBe(1_000_000);
		expect(model?.maxTokens).toBe(262_144);
	});

	it("picks the cheapest available vendor per field and ORs capabilities", () => {
		const model = mapMergeModel(
			catalogEntry({
				vendors: {
					expensive: vendor({
						context_window: 2_000_000,
						max_output_tokens: 32_768,
						capabilities: {
							input: ["text", "image"],
							output: ["text", "tool_use"],
							supports_reasoning: true,
						},
						pricing: {
							input_per_million: 3,
							output_per_million: 15,
							cache_read_per_million: 0.3,
						},
					}),
					cheap: vendor({
						pricing: { input_per_million: 1, output_per_million: 4 },
					}),
				},
			}),
		);
		// Price comes from the cheap vendor; window/caps take the widest/ORed.
		expect(model?.cost.input).toBeCloseTo(1e-6, 12);
		expect(model?.cost.output).toBeCloseTo(4e-6, 12);
		expect(model?.contextWindow).toBe(2_000_000);
		expect(model?.maxTokens).toBe(32_768);
		expect(model?.input).toEqual(["text", "image"]);
		expect(model?.reasoning).toBe(true);
	});

	it("ignores unavailable (deprecated) vendors entirely", () => {
		const model = mapMergeModel(
			catalogEntry({
				vendors: {
					retired: vendor({
						availability_status: "deprecated",
						pricing: { input_per_million: 0, output_per_million: 0 },
					}),
					live: vendor({ pricing: { input_per_million: 2, output_per_million: 8 } }),
				},
			}),
		);
		expect(model).toBeDefined();
		// The $0 deprecated route must not leak into the published price.
		expect(model?.cost.input).toBeCloseTo(2e-6, 12);
	});

	it("rejects models with no available text-chat vendor route", () => {
		// All vendors unavailable -> no summary -> rejected.
		expect(
			mapMergeModel(
				catalogEntry({
					vendors: { v: vendor({ availability_status: "deprecated" }) },
				}),
			),
		).toBeUndefined();
		// Image-in/text-out-only routes are not agent chat models.
		expect(
			mapMergeModel(
				catalogEntry({
					vendors: {
						v: vendor({
							capabilities: { input: ["image"], output: ["text"] },
						}),
					},
				}),
			),
		).toBeUndefined();
		// Embedding-style output is not chat.
		expect(
			mapMergeModel(
				catalogEntry({
					vendors: {
						v: vendor({
							capabilities: { input: ["text"], output: ["embedding"] },
						}),
					},
				}),
			),
		).toBeUndefined();
	});

	it("refuses Route A authority when prices are not genuine numbers", () => {
		for (const bad of [
			{ input_per_million: "0.1", output_per_million: 0.4 },
			{ input_per_million: null, output_per_million: 0.4 },
			{},
			{ input_per_million: -1, output_per_million: 1 },
		]) {
			const model = mapMergeModel(
				catalogEntry({ vendors: { v: vendor({ pricing: bad }) } }),
			) as unknown as {
				_pricingKnown?: boolean;
				cost: { input: number; output: number };
			};
			expect(model._pricingKnown).toBe(false);
			expect(model.cost.input).toBe(0);
			expect(model.cost.output).toBe(0);
		}
	});

	it("returns undefined for unusable entries and applies fallbacks", () => {
		expect(mapMergeModel(catalogEntry({ model: "" }))).toBeUndefined();
		expect(mapMergeModel(catalogEntry({ model: undefined }))).toBeUndefined();
		expect(mapMergeModel(catalogEntry({ vendors: {} }))).toBeUndefined();
		const bare = mapMergeModel(
			catalogEntry({
				model: "vendor/model",
				display_name: "",
				vendors: {
					v: vendor({
						context_window: undefined,
						max_output_tokens: undefined,
					}),
				},
			}),
		);
		expect(bare).toBeDefined();
		expect(bare?.name).toBe("vendor/model");
		expect(bare?.contextWindow).toBe(128_000);
		expect(bare?.maxTokens).toBe(4_096);
	});

	it("keeps an unreported context window undefined instead of the fallback", () => {
		// Regression: the fallback must never participate as a candidate value.
		const model = mapMergeModel(
			catalogEntry({
				vendors: {
					v1: vendor({ context_window: undefined }),
					v2: vendor({ context_window: 32_000 }),
				},
			}),
		);
		expect(model?.contextWindow).toBe(32_000);
	});
});

describe("fetchMergeModels pagination", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("follows next_cursor across pages until has_more is false", async () => {
		// Two-page sequence: page 1 has_more + cursor "c2", page 2 terminal.
		const responses = [
			{
				ok: true,
				status: 200,
				json: async () => ({
					data: [{ model: "a/one", display_name: "A", vendors: { v: vendor() } }],
					has_more: true,
					next_cursor: "c2",
				}),
			},
			{
				ok: true,
				status: 200,
				json: async () => ({
					data: [{ model: "b/two", display_name: "B", vendors: { v: vendor() } }],
					has_more: false,
					next_cursor: null,
				}),
			},
		];
		const calls: string[] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string | URL) => {
				calls.push(String(url));
				return responses[calls.length - 1];
			}),
		);
		const models = await fetchMergeModels("test-key");
		expect(models.map((m) => m.id)).toEqual(["a/one", "b/two"]);
		expect(calls).toHaveLength(2);
		expect(calls[0]).toContain("limit=500");
		expect(calls[0]).not.toContain("cursor=");
		expect(calls[1]).toContain("cursor=c2");
	});

	it("throws on HTTP errors instead of publishing a partial catalog", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })),
		);
		await expect(fetchMergeModels("bad-key")).rejects.toThrow(/401/);
	});

	it("short-circuits without a key", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		const models = await fetchMergeModels("");
		expect(models).toEqual([]);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
