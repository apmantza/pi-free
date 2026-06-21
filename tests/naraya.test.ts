/**
 * Tests for the Naraya provider's pure logic: model mapping, pricing
 * fallback, and freemium classification.
 *
 * The pricing table is hardcoded from the published rate card (the API
 * does not expose per-token prices), so these tests guard against
 * accidental drift in the table and the freemium override.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { isFreeModel } from "../lib/registry.ts";
import { mapNarayaModel } from "../providers/naraya/naraya.ts";

afterEach(() => {
	vi.restoreAllMocks();
});

// =============================================================================
// mapNarayaModel
// =============================================================================

describe("mapNarayaModel — pricing and metadata", () => {
	it("maps a vision+reasoning model with full pricing from the rate card", () => {
		const model = mapNarayaModel({
			id: "minimax-m3",
			owned_by: "naraya",
			context_window: 1_000_000,
			weight: 1.5,
			reasoning: true,
			vision: true,
		});

		expect(model.id).toBe("minimax-m3");
		expect(model.reasoning).toBe(true);
		expect(model.input).toEqual(["text", "image"]);
		expect(model.contextWindow).toBe(1_000_000);
		// Per rate card: $0.15 / $0.03 / $0.61 per 1M (input / cache / output)
		expect(model.cost.input).toBe(0.15);
		expect(model.cost.cacheRead).toBe(0.03);
		expect(model.cost.output).toBe(0.61);
		// cacheWrite defaults to input rate
		expect(model.cost.cacheWrite).toBe(0.15);
		expect(model._pricingKnown).toBe(true);
	});

	it("maps a text-only reasoning model (deepseek-v4-flash-naraya)", () => {
		const model = mapNarayaModel({
			id: "deepseek-v4-flash-naraya",
			owned_by: "naraya",
			context_window: 1_000_000,
			weight: 1.5,
			reasoning: true,
		});

		expect(model.reasoning).toBe(true);
		expect(model.input).toEqual(["text"]); // no vision
		expect(model.contextWindow).toBe(1_000_000);
		// Per rate card: $0.03 / $0.01 / $0.05
		expect(model.cost.input).toBe(0.03);
		expect(model.cost.cacheRead).toBe(0.01);
		expect(model.cost.output).toBe(0.05);
	});

	it("maps a text-only non-reasoning model (claude-sonnet-4.5)", () => {
		const model = mapNarayaModel({
			id: "claude-sonnet-4.5",
			owned_by: "naraya",
			context_window: 200_000,
			weight: 1.5,
		});

		expect(model.reasoning).toBe(false);
		expect(model.input).toEqual(["text"]);
		expect(model.contextWindow).toBe(200_000);
		// Per rate card: $0.30 / $0.03 / $1.52
		expect(model.cost.input).toBe(0.3);
		expect(model.cost.cacheRead).toBe(0.03);
		expect(model.cost.output).toBe(1.52);
	});

	it("maps a vision-only model (claude-haiku-4.5)", () => {
		const model = mapNarayaModel({
			id: "claude-haiku-4.5",
			owned_by: "naraya",
			context_window: 200_000,
			weight: 1,
			vision: true,
		});

		expect(model.reasoning).toBe(false);
		expect(model.input).toEqual(["text", "image"]);
		// Per rate card: $0.10 / $0.01 / $0.51
		expect(model.cost.input).toBe(0.1);
		expect(model.cost.output).toBe(0.51);
	});

	it("falls back to cost=0 for models missing from the rate card", () => {
		// New model added to the API but not yet in our hardcoded rate card.
		const model = mapNarayaModel({
			id: "future-model-2027",
			owned_by: "naraya",
			context_window: 128_000,
		});

		expect(model.cost.input).toBe(0);
		expect(model.cost.output).toBe(0);
		expect(model.cost.cacheRead).toBe(0);
		expect(model.cost.cacheWrite).toBe(0);
		expect(model._pricingKnown).toBe(false);
	});

	it("uses 128_000 as a safe context window default when API omits it", () => {
		const model = mapNarayaModel({ id: "minimax-m3" });
		expect(model.contextWindow).toBe(128_000);
	});

	it("preserves compat overrides for DeepSeek/Qwen3.7 proxy quirks", () => {
		const deepseek = mapNarayaModel({ id: "deepseek-v4-flash-naraya" });
		expect(
			(deepseek.compat as { thinkingFormat?: string } | undefined)
				?.thinkingFormat,
		).toBe("deepseek");

		const qwen = mapNarayaModel({ id: "qwen3.7-max-naraya" });
		expect(
			(qwen.compat as { thinkingFormat?: string } | undefined)?.thinkingFormat,
		).toBe("deepseek");

		// Claude/GLM/Mistral/MiniMax: no proxy compat from the generic
		// getProxyModelCompat helper. MiniMax would need custom handling
		// (tokenrouter does this in its own module) if reasoning issues
		// arise; for Naraya's openai-completions flow we trust pi's
		// native reasoning handling driven by reasoning: true.
		const mimo = mapNarayaModel({ id: "minimax-m3" });
		expect(mimo.compat).toBeUndefined();

		const claude = mapNarayaModel({ id: "claude-sonnet-4.5" });
		expect(claude.compat).toBeUndefined();

		const glm = mapNarayaModel({ id: "glm-5" });
		expect(glm.compat).toBeUndefined();
	});
});

// =============================================================================
// Freemium classification — all Naraya models are free under the 5M/day quota
// =============================================================================

describe("Naraya freemium classification", () => {
	const allModels = [
		mapNarayaModel({ id: "deepseek-v4-flash-naraya", reasoning: true }),
		mapNarayaModel({ id: "minimax-m3", vision: true, reasoning: true }),
		mapNarayaModel({ id: "claude-sonnet-4.5" }),
		mapNarayaModel({ id: "claude-haiku-4.5", vision: true }),
		mapNarayaModel({ id: "glm-5" }),
	];

	it("marks every Naraya model as _freeKnown / _isFree (freemium override)", () => {
		for (const m of allModels) {
			expect(m._freeKnown).toBe(true);
			expect(m._isFree).toBe(true);
		}
	});

	it("classifies every Naraya model as free via isFreeModel", () => {
		const free = allModels.filter((m) =>
			isFreeModel({ ...m, provider: "naraya" }, allModels),
		);
		expect(free.length).toBe(allModels.length);
	});

	it("classifies Naraya models as free even if their effective cost is non-zero", () => {
		// Per rate card, claude-sonnet-4.5 costs $0.30/$1.52 per 1M tokens.
		// The _freeKnown override ensures it's still treated as free
		// (freemium: included in the daily quota).
		const claude = allModels.find((m) => m.id === "claude-sonnet-4.5");
		expect(claude).toBeDefined();
		expect(claude!.cost.input).toBeGreaterThan(0);
		expect(claude!.cost.output).toBeGreaterThan(0);
		expect(isFreeModel({ ...claude!, provider: "naraya" }, allModels)).toBe(
			true,
		);
	});
});
