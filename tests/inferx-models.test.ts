/**
 * InferX catalog tests.
 *
 * InferX's `/endpoints/v1/models` is vLLM-shaped: ids only, no pricing,
 * context, or capability metadata. These tests pin the three rules the
 * provider adds on top of the shared OpenAI-compatible fetcher:
 *
 *   1. Non-chat endpoints (the embedding model) are dropped.
 *   2. `-no-thinking` variants are not classified by the reasoning-family
 *      heuristic even though their id contains the literal "thinking".
 *   3. The no-pricing stamp keeps a zero-cost entry out of the free view.
 *
 * models.dev enrichment is stubbed out (it is a network call and its values
 * are not this provider's rules); every assertion reads the fallback shape.
 */

import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/model-metadata.ts", () => ({
	safeEnrichModelsWithModelsDev: async <T>(models: T) => models,
}));

import { isFreeModel } from "../lib/registry.ts";
import {
	fetchInferxModels,
	isInferxChatModel,
	isInferxReasoningModel,
} from "../providers/inferx/inferx-models.ts";

/** One vLLM-shaped catalog row, exactly as `/endpoints/v1/models` returns it. */
function entry(id: string) {
	return { id, object: "model", created: 1_766_000_000, owned_by: "inferx" };
}

function stubModels(data: unknown[], status = 200) {
	vi.stubGlobal(
		"fetch",
		vi.fn(
			async () =>
				new Response(JSON.stringify({ object: "list", data }), {
					status,
					statusText: status === 200 ? "OK" : "Server Error",
				}),
		),
	);
}

describe("InferX model mapping", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("maps an id-only catalog row with conservative fallbacks", async () => {
		stubModels([entry("deepseek-v4-flash")]);

		const [model] = await fetchInferxModels("ix-test");

		expect(model).toMatchObject({
			id: "deepseek-v4-flash",
			name: "deepseek-v4-flash",
			reasoning: true,
			input: ["text"],
			contextWindow: 128_000,
			maxTokens: 16_384,
			_pricingKnown: false,
		});
		expect(model?.cost).toMatchObject({
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
		});
		expect(model?.name).not.toContain("(InferX)");
	});

	it("drops the embedding endpoint published beside the chat models", async () => {
		stubModels([
			entry("Qwen3-Coder-Next-FP8"),
			entry("Qwen3-Embedding-8B"),
			entry("rerank-v1"),
		]);

		const models = await fetchInferxModels("ix-test");

		expect(models.map((model) => model.id)).toEqual(["Qwen3-Coder-Next-FP8"]);
	});

	it("returns an empty catalog when the endpoint fails", async () => {
		stubModels([], 500);

		await expect(fetchInferxModels("ix-test")).resolves.toEqual([]);
	});
});

describe("InferX endpoint predicates", () => {
	it("treats embedding and rerank ids as non-chat", () => {
		expect(isInferxChatModel("Qwen3-Embedding-8B")).toBe(false);
		expect(isInferxChatModel("bge-rerank-1")).toBe(false);
		expect(isInferxChatModel("Agents-A1")).toBe(true);
		expect(isInferxChatModel("gemma-4-31B-it-fp8")).toBe(true);
	});

	it("keeps the -no-thinking variant out of the reasoning-family match", () => {
		// Live ids: the thinking variant is flagged reasoning, the
		// -no-thinking variant is not (verified against models.dev metadata).
		expect(
			isInferxReasoningModel({ id: "Qwen3.6-35B-A3B-fp8-no-thinking" }),
		).toBe(false);
		expect(isInferxReasoningModel({ id: "deepseek-v4-flash" })).toBe(true);
	});
});

describe("InferX free classification", () => {
	it("does not leak a priceless entry into the free view", async () => {
		// Route A is active for this catalog because a sibling carries a real
		// price; without the `_pricingKnown: false` stamp the zero-cost InferX
		// entry would classify free on its fabricated $0.
		const priced: ProviderModelConfig = {
			id: "priced/model",
			name: "priced/model",
			input: ["text"],
			cost: { input: 1e-6, output: 2e-6, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 8_192,
			maxTokens: 1_024,
			reasoning: false,
		};
		stubModels([entry("deepseek-v4-flash")]);

		const [inferxModel] = await fetchInferxModels("ix-test");
		const all = [priced, inferxModel!];

		expect(isFreeModel({ ...priced, provider: "inferx" }, all)).toBe(false);
		expect(isFreeModel({ ...inferxModel!, provider: "inferx" }, all)).toBe(
			false,
		);
		// Guard is the stamp itself: the same entry without it is "free".
		expect(
			isFreeModel(
				{ ...inferxModel!, provider: "inferx", _pricingKnown: undefined },
				all,
			),
		).toBe(true);
	});
});
