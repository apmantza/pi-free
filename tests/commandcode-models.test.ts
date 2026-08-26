/**
 * CommandCode provider tests.
 *
 * Covers the catalog mapper (curated pricing table in USD per million
 * tokens -> pi-free per-token cost, Route A authority only for ids present
 * in the pricing table, modality/reasoning tables) and the claude-*
 * Anthropic-Messages transport split.
 */

import { describe, expect, it } from "vitest";

import {
	apiForCommandCodeModel,
	mapCommandCodeModel,
} from "../providers/commandcode/commandcode-models.ts";

function catalogEntry(overrides: Record<string, unknown> = {}) {
	return {
		id: "gpt-5.6-sol",
		object: "model",
		created: 1_787_747_204,
		owned_by: "command-code",
		name: "GPT-5.6 Sol",
		context_length: 1_000_000,
		...overrides,
	};
}

describe("mapCommandCodeModel", () => {
	it("maps a priced model from the curated table to per-token cost", () => {
		const model = mapCommandCodeModel(catalogEntry());
		expect(model).toBeDefined();
		expect(model?.id).toBe("gpt-5.6-sol");
		expect(model?.name).toBe("GPT-5.6 Sol");
		// Table: $5/$30 per million -> 5e-6/3e-5 per token.
		expect(model?.cost.input).toBeCloseTo(5e-6, 12);
		expect(model?.cost.output).toBeCloseTo(3e-5, 12);
		expect(model?.cost.cacheRead).toBeCloseTo(0.5e-6, 12);
		expect(model?.cost.cacheWrite).toBeCloseTo(6.25e-6, 12);
		expect(model?.contextWindow).toBe(1_000_000);
		expect((model as unknown as { _pricingKnown?: boolean })._pricingKnown).toBe(
			true,
		);
	});

	it("maps the documented free models at zero cost with authority", () => {
		for (const id of ["poolside/laguna-s-2.1-free", "stealth/ox-alpha"]) {
			const model = mapCommandCodeModel(catalogEntry({ id }));
			expect(model?.cost.input).toBe(0);
			expect(model?.cost.output).toBe(0);
			expect((model as unknown as { _pricingKnown?: boolean })._pricingKnown).toBe(
				true,
			);
		}
	});

	it("does NOT stamp pricing authority for ids missing from the table", () => {
		const model = mapCommandCodeModel(
			catalogEntry({ id: "brand-new/unpriced-model", name: "Brand New" }),
		) as unknown as {
			_pricingKnown?: boolean;
			cost: { input: number; output: number };
			name: string;
		};
		expect(model._pricingKnown).toBe(false);
		expect(model.cost.input).toBe(0);
		expect(model.name).toBe("Brand New");
	});

	it("applies vision and reasoning metadata tables", () => {
		const vision = mapCommandCodeModel(
			catalogEntry({ id: "claude-opus-5", name: "Claude Opus 5" }),
		);
		expect(vision?.input).toEqual(["text", "image"]);
		expect(vision?.reasoning).toBe(true);

		const textOnly = mapCommandCodeModel(
			catalogEntry({
				id: "tencent/hy3-paid",
				name: "Tencent HY3",
				context_length: 262_144,
			}),
		);
		expect(textOnly?.input).toEqual(["text"]);
		expect(textOnly?.reasoning).toBe(true); // hy3-paid is in MODEL_REASONING
		expect(textOnly?.contextWindow).toBe(262_144);
	});

	it("falls back for entries missing context_length", () => {
		const model = mapCommandCodeModel(
			catalogEntry({ context_length: undefined }),
		);
		expect(model?.contextWindow).toBe(128_000);
		expect(model?.maxTokens).toBe(16_384);
	});

	it("returns undefined for unusable entries", () => {
		expect(mapCommandCodeModel(catalogEntry({ id: "" }))).toBeUndefined();
		expect(mapCommandCodeModel(catalogEntry({ id: undefined }))).toBeUndefined();
	});
});

describe("apiForCommandCodeModel", () => {
	it("routes claude-* models over Anthropic Messages and rest over OpenAI", () => {
		expect(apiForCommandCodeModel("claude-opus-5")).toBe("anthropic-messages");
		expect(apiForCommandCodeModel("gpt-5.6-sol")).toBe("openai-completions");
		expect(apiForCommandCodeModel("moonshotai/Kimi-K3")).toBe(
			"openai-completions",
		);
	});
});
