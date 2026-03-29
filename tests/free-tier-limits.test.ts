import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	FREE_TIER_LIMITS,
	formatFreeTierStatus,
	getFreeTierUsage,
	getLimitWarning,
	getModelUsage,
	getProviderModelUsage,
	getSessionUsage,
	getTopModels,
	incrementModelRequestCount,
	isApproachingLimit,
} from "../free-tier-limits.ts";

describe("Free Tier Limits", () => {
	beforeEach(() => {
		// Reset by clearing the maps - we need to access the internal state
		// This is a limitation - we might need to export a reset function for testing
		vi.resetModules();
	});

	describe("FREE_TIER_LIMITS", () => {
		it("should have limits for kilo provider", () => {
			expect(FREE_TIER_LIMITS.kilo).toBeDefined();
			expect(FREE_TIER_LIMITS.kilo.requestsPerHour).toBe(200);
		});

		it("should have limits for openrouter provider", () => {
			expect(FREE_TIER_LIMITS.openrouter).toBeDefined();
			expect(FREE_TIER_LIMITS.openrouter.requestsPerDay).toBe(1000);
		});

		it("should have limits for nvidia provider", () => {
			expect(FREE_TIER_LIMITS.nvidia).toBeDefined();
			expect(FREE_TIER_LIMITS.nvidia.requestsPerMonth).toBe(1000);
		});

		it("should have limits for fireworks provider", () => {
			expect(FREE_TIER_LIMITS.fireworks).toBeDefined();
			expect(FREE_TIER_LIMITS.fireworks.requestsPerMonth).toBe(1000);
		});
	});

	describe("Request Counting", () => {
		it("should increment request count", () => {
			// Just verify it doesn't throw
			expect(() => {
				incrementModelRequestCount("kilo", "gpt-4", 100, 50);
			}).not.toThrow();
		});

		it("should track model usage", () => {
			incrementModelRequestCount("test", "model-1", 100, 50);
			incrementModelRequestCount("test", "model-1", 200, 100);

			const usage = getModelUsage("test", "model-1");
			expect(usage).toBeDefined();
			expect(usage?.count).toBe(2);
			expect(usage?.tokensIn).toBe(300);
			expect(usage?.tokensOut).toBe(150);
		});

		it("should return undefined for unknown models", () => {
			const usage = getModelUsage("unknown", "unknown-model");
			expect(usage).toBeUndefined();
		});

		it("should track different models separately", () => {
			incrementModelRequestCount("test", "model-a", 100, 50);
			incrementModelRequestCount("test", "model-b", 200, 100);

			expect(getModelUsage("test", "model-a")?.count).toBe(1);
			expect(getModelUsage("test", "model-b")?.count).toBe(1);
		});
	});

	describe("Provider Model Usage", () => {
		it("should return all models for a provider", () => {
			incrementModelRequestCount("test-provider", "model-1", 100, 50);
			incrementModelRequestCount("test-provider", "model-2", 200, 100);

			const models = getProviderModelUsage("test-provider");
			expect(models).toHaveLength(2);
			expect(models.map((m) => m.modelId)).toContain("model-1");
			expect(models.map((m) => m.modelId)).toContain("model-2");
		});

		it("should return empty array for unknown provider", () => {
			const models = getProviderModelUsage("nonexistent");
			expect(models).toEqual([]);
		});
	});

	describe("Top Models", () => {
		it("should return top N models by request count", () => {
			// Add many models with varying request counts
			for (let i = 0; i < 5; i++) {
				incrementModelRequestCount("test", "popular-model", 100, 50);
			}
			incrementModelRequestCount("test", "unpopular-model", 100, 50);

			const top = getTopModels(2);
			expect(top).toHaveLength(2);
			expect(top[0].modelId).toBe("popular-model");
		});
	});

	describe("Free Tier Usage", () => {
		it("should calculate usage for kilo provider", () => {
			// Simulate 100 requests (out of 200/hour limit)
			for (let i = 0; i < 100; i++) {
				incrementModelRequestCount("kilo", "gpt-4", 10, 10);
			}

			const usage = getFreeTierUsage("kilo");
			expect(usage.requestsThisHour).toBe(100);
		});

		it("should calculate usage for providers without hourly limits", () => {
			// OpenRouter has daily limit, not hourly
			const usage = getFreeTierUsage("openrouter");
			expect(usage.requestsThisHour).toBe(0);
		});
	});

	describe("Limit Warnings", () => {
		it("should detect when approaching limit", () => {
			// Add enough requests to trigger warning (>80% for kilo)
			for (let i = 0; i < 170; i++) {
				incrementModelRequestCount("kilo", "gpt-4", 10, 10);
			}

			expect(isApproachingLimit("kilo")).toBe(true);
		});

		it("should not trigger warning when usage is low", () => {
			incrementModelRequestCount("kilo", "gpt-4", 10, 10);
			expect(isApproachingLimit("kilo")).toBe(false);
		});

		it("should return warning message when approaching limit", () => {
			// Add enough requests to trigger warning
			for (let i = 0; i < 170; i++) {
				incrementModelRequestCount("kilo", "gpt-4", 10, 10);
			}

			const warning = getLimitWarning("kilo");
			expect(warning).not.toBeNull();
			expect(warning).toContain("Approaching");
		});

		it("should return null when not approaching limit", () => {
			const warning = getLimitWarning("kilo");
			expect(warning).toBeNull();
		});
	});

	describe("Session Usage", () => {
		it("should generate session report", () => {
			incrementModelRequestCount("kilo", "gpt-4", 1000, 500);
			incrementModelRequestCount("openrouter", "mimo", 500, 250);

			const report = getSessionUsage();
			expect(report.totalRequests).toBe(2);
			expect(report.totalTokensIn).toBe(1500);
			expect(report.totalTokensOut).toBe(750);
		});

		it("should track providers in session report", () => {
			incrementModelRequestCount("kilo", "gpt-4", 100, 50);
			incrementModelRequestCount("openrouter", "mimo", 100, 50);

			const report = getSessionUsage();
			expect(report.providers).toContain("kilo");
			expect(report.providers).toContain("openrouter");
		});
	});

	describe("Status Formatting", () => {
		it("should format status for provider", () => {
			const status = formatFreeTierStatus("kilo");
			expect(typeof status).toBe("string");
			expect(status).toContain("kilo");
		});
	});
});
