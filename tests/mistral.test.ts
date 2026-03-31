/**
 * Mistral Provider Tests
 *
 * Tests for the Mistral AI provider extension.
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies
vi.mock("../config.ts", () => ({
	MISTRAL_API_KEY: "test-mistral-key",
	MISTRAL_SHOW_PAID: false,
	PROVIDER_MISTRAL: "mistral",
}));

vi.mock("../constants.ts", () => ({
	BASE_URL_MISTRAL: "https://api.mistral.ai/v1",
	PROVIDER_MISTRAL: "mistral",
}));

vi.mock("../provider-helper.ts", () => ({
	createReRegister: vi.fn(() => vi.fn()),
	setupProvider: vi.fn(),
}));

vi.mock("../lib/logger.ts", () => ({
	createLogger: () => ({
		warn: vi.fn(),
		info: vi.fn(),
		debug: vi.fn(),
		error: vi.fn(),
	}),
}));

import { setupProvider } from "../provider-helper.ts";
import mistralProvider from "../providers/mistral.ts";

describe("Mistral Provider", () => {
	let mockPi: ExtensionAPI;
	let mockRegisterProvider: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.clearAllMocks();
		mockRegisterProvider = vi.fn();

		mockPi = {
			registerProvider: mockRegisterProvider,
			registerCommand: vi.fn(),
			on: vi.fn(),
		} as unknown as ExtensionAPI;
	});

	describe("initialization", () => {
		it("should register provider with hardcoded models", async () => {
			await mistralProvider(mockPi);

			expect(mockRegisterProvider).toHaveBeenCalledWith(
				"mistral",
				expect.objectContaining({
					baseUrl: "https://api.mistral.ai/v1",
					apiKey: "MISTRAL_API_KEY",
					api: "openai-completions",
					models: expect.any(Array),
				}),
			);
		});

		it("should set API key in environment", async () => {
			delete process.env.MISTRAL_API_KEY;

			await mistralProvider(mockPi);

			expect(process.env.MISTRAL_API_KEY).toBe("test-mistral-key");
		});
	});

	describe("model configuration", () => {
		it("should have hardcoded models with correct structure", async () => {
			await mistralProvider(mockPi);

			expect(mockRegisterProvider).toHaveBeenCalled();
			const registerCall = mockRegisterProvider.mock.calls[0];
			expect(registerCall).toBeDefined();
			const models = registerCall?.[1]?.models;

			expect(models).toBeInstanceOf(Array);
			expect(models.length).toBeGreaterThan(0);

			// Check first model has required properties
			const firstModel = models[0];
			expect(firstModel).toHaveProperty("id");
			expect(firstModel).toHaveProperty("name");
			expect(firstModel).toHaveProperty("reasoning");
			expect(firstModel).toHaveProperty("input");
			expect(firstModel).toHaveProperty("cost");
			expect(firstModel).toHaveProperty("contextWindow");
			expect(firstModel).toHaveProperty("maxTokens");
		});

		it("should only include free models when MISTRAL_SHOW_PAID is false", async () => {
			await mistralProvider(mockPi);

			const registerCall = mockRegisterProvider.mock.calls[0];
			const models = registerCall?.[1]?.models;

			// All models should be free (cost = 0)
			models.forEach((model: any) => {
				expect(model.cost.input).toBe(0);
				expect(model.cost.output).toBe(0);
			});
		});

		it("should include free tier models", async () => {
			await mistralProvider(mockPi);

			const registerCall = mockRegisterProvider.mock.calls[0];
			const models = registerCall?.[1]?.models;
			const modelIds = models.map((m: any) => m.id);

			expect(modelIds).toContain("mistral-small-latest");
			expect(modelIds).toContain("open-mistral-nemo");
		});
	});

	describe("setupProvider integration", () => {
		it("should call setupProvider with correct config", async () => {
			await mistralProvider(mockPi);

			expect(setupProvider).toHaveBeenCalledWith(
				mockPi,
				expect.objectContaining({
					providerId: "mistral",
				}),
				expect.objectContaining({
					free: expect.any(Array),
					all: expect.any(Array),
				}),
			);
		});
	});

	describe("payload filtering", () => {
		it("should register before_provider_request handler", async () => {
			await mistralProvider(mockPi);

			expect(mockPi.on).toHaveBeenCalledWith(
				"before_provider_request",
				expect.any(Function),
			);
		});

		it("should filter out unsupported fields for Mistral requests", async () => {
			await mistralProvider(mockPi);

			// Get the handler registered via pi.on
			const onCalls = (mockPi.on as ReturnType<typeof vi.fn>).mock.calls;
			const providerRequestCall = onCalls.find(
				(call: any[]) => call[0] === "before_provider_request",
			);
			expect(providerRequestCall).toBeDefined();

			const handler = providerRequestCall?.[1];

			// Test with Mistral model - should filter
			// Event structure: { type: "before_provider_request", payload: {...} }
			const mistralEvent = {
				type: "before_provider_request",
				payload: {
					model: "mistral-small-latest",
					messages: [],
					seed: 12345,
					user: "test-user",
					metadata: { foo: "bar" },
					prediction: { type: "content", content: "test" },
					temperature: 0.7,
				},
			};

			const result = handler(mistralEvent);

			expect(result).toBeDefined();
			expect(result.seed).toBeUndefined();
			expect(result.user).toBeUndefined();
			expect(result.metadata).toBeUndefined();
			expect(result.prediction).toBeUndefined();
			expect(result.temperature).toBe(0.7);
			expect(result.model).toBe("mistral-small-latest");
		});

		it("should not filter requests from other providers", async () => {
			await mistralProvider(mockPi);

			const onCalls = (mockPi.on as ReturnType<typeof vi.fn>).mock.calls;
			const providerRequestCall = onCalls.find(
				(call: any[]) => call[0] === "before_provider_request",
			);
			const handler = providerRequestCall?.[1];

			// Test with non-Mistral model - should pass through unchanged
			const otherEvent = {
				type: "before_provider_request",
				payload: {
					model: "some-model",
					messages: [],
					seed: 12345,
					user: "test-user",
				},
			};

			const result = handler(otherEvent);

			// Should return undefined to let payload through unchanged
			expect(result).toBeUndefined();
		});
	});
});
