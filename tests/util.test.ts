import { describe, expect, it, vi } from "vitest";
import {
	fetchWithRetry,
	fetchWithTimeout,
	isUsableModel,
	logWarning,
	mapOpenRouterModel,
	parseModelResponse,
} from "../util.ts";

describe("Utility Functions", () => {
	describe("logWarning", () => {
		it("should log warning with provider and message", () => {
			// logWarning now uses lib/logger.ts internally
			// This test verifies it doesn't throw
			expect(() =>
				logWarning("test-provider", "Test warning message"),
			).not.toThrow();
		});

		it("should include error details when provided", () => {
			const testError = new Error("Test error");
			expect(() =>
				logWarning("test-provider", "Test warning", testError),
			).not.toThrow();
		});
	});

	describe("isUsableModel", () => {
		it("should return true for normal model IDs", () => {
			expect(isUsableModel("gpt-4")).toBe(true);
			expect(isUsableModel("claude-3-opus")).toBe(true);
			expect(isUsableModel("llama-3-70b")).toBe(true);
		});

		it("should return false for test models", () => {
			expect(isUsableModel("gpt-4-test")).toBe(false);
			expect(isUsableModel("test-model")).toBe(false);
		});

		it("should return false for debug models", () => {
			expect(isUsableModel("gpt-4-debug")).toBe(false);
			expect(isUsableModel("debug-llama")).toBe(false);
		});

		it("should handle case variations", () => {
			expect(isUsableModel("GPT-4-Test")).toBe(true); // Case sensitive check
			expect(isUsableModel("model-TEST")).toBe(true);
		});

		it("should filter by minimum size", () => {
			// 70b model should pass 70B minimum
			expect(isUsableModel("llama-3-70b", 70)).toBe(true);
			// 8b model should fail 70B minimum
			expect(isUsableModel("llama-3-8b", 70)).toBe(false);
			// 405b model should pass
			expect(isUsableModel("llama-3-405b", 70)).toBe(true);
		});

		it("should handle MoE model sizes", () => {
			// 8x22b = 176b total, should pass 70B
			expect(isUsableModel("mixtral-8x22b", 70)).toBe(true);
			// 8x7b = 56b total, should fail 70B
			expect(isUsableModel("mixtral-8x7b", 70)).toBe(false);
		});

		it("should skip size filter when minSizeB not provided", () => {
			expect(isUsableModel("tiny-llama")).toBe(true);
			expect(isUsableModel("llama-3-8b")).toBe(true);
		});
	});

	describe("mapOpenRouterModel", () => {
		it("should map basic OpenRouter model", () => {
			const input = {
				id: "openai/gpt-4",
				name: "GPT-4",
				context_length: 8192,
				max_completion_tokens: 4096,
				pricing: {
					prompt: "0.03",
					completion: "0.06",
				},
				architecture: {
					input_modalities: ["text"],
					output_modalities: ["text"],
				},
			};

			const result = mapOpenRouterModel(input);

			expect(result.id).toBe("openai/gpt-4");
			expect(result.name).toBe("GPT-4");
			expect(result.cost.input).toBe(0.03);
			expect(result.cost.output).toBe(0.06);
			expect(result.cost.cacheRead).toBe(0);
			expect(result.cost.cacheWrite).toBe(0);
			expect(result.contextWindow).toBe(8192);
			expect(result.maxTokens).toBe(4096);
			expect(result.reasoning).toBe(false);
			expect(result.input).toEqual(["text"]);
		});

		it("should detect image input capability", () => {
			const input = {
				id: "openai/gpt-4-vision",
				name: "GPT-4 Vision",
				context_length: 128000,
				pricing: {
					prompt: "0.01",
					completion: "0.03",
				},
				architecture: {
					input_modalities: ["text", "image"],
					output_modalities: ["text"],
				},
			};

			const result = mapOpenRouterModel(input);

			expect(result.input).toEqual(["text", "image"]);
		});

		it("should handle free models (zero pricing)", () => {
			const input = {
				id: "meta-llama/llama-3.1-8b",
				name: "Llama 3.1 8B",
				context_length: 128000,
				pricing: {
					prompt: "0",
					completion: "0",
				},
				architecture: {
					input_modalities: ["text"],
					output_modalities: ["text"],
				},
			};

			const result = mapOpenRouterModel(input);

			expect(result.cost.input).toBe(0);
			expect(result.cost.output).toBe(0);
		});

		it("should use default values when fields are missing", () => {
			const input = {
				id: "unknown/model",
				name: "Unknown Model",
			};

			const result = mapOpenRouterModel(
				input as unknown as Parameters<typeof mapOpenRouterModel>[0],
			);

			expect(result.contextWindow).toBe(4096);
			expect(result.maxTokens).toBe(4096);
			expect(result.cost.input).toBe(0);
			expect(result.cost.output).toBe(0);
		});

		it("should use top_provider max tokens when available", () => {
			const input = {
				id: "anthropic/claude-3-opus",
				name: "Claude 3 Opus",
				context_length: 200000,
				max_completion_tokens: null,
				top_provider: {
					max_completion_tokens: 4096,
				},
				pricing: {
					prompt: "0.015",
					completion: "0.075",
				},
				architecture: {
					input_modalities: ["text"],
					output_modalities: ["text"],
				},
			};

			const result = mapOpenRouterModel(input);

			expect(result.maxTokens).toBe(4096);
		});
	});

	describe("parseModelResponse", () => {
		it("should parse valid model response", async () => {
			const mockResponse = {
				ok: true,
				json: async () => ({ data: [{ id: "model-1" }, { id: "model-2" }] }),
			} as Response;

			const result = await parseModelResponse(mockResponse, "test-provider");

			expect(result.data).toHaveLength(2);
			expect(result.data[0].id).toBe("model-1");
		});

		it("should throw on non-ok response", async () => {
			const mockResponse = {
				ok: false,
				status: 500,
				statusText: "Internal Server Error",
			} as Response;

			await expect(
				parseModelResponse(mockResponse, "test-provider"),
			).rejects.toThrow(
				"Failed to fetch test-provider models: 500 Internal Server Error",
			);
		});

		it("should throw on missing data array", async () => {
			const mockResponse = {
				ok: true,
				json: async () => ({ models: [] }), // Wrong property name
			} as Response;

			await expect(
				parseModelResponse(mockResponse, "test-provider"),
			).rejects.toThrow(
				"Invalid test-provider models response: missing data array",
			);
		});

		it("should throw on non-array data", async () => {
			const mockResponse = {
				ok: true,
				json: async () => ({ data: "not-an-array" }),
			} as Response;

			await expect(
				parseModelResponse(mockResponse, "test-provider"),
			).rejects.toThrow(
				"Invalid test-provider models response: missing data array",
			);
		});
	});

	describe("fetchWithTimeout", () => {
		it("should fetch successfully within timeout", async () => {
			// Mock fetch to return immediately
			global.fetch = vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
			} as Response);

			const result = await fetchWithTimeout(
				"https://api.example.com/data",
				{},
				5000,
			);

			expect(result.ok).toBe(true);
		});

		it("should pass headers and options to fetch", async () => {
			const fetchMock = vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
			} as Response);
			global.fetch = fetchMock;

			await fetchWithTimeout(
				"https://api.example.com/data",
				{
					headers: { Authorization: "Bearer token" },
					method: "POST",
				},
				5000,
			);

			expect(fetchMock).toHaveBeenCalledWith(
				"https://api.example.com/data",
				expect.objectContaining({
					headers: { Authorization: "Bearer token" },
					method: "POST",
					signal: expect.any(AbortSignal),
				}),
			);
		});
	});

	describe("fetchWithRetry", () => {
		it("should succeed on first attempt", async () => {
			global.fetch = vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
			} as Response);

			const result = await fetchWithRetry("https://api.example.com/data", {});

			expect(result.ok).toBe(true);
			expect(global.fetch).toHaveBeenCalledTimes(1);
		});

		it("should retry on server error (5xx)", async () => {
			global.fetch = vi
				.fn()
				.mockResolvedValueOnce({
					ok: false,
					status: 503,
				} as Response)
				.mockResolvedValueOnce({
					ok: true,
					status: 200,
				} as Response);

			const result = await fetchWithRetry(
				"https://api.example.com/data",
				{},
				3,
				100,
			);

			expect(result.ok).toBe(true);
			expect(global.fetch).toHaveBeenCalledTimes(2);
		});

		it("should throw immediately on 429 rate limit", async () => {
			global.fetch = vi.fn().mockResolvedValue({
				ok: false,
				status: 429,
			} as Response);

			await expect(
				fetchWithRetry("https://api.example.com/data", {}),
			).rejects.toThrow("Rate limited (429)");
		});

		it("should throw after max retries", async () => {
			global.fetch = vi.fn().mockResolvedValue({
				ok: false,
				status: 500,
			} as Response);

			await expect(
				fetchWithRetry("https://api.example.com/data", {}, 2, 50),
			).rejects.toThrow();

			expect(global.fetch).toHaveBeenCalledTimes(2);
		});

		it("should return non-retryable error response", async () => {
			// 400 Bad Request - should not retry
			global.fetch = vi.fn().mockResolvedValue({
				ok: false,
				status: 400,
			} as Response);

			const result = await fetchWithRetry("https://api.example.com/data", {});

			expect(result.ok).toBe(false);
			expect(result.status).toBe(400);
			expect(global.fetch).toHaveBeenCalledTimes(1);
		});
	});
});
