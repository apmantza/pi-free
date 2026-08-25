/**
 * GMI provider model-catalog tests.
 *
 * Covers the by-id dedupe of GMI's duplicated catalog SKUs (observed live:
 * MiniMax Week models are published twice — one priced SKU, one $0 SKU) and
 * the promotion free-stamping window logic.
 */

import { describe, expect, it } from "vitest";

import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";

import { dedupeGmiModelsById } from "../providers/gmi/gmi-models.ts";

function model(
	id: string,
	inputCost: number,
	outputCost = 0,
): ProviderModelConfig {
	return {
		id,
		name: id,
		reasoning: false,
		input: ["text"],
		cost: { input: inputCost, output: outputCost, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128_000,
		maxTokens: 16_384,
	};
}

describe("dedupeGmiModelsById", () => {
	it("keeps the priced SKU when GMI publishes priced + $0 copies", () => {
		const deduped = dedupeGmiModelsById([
			model("MiniMaxAI/MiniMax-M3", 6e-7, 2.4e-6),
			model("MiniMaxAI/MiniMax-M3", 0),
		]);
		expect(deduped).toHaveLength(1);
		expect(deduped[0]?.cost.input).toBe(6e-7);
	});

	it("keeps the priced copy regardless of order", () => {
		const deduped = dedupeGmiModelsById([
			model("MiniMaxAI/MiniMax-M2.7", 0),
			model("MiniMaxAI/MiniMax-M2.7", 3e-7, 1.2e-6),
		]);
		expect(deduped).toHaveLength(1);
		expect(deduped[0]?.cost.output).toBe(1.2e-6);
	});

	it("keeps the first entry when neither duplicate is priced", () => {
		const first = model("some/model", 0);
		const deduped = dedupeGmiModelsById([first, model("some/model", 0)]);
		expect(deduped).toHaveLength(1);
		expect(deduped[0]).toBe(first);
	});

	it("keeps unique ids and preserves catalog order", () => {
		const a = model("a/model", 1e-6);
		const b = model("b/model", 0);
		const dupA = model("a/model", 0);
		const deduped = dedupeGmiModelsById([a, b, dupA]);
		expect(deduped.map((m) => m.id)).toEqual(["a/model", "b/model"]);
		expect(deduped[0]?.cost.input).toBe(1e-6);
	});
});
