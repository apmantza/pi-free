import { describe, it, expect } from "vitest";
import { isFreeModel } from "../lib/registry.ts";

describe("TokenRouter free model detection", () => {
	const freeModel = {
		id: "MiniMax-M3",
		name: "MiniMax-M3",
		reasoning: false,
		input: ["text" as const],
		contextWindow: 128_000,
		maxTokens: 16_384,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		_freeKnown: true as const,
		_isFree: true as const,
		_pricingKnown: false,
	};
	const freeSuffixModel = {
		id: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
		name: "Nemotron :free",
		reasoning: false,
		input: ["text" as const],
		contextWindow: 128_000,
		maxTokens: 16_384,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		_pricingKnown: false,
	};
	const paidModel = {
		id: "openai/gpt-5.4-nano",
		name: "GPT 5.4 Nano",
		reasoning: false,
		input: ["text" as const],
		contextWindow: 128_000,
		maxTokens: 16_384,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		_pricingKnown: false,
	};

	const allModels = [freeModel, freeSuffixModel, paidModel];

	it("detects MiniMax-M3 as free (known-free list)", () => {
		expect(
			isFreeModel({ ...freeModel, provider: "tokenrouter" }, allModels),
		).toBe(true);
	});

	it("detects :free suffix models as free (name-based Route B)", () => {
		expect(
			isFreeModel({ ...freeSuffixModel, provider: "tokenrouter" }, allModels),
		).toBe(true);
	});

	it("detects regular models as not free", () => {
		expect(
			isFreeModel({ ...paidModel, provider: "tokenrouter" }, allModels),
		).toBe(false);
	});
});
