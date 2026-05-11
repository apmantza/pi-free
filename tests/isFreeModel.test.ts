/**
 * isFreeModel unit tests
 *
 * Tests the real implementation with strict Route A/B separation:
 * - Route A (pricing-exposed): Cost-based only, no name fallback
 * - Route B (non-pricing-exposed): Name-based only, no cost fallback
 */

import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { isFreeModel } from "../lib/registry.ts";

// Helper to create a test model
function createModel(
	name: string,
	costInputOutput: { input: number; output: number },
): ProviderModelConfig {
	return {
		id: "test-model",
		name,
		reasoning: false,
		input: ["text"],
		cost: {
			input: costInputOutput.input,
			output: costInputOutput.output,
			cacheRead: 0,
			cacheWrite: 0,
		},
		contextWindow: 4096,
		maxTokens: 2048,
	};
}

describe("isFreeModel - Route A (pricing-exposed providers)", () => {
	const pricingExposedProviders = ["openrouter", "opencode", "kilo", "cline"];

	it.each(
		pricingExposedProviders,
	)("%s: returns true when cost is zero", (provider) => {
		const model = createModel("Some Model", { input: 0, output: 0 });
		expect(isFreeModel({ ...model, provider })).toBe(true);
	});

	it.each(
		pricingExposedProviders,
	)("%s: returns false when input cost > 0", (provider) => {
		const model = createModel("Some Model", { input: 1, output: 0 });
		expect(isFreeModel({ ...model, provider })).toBe(false);
	});

	it.each(
		pricingExposedProviders,
	)("%s: returns false when output cost > 0", (provider) => {
		const model = createModel("Some Model", { input: 0, output: 1 });
		expect(isFreeModel({ ...model, provider })).toBe(false);
	});

	it.each(
		pricingExposedProviders,
	)("%s: returns true if name contains 'free' even when cost > 0 (OR logic)", (provider) => {
		const model = createModel("Something Free", { input: 1, output: 1 });
		expect(isFreeModel({ ...model, provider })).toBe(true);
	});

	it.each(
		pricingExposedProviders,
	)("%s: returns true when cost is zero even if name does NOT contain 'free'", (provider) => {
		const model = createModel("GPT-4", { input: 0, output: 0 });
		expect(isFreeModel({ ...model, provider })).toBe(true);
	});

	it.each(
		pricingExposedProviders,
	)("%s: returns false when cost > 0 AND name does NOT contain 'free'", (provider) => {
		const model = createModel("GPT-4 Paid", { input: 1, output: 1 });
		expect(isFreeModel({ ...model, provider })).toBe(false);
	});
});

describe("isFreeModel - Route B (non-pricing-exposed providers)", () => {
	const nonPricingProviders = [
		"nvidia",
		"ollama",
		"cloudflare",
		"mistral",
		"groq",
		"cerebras",
		"xai",
		"huggingface",
		"some-new-provider",
	];

	it.each(
		nonPricingProviders,
	)("%s: returns true when name contains 'free' (case insensitive)", (provider) => {
		const model = createModel("Llama Free Edition", { input: 1, output: 1 });
		// Pass allModels with all costs === 0 to trigger Route B (name-based)
		const allModels = [createModel("Model A", { input: 0, output: 0 })];
		expect(isFreeModel({ ...model, provider }, allModels)).toBe(true);
	});

	it.each(
		nonPricingProviders,
	)("%s: returns false when name does NOT contain 'free' even if cost is 0", (provider) => {
		const model = createModel("GPT-4", { input: 0, output: 0 });
		// Pass allModels with all costs === 0 to trigger Route B (name-based)
		const allModels = [createModel("Model A", { input: 0, output: 0 })];
		expect(isFreeModel({ ...model, provider }, allModels)).toBe(false);
	});

	it.each(
		nonPricingProviders,
	)("%s: returns false when cost > 0 and name doesn't contain 'free'", (provider) => {
		const model = createModel("GPT-4", { input: 2, output: 6 });
		// Pass allModels with all costs === 0 to trigger Route B (name-based)
		const allModels = [createModel("Model A", { input: 0, output: 0 })];
		expect(isFreeModel({ ...model, provider }, allModels)).toBe(false);
	});

	it("matches 'free' in various parts of the name", () => {
		const providers = ["nvidia", "mistral"];
		// Pass allModels with all costs === 0 to trigger Route B (name-based)
		const allModels = [createModel("Model A", { input: 0, output: 0 })];

		for (const provider of providers) {
			// "free" at the end
			expect(
				isFreeModel(
					{
						...createModel("Llama 3 Free", { input: 1, output: 1 }),
						provider,
					},
					allModels,
				),
			).toBe(true);

			// "free" at the beginning
			expect(
				isFreeModel(
					{
						...createModel("Free Llama 3", { input: 1, output: 1 }),
						provider,
					},
					allModels,
				),
			).toBe(true);

			// "free" in the middle
			expect(
				isFreeModel(
					{
						...createModel("Llama Free 3", { input: 1, output: 1 }),
						provider,
					},
					allModels,
				),
			).toBe(true);

			// "Free" with capital F
			expect(
				isFreeModel(
					{
						...createModel("Llama FREE", { input: 1, output: 1 }),
						provider,
					},
					allModels,
				),
			).toBe(true);
		}
	});
});

