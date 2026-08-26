/**
 * Merge provider tests.
 *
 * Covers the catalog mapper against the live Merge Gateway
 * (api-gateway.merge.dev/v1/openai) schema: minimal OpenAI-standard entries
 * (id/object/created/owned_by only — no pricing, context, or modality
 * fields), id-based non-chat filtering, and documented fallbacks.
 */

import { describe, expect, it } from "vitest";

import { mapMergeModel } from "../providers/merge/merge-models.ts";

function catalogEntry(overrides: Record<string, unknown> = {}) {
	return {
		id: "openai/gpt-4.1-nano",
		object: "model",
		created: 1_787_731_811,
		owned_by: "openai",
		...overrides,
	};
}

describe("mapMergeModel", () => {
	it("maps a minimal OpenAI-standard entry with documented fallbacks", () => {
		const model = mapMergeModel(catalogEntry());
		expect(model).toBeDefined();
		expect(model?.id).toBe("openai/gpt-4.1-nano");
		expect(model?.name).toBe("openai/gpt-4.1-nano");
		// Live-verified schema: the catalog exposes no pricing, so costs map to
		// zero WITHOUT the _pricingKnown stamp (Route B detection stays in
		// charge) — per-request USD-per-token cost only appears in chat usage.
		expect(model?.cost.input).toBe(0);
		expect(model?.cost.output).toBe(0);
		expect(model?.cost.cacheRead).toBe(0);
		expect(model?.cost.cacheWrite).toBe(0);
		expect(
			(model as unknown as { _pricingKnown?: boolean })._pricingKnown,
		).toBeUndefined();
	});

	it("applies fallback context window and max output tokens", () => {
		const model = mapMergeModel(catalogEntry());
		// The catalog omits context/output data entirely (no fields exist to
		// read), so the documented fallbacks always apply.
		expect(model?.contextWindow).toBe(128_000);
		expect(model?.maxTokens).toBe(4_096);
		expect(model?.input).toEqual(["text"]);
	});

	it("marks known reasoning families via the heuristic detector", () => {
		const reasoning = mapMergeModel(
			catalogEntry({ id: "deepseek/deepseek-reasoner" }),
		);
		expect(reasoning?.reasoning).toBe(true);
		const thinking = mapMergeModel(
			catalogEntry({ id: "qwen/qwen3.7-max-thinking" }),
		);
		expect(thinking?.reasoning).toBe(true);
		const plain = mapMergeModel(catalogEntry());
		expect(plain?.reasoning).toBe(false);
	});

	it("rejects known non-chat ids (embeddings, transcription, image, classifiers)", () => {
		expect(
			mapMergeModel(catalogEntry({ id: "google/gemini-embedding-001" })),
		).toBeUndefined();
		expect(
			mapMergeModel(catalogEntry({ id: "whisper-1" })),
		).toBeUndefined();
		expect(
			mapMergeModel(catalogEntry({ id: "google/gemini-3-pro-image" })),
		).toBeUndefined();
		expect(
			mapMergeModel(catalogEntry({ id: "google/gemini-2.5-flash-image" })),
		).toBeUndefined();
		expect(
			mapMergeModel(catalogEntry({ id: "openai/gpt-oss-safeguard-120b" })),
		).toBeUndefined();
	});

	it("keeps chat models whose ids merely mention filtered words elsewhere", () => {
		// Conservative pattern: only matches the non-chat tokens themselves.
		const kept = mapMergeModel(
			catalogEntry({ id: "anthropic/claude-opus-4-6" }),
		);
		expect(kept).toBeDefined();
	});

	it("returns undefined for unusable entries", () => {
		expect(mapMergeModel(catalogEntry({ id: "" }))).toBeUndefined();
		expect(mapMergeModel(catalogEntry({ id: undefined }))).toBeUndefined();
		expect(mapMergeModel(catalogEntry({ id: 42 }))).toBeUndefined();
	});
});
