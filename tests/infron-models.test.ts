/**
 * Infron provider tests.
 *
 * Covers the catalog mapper (category filtering, USD-per-million min-price
 * conversion, modality casing, reasoning heuristics) against the live
 * OneRouter gateway schema.
 */

import { describe, expect, it } from "vitest";

import { mapInfronModel } from "../providers/infron/infron-models.ts";

function catalogEntry(overrides: Record<string, unknown> = {}) {
	return {
		id: "moonshotai/kimi-k2.6:free",
		object: "model",
		created: 1_626_777_600,
		model_id: "moonshotai/kimi-k2.6:free",
		canonical_slug: "moonshotai/kimi-k2.6:free",
		display_name: "Moonshot: Kimi K2.6 (free)",
		category_type: "LLM",
		is_display_only: false,
		deprecated: false,
		context_length: 256_000,
		max_output_tokens: 65_536,
		min_prompt_price: 0,
		min_completion_price: 0,
		input_modalities: ["text"],
		output_modalities: ["text"],
		supports_streaming: true,
		supports_vision: false,
		supported_endpoint_types: ["openai"],
		...overrides,
	};
}

describe("mapInfronModel", () => {
	it("maps a zero-priced free model", () => {
		const model = mapInfronModel(catalogEntry());
		expect(model).toBeDefined();
		expect(model?.id).toBe("moonshotai/kimi-k2.6:free");
		expect(model?.name).toBe("Moonshot: Kimi K2.6 (free)");
		expect(model?.cost.input).toBe(0);
		expect(model?.cost.output).toBe(0);
		expect(model?.contextWindow).toBe(256_000);
		expect(model?.maxTokens).toBe(65_536);
	});

	it("converts per-million USD min prices to per-token cost", () => {
		const model = mapInfronModel(
			catalogEntry({
				id: "google/gemini-3.1-flash-lite",
				display_name: "Google: Gemini 3.1 Flash-Lite",
				min_prompt_price: 0.125,
				min_completion_price: 0.75,
			}),
		);
		// Live-verified unit: catalog reports USD per million tokens
		// (0.125/0.75 matches Google's list pricing for this model).
		expect(model?.cost.input).toBeCloseTo(0.125e-6, 12);
		expect(model?.cost.output).toBeCloseTo(0.75e-6, 12);
		expect(model?.cost.cacheRead).toBe(0);
		expect(model?.cost.cacheWrite).toBe(0);
		expect(
			(model as unknown as { _pricingKnown?: boolean })._pricingKnown,
		).toBe(true);
	});

	it("flags vision models from input modalities regardless of casing", () => {
		const model = mapInfronModel(
			catalogEntry({ input_modalities: ["image", "text"] }),
		);
		expect(model?.input).toEqual(["text", "image"]);
		const mixedCase = mapInfronModel(
			catalogEntry({ input_modalities: ["Image", "Text"] }),
		);
		expect(mixedCase?.input).toEqual(["text", "image"]);
	});

	it("marks known reasoning families via the heuristic detector", () => {
		const kimi = mapInfronModel(catalogEntry());
		expect(kimi?.reasoning).toBe(true); // id contains "kimi"
		const plain = mapInfronModel(
			catalogEntry({
				id: "google/gemini-3.1-flash-lite",
				display_name: "Google: Gemini 3.1 Flash-Lite",
			}),
		);
		expect(plain?.reasoning).toBe(false);
	});

	it("rejects non-LLM categories and display-only placeholders", () => {
		expect(
			mapInfronModel(catalogEntry({ category_type: "Embeddings" })),
		).toBeUndefined();
		expect(
			mapInfronModel(catalogEntry({ category_type: "Text to Image" })),
		).toBeUndefined();
		expect(
			mapInfronModel(catalogEntry({ category_type: "Reranker" })),
		).toBeUndefined();
		expect(
			mapInfronModel(catalogEntry({ is_display_only: true })),
		).toBeUndefined();
	});

	it("returns undefined for unusable entries and applies fallbacks", () => {
		expect(mapInfronModel(catalogEntry({ id: "" }))).toBeUndefined();
		const bare = mapInfronModel(
			catalogEntry({
				id: "vendor/model",
				display_name: undefined,
				context_length: undefined,
				max_output_tokens: undefined,
				input_modalities: undefined,
			}),
		);
		expect(bare).toBeDefined();
		expect(bare?.name).toBe("vendor/model");
		expect(bare?.contextWindow).toBe(128_000);
		expect(bare?.maxTokens).toBe(4_096);
		expect(bare?.input).toEqual(["text"]);
	});
});
