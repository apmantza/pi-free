/**
 * Usage Tracking Tests
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
	getModelUsage,
	getProviderModelUsage,
	getSessionUsage,
	getTopModels,
	incrementModelRequestCount,
	resetUsageStats,
} from "../usage/tracking.ts";

describe("Usage Tracking", () => {
	beforeEach(() => {
		resetUsageStats();
	});

	describe("incrementModelRequestCount", () => {
		it("should track model requests", () => {
			incrementModelRequestCount("kilo", "gpt-4", 100, 50);

			const usage = getModelUsage("kilo", "gpt-4");
			expect(usage).toBeDefined();
			expect(usage?.count).toBe(1);
			expect(usage?.tokensIn).toBe(100);
			expect(usage?.tokensOut).toBe(50);
		});

		it("should accumulate multiple requests", () => {
			incrementModelRequestCount("kilo", "gpt-4", 100, 50);
			incrementModelRequestCount("kilo", "gpt-4", 200, 100);

			const usage = getModelUsage("kilo", "gpt-4");
			expect(usage?.count).toBe(2);
			expect(usage?.tokensIn).toBe(300);
			expect(usage?.tokensOut).toBe(150);
		});

		it("should track different models separately", () => {
			incrementModelRequestCount("kilo", "gpt-4", 100, 50);
			incrementModelRequestCount("kilo", "claude-3", 200, 100);

			expect(getModelUsage("kilo", "gpt-4")?.count).toBe(1);
			expect(getModelUsage("kilo", "claude-3")?.count).toBe(1);
		});

		it("should track different providers separately", () => {
			incrementModelRequestCount("kilo", "gpt-4", 100, 50);
			incrementModelRequestCount("openrouter", "gpt-4", 200, 100);

			expect(getModelUsage("kilo", "gpt-4")?.count).toBe(1);
			expect(getModelUsage("openrouter", "gpt-4")?.count).toBe(1);
		});
	});

	describe("getProviderModelUsage", () => {
		it("should return all models for provider", () => {
			incrementModelRequestCount("kilo", "model-a", 100, 50);
			incrementModelRequestCount("kilo", "model-b", 200, 100);
			incrementModelRequestCount("openrouter", "model-c", 300, 150);

			const kiloModels = getProviderModelUsage("kilo");
			expect(kiloModels).toHaveLength(2);
			expect(kiloModels.map((m) => m.modelId)).toContain("model-a");
			expect(kiloModels.map((m) => m.modelId)).toContain("model-b");
		});

		it("should sort by count descending", () => {
			incrementModelRequestCount("kilo", "popular", 100, 50);
			incrementModelRequestCount("kilo", "popular", 100, 50);
			incrementModelRequestCount("kilo", "popular", 100, 50);
			incrementModelRequestCount("kilo", "unpopular", 100, 50);

			const models = getProviderModelUsage("kilo");
			expect(models[0].modelId).toBe("popular");
			expect(models[0].count).toBe(3);
		});
	});

	describe("getTopModels", () => {
		it("should return top N models across providers", () => {
			// Add many models
			for (let i = 0; i < 5; i++) {
				incrementModelRequestCount("kilo", `kilo-model-${i}`, 100, 50);
			}
			for (let i = 0; i < 5; i++) {
				incrementModelRequestCount("openrouter", `or-model-${i}`, 100, 50);
			}

			const top5 = getTopModels(5);
			expect(top5).toHaveLength(5);
		});

		it("should sort by total count", () => {
			incrementModelRequestCount("kilo", "high-usage", 100, 50);
			incrementModelRequestCount("kilo", "high-usage", 100, 50);
			incrementModelRequestCount("kilo", "high-usage", 100, 50);
			incrementModelRequestCount("kilo", "low-usage", 100, 50);

			const top = getTopModels(2);
			expect(top[0].modelId).toBe("high-usage");
			expect(top[0].count).toBe(3);
		});
	});

	describe("getSessionUsage", () => {
		it("should return session stats", () => {
			incrementModelRequestCount("kilo", "gpt-4", 1000, 500);
			incrementModelRequestCount("openrouter", "claude", 2000, 1000);

			const session = getSessionUsage();
			expect(session.totalRequests).toBe(2);
			expect(session.totalTokensIn).toBe(3000);
			expect(session.totalTokensOut).toBe(1500);
			expect(session.providers).toHaveLength(2);
		});

		it("should format duration", () => {
			const session = getSessionUsage();
			expect(session.duration).toBeGreaterThanOrEqual(0);
			expect(typeof session.durationFormatted).toBe("string");
		});

		it("should sort providers by request count", () => {
			incrementModelRequestCount("kilo", "model", 100, 50);
			incrementModelRequestCount("kilo", "model", 100, 50);
			incrementModelRequestCount("kilo", "model", 100, 50);
			incrementModelRequestCount("openrouter", "model", 100, 50);

			const session = getSessionUsage();
			expect(session.providers[0].name).toBe("kilo");
			expect(session.providers[0].requests).toBe(3);
		});
	});

	describe("resetUsageStats", () => {
		it("should clear all stats", () => {
			incrementModelRequestCount("kilo", "gpt-4", 100, 50);
			resetUsageStats();

			const usage = getModelUsage("kilo", "gpt-4");
			expect(usage).toBeUndefined();

			const session = getSessionUsage();
			expect(session.totalRequests).toBe(0);
		});
	});
});
