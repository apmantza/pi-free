import { describe, expect, it } from "vitest";
import {
	estimateCapability,
	generateCapabilityMessage,
	getMinimumAcceptableTier,
	isCapabilityDowngrade,
	type ModelCapabilities,
	rankByCapability,
} from "../provider-failover/capability-ranking.ts";
import type { ProviderModelConfig } from "../types.ts";

describe("Capability Ranking", () => {
	describe("estimateCapability", () => {
		it("should estimate capability from model features", () => {
			const model = {
				id: "gpt-4",
				name: "GPT-4",
				reasoning: true,
				input: ["text"],
				cost: { input: 30, output: 60, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128000,
				maxTokens: 4096,
			} as ProviderModelConfig;

			const capabilities = estimateCapability(model);

			expect(capabilities.tier).toBeDefined();
			expect(capabilities.score).toBeGreaterThan(0);
		});

		it("should assign higher score to models with reasoning", () => {
			const reasoningModel = {
				id: "gpt-4",
				name: "GPT-4",
				reasoning: true,
				input: ["text"],
				cost: { input: 30, output: 60, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128000,
				maxTokens: 4096,
			} as ProviderModelConfig;

			const nonReasoningModel = {
				id: "gpt-3.5",
				name: "GPT-3.5",
				reasoning: false,
				input: ["text"],
				cost: { input: 0.5, output: 1.5, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 16384,
				maxTokens: 4096,
			} as ProviderModelConfig;

			const reasoningCaps = estimateCapability(reasoningModel);
			const nonReasoningCaps = estimateCapability(nonReasoningModel);

			expect(reasoningCaps.score).toBeGreaterThan(nonReasoningCaps.score);
		});

		it("should consider context window size", () => {
			const largeContext = {
				id: "claude-3",
				name: "Claude 3",
				reasoning: true,
				input: ["text"],
				cost: { input: 15, output: 75, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 200000,
				maxTokens: 4096,
			} as ProviderModelConfig;

			const smallContext = {
				id: "small-model",
				name: "Small Model",
				reasoning: false,
				input: ["text"],
				cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 4096,
				maxTokens: 2048,
			} as ProviderModelConfig;

			const largeCaps = estimateCapability(largeContext);
			const smallCaps = estimateCapability(smallContext);

			expect(largeCaps.score).toBeGreaterThan(smallCaps.score);
		});
	});

	describe("rankByCapability", () => {
		it("should categorize alternatives by capability", () => {
			const currentModel = {
				id: "gpt-4",
				name: "GPT-4",
				reasoning: true,
				input: ["text"],
				cost: { input: 30, output: 60, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128000,
				maxTokens: 4096,
			} as ProviderModelConfig;

			const alternatives = [
				{
					id: "better-model",
					name: "Better Model",
					reasoning: true,
					input: ["text"] as ["text"],
					cost: { input: 20, output: 40, cacheRead: 0, cacheWrite: 0 },
					contextWindow: 256000,
					maxTokens: 8192,
					provider: "openrouter",
				},
				{
					id: "worse-model",
					name: "Worse Model",
					reasoning: false,
					input: ["text"] as ["text"],
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					contextWindow: 4096,
					maxTokens: 2048,
					provider: "kilo",
				},
			] as Array<ProviderModelConfig & { provider?: string }>;

			const result = rankByCapability(currentModel, alternatives);

			expect(result.equalOrBetter).toBeDefined();
			expect(result.minorDowngrade).toBeDefined();
			expect(result.majorDowngrade).toBeDefined();
		});
	});

	describe("isCapabilityDowngrade", () => {
		it("should detect downgrade from high capability to low", () => {
			// Explicitly construct capabilities to test the downgrade logic
			// without relying on heuristic estimation
			const from: ModelCapabilities = {
				tier: "high",
				score: 70,
				contextWindow: 128000,
				reasoning: true,
				hasVision: false,
			};

			const to: ModelCapabilities = {
				tier: "low",
				score: 30,
				contextWindow: 4096,
				reasoning: false,
				hasVision: false,
			};

			const result = isCapabilityDowngrade(from, to);
			expect(result.isDowngrade).toBe(true);
			expect(result.severity).toBe("major");
		});

		it("should not flag same capability as downgrade", () => {
			const model = {
				id: "test",
				name: "Test",
				reasoning: true,
				input: ["text"],
				cost: { input: 15, output: 30, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 64000,
				maxTokens: 4096,
			} as ProviderModelConfig;

			const caps = estimateCapability(model);
			const result = isCapabilityDowngrade(caps, caps);

			expect(result.isDowngrade).toBe(false);
		});
	});

	describe("getMinimumAcceptableTier", () => {
		it("should return one tier lower than current", () => {
			expect(getMinimumAcceptableTier("ultra")).toBe("high");
			expect(getMinimumAcceptableTier("high")).toBe("medium");
			expect(getMinimumAcceptableTier("medium")).toBe("low");
			expect(getMinimumAcceptableTier("low")).toBe("minimal");
		});

		it("should return minimal for minimal tier", () => {
			expect(getMinimumAcceptableTier("minimal")).toBe("minimal");
		});
	});

	describe("generateCapabilityMessage", () => {
		it("should generate upgrade message", () => {
			const current = {
				name: "Current Model",
				capabilities: estimateCapability({
					id: "current",
					name: "Current",
					reasoning: false,
					input: ["text"],
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					contextWindow: 4096,
					maxTokens: 2048,
				} as ProviderModelConfig),
			};

			const target = {
				name: "Better Model",
				capabilities: estimateCapability({
					id: "target",
					name: "Target",
					reasoning: true,
					input: ["text"],
					cost: { input: 30, output: 60, cacheRead: 0, cacheWrite: 0 },
					contextWindow: 128000,
					maxTokens: 4096,
				} as ProviderModelConfig),
			};

			const message = generateCapabilityMessage(current, target);
			expect(message).toContain("Upgrade");
		});

		it("should generate downgrade message", () => {
			const current = {
				name: "Current Model",
				capabilities: {
					tier: "high" as CapabilityTier,
					score: 70,
					contextWindow: 128000,
					reasoning: true,
					hasVision: false,
				},
			};

			const target = {
				name: "Worse Model",
				capabilities: {
					tier: "low" as CapabilityTier,
					score: 30,
					contextWindow: 4096,
					reasoning: false,
					hasVision: false,
				},
			};

			const message = generateCapabilityMessage(current, target);
			expect(message).toContain("downgrade");
		});
	});
});