describe("isFreeModel - freemium providers behavior", () => {
	it("nvidia: does NOT mark all models as free (strict Route B)", () => {
		const models = [
			createModel("Llama 3.1 70B", { input: 0, output: 0 }),
			createModel("Mistral Large", { input: 0, output: 0 }),
			createModel("DeepSeek V4", { input: 0, output: 0 }),
		];

		// None should be marked as free since none have "free" in name
		// Pass all models as allModels to trigger Route B detection
		const freeCount = models.filter((m) =>
			isFreeModel({ ...m, provider: "nvidia" }, models),
		).length;
		expect(freeCount).toBe(0);
	});

	it("ollama: does NOT mark all models as free (strict Route B)", () => {
		const models = [
			createModel("llama3.2", { input: 0, output: 0 }),
			createModel("mixtral", { input: 0, output: 0 }),
		];

		// Pass all models as allModels to trigger Route B detection
		const freeCount = models.filter((m) =>
			isFreeModel({ ...m, provider: "ollama" }, models),
		).length;
		expect(freeCount).toBe(0);
	});

	it("only models with 'free' in name are marked as free for non-pricing providers", () => {
		const models = [
			createModel("llama3.2", { input: 0, output: 0 }),
			createModel("llama3.2-free", { input: 0, output: 0 }),
			createModel("mixtral", { input: 0, output: 0 }),
		];

		// Pass all models as allModels to trigger Route B detection
		const freeModels = models.filter((m) =>
			isFreeModel({ ...m, provider: "nvidia" }, models),
		);
		expect(freeModels).toHaveLength(1);
		expect(freeModels[0].name).toBe("llama3.2-free");
	});
});

describe("isFreeModel - edge cases", () => {
	it("handles missing provider (undefined) using Route B", () => {
		const model = createModel("Some Free Model", { input: 0, output: 0 });
		expect(isFreeModel({ ...model, provider: undefined })).toBe(true);
	});

	it("handles empty provider name using Route B", () => {
		const model = createModel("Some Free Model", { input: 0, output: 0 });
		expect(isFreeModel({ ...model, provider: "" })).toBe(true);
	});

	it("handles missing cost for pricing-exposed provider (defaults to 0)", () => {
		const model = {
			id: "test",
			name: "Test Model",
			reasoning: false,
			input: ["text"],
			contextWindow: 4096,
			maxTokens: 2048,
		} as ProviderModelConfig; // No cost property

		expect(isFreeModel({ ...model, provider: "kilo" })).toBe(true);
	});

	it("handles missing cost for non-pricing provider (uses name)", () => {
		const model = {
			id: "test",
			name: "Free Model",
			reasoning: false,
			input: ["text"],
			contextWindow: 4096,
			maxTokens: 2048,
		} as ProviderModelConfig; // No cost property

		expect(isFreeModel({ ...model, provider: "nvidia" })).toBe(true);
	});
});

describe("isFreeModel - _pricingKnown guard (Route A)", () => {
	it("_pricingKnown=false + cost=0 + no 'free' in name = NOT free (missing pricing guarded)", () => {
		const model = createModel("GPT-4", { input: 0, output: 0 });
		// Simulate ZenMux models with missing pricing (e.g. deepseek-chat-v3.1)
		const allModels = [
			{ ...createModel("GPT-4o-mini", { input: 0.15, output: 0.6 }) },
		];
		expect(
			isFreeModel(
				{ ...model, provider: "zenmux", _pricingKnown: false },
				allModels,
			),
		).toBe(false);
	});

	it("_pricingKnown=false + cost=0 + 'free' in name = free (name-based escape)", () => {
		const model = createModel("Model Free Edition", { input: 0, output: 0 });
		const allModels = [
			{ ...createModel("GPT-4o-mini", { input: 0.15, output: 0.6 }) },
		];
		expect(
			isFreeModel(
				{ ...model, provider: "zenmux", _pricingKnown: false },
				allModels,
			),
		).toBe(true);
	});

	it("_pricingKnown=false + cost>0 + 'free' in name = free (name beats unknown pricing)", () => {
		const model = createModel("Free Tier Model", { input: 1, output: 1 });
		const allModels = [
			{ ...createModel("GPT-4o-mini", { input: 0.15, output: 0.6 }) },
		];
		expect(
			isFreeModel(
				{ ...model, provider: "opencode", _pricingKnown: false },
				allModels,
			),
		).toBe(true);
	});

	it("_pricingKnown=true + cost=0 = free (same as old OR logic)", () => {
		const model = createModel("Some Model", { input: 0, output: 0 });
		const allModels = [
			{ ...createModel("GPT-4o-mini", { input: 0.15, output: 0.6 }) },
		];
		expect(
			isFreeModel(
				{ ...model, provider: "openrouter", _pricingKnown: true },
				allModels,
			),
		).toBe(true);
	});

	it("_pricingKnown=true + cost>0 = NOT free (pricing authoritative)", () => {
		const model = createModel("Paid Model", { input: 1, output: 1 });
		const allModels = [
			{ ...createModel("GPT-4o-mini", { input: 0.15, output: 0.6 }) },
		];
		expect(
			isFreeModel(
				{ ...model, provider: "openrouter", _pricingKnown: true },
				allModels,
			),
		).toBe(false);
	});

	it("_pricingKnown=undefined + cost=0 = free (backward compatible — defaults to old OR)", () => {
		const model = createModel("GPT-4", { input: 0, output: 0 });
		const allModels = [
			{ ...createModel("GPT-4o-mini", { input: 0.15, output: 0.6 }) },
		];
		expect(
			isFreeModel(
				{ ...model, provider: "kilo", _pricingKnown: undefined },
				allModels,
			),
		).toBe(true);
	});

	it("_pricingKnown=undefined + cost>0 + 'free' in name = free (backward compatible OR)", () => {
		const model = createModel("Free Plan", { input: 5, output: 30 });
		const allModels = [
			{ ...createModel("GPT-4o-mini", { input: 0.15, output: 0.6 }) },
		];
		expect(
			isFreeModel(
				{ ...model, provider: "kilo", _pricingKnown: undefined },
				allModels,
			),
		).toBe(true);
	});
});
