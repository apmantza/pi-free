/**
 * Fireworks Provider Tests
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock fetch response for Fireworks API
const mockFireworksModelsResponse = {
	object: "list",
	data: [
		{
			id: "accounts/fireworks/models/deepseek-v3p2",
			object: "model",
			owned_by: "fireworks",
			created: 1764602280,
			kind: "HF_BASE_MODEL",
			supports_chat: true,
			supports_image_input: false,
			supports_tools: true,
			context_length: 163840,
		},
		{
			id: "accounts/fireworks/models/kimi-k2p5",
			object: "model",
			owned_by: "fireworks",
			created: 1769476770,
			kind: "HF_BASE_MODEL",
			supports_chat: true,
			supports_image_input: true,
			supports_tools: true,
			context_length: 262144,
		},
		{
			id: "accounts/fireworks/models/flux-1-schnell-fp8",
			object: "model",
			owned_by: "fireworks",
			created: 1729535376,
			kind: "FLUMINA_BASE_MODEL",
			supports_chat: false, // Should be filtered out
			supports_image_input: false,
			supports_tools: false,
		},
	],
};

// Mock dependencies
vi.mock("../config.ts", () => ({
	FIREWORKS_API_KEY: "test-fireworks-key",
	FIREWORKS_SHOW_PAID: true,
	PROVIDER_FIREWORKS: "fireworks",
	applyHidden: (models: unknown[]) => models,
}));

vi.mock("../constants.ts", () => ({
	BASE_URL_FIREWORKS: "https://api.fireworks.ai/inference/v1",
	DEFAULT_FETCH_TIMEOUT_MS: 10000,
}));

vi.mock("../index.ts", () => ({
	registerWithGlobalToggle: vi.fn(),
	isFreeModel: (m: any) => (m.cost?.input ?? 0) === 0,
	getGlobalFreeOnly: () => false,
}));

vi.mock("../provider-helper.ts", () => ({
	enhanceWithCI: (models: unknown[]) => models,
	createReRegister: () => vi.fn(),
}));

vi.mock("../lib/logger.ts", () => ({
	createLogger: () => ({
		warn: vi.fn(),
		info: vi.fn(),
		debug: vi.fn(),
		error: vi.fn(),
	}),
}));

// Mock fetchWithRetry
const mockFetchWithRetry = vi.fn();
vi.mock("../lib/util.ts", () => ({
	fetchWithRetry: (...args: any[]) => mockFetchWithRetry(...args),
}));

import type { ProviderModelConfig } from "@mariozechner/pi-coding-agent";

describe("Fireworks Provider", () => {
	let mockPi: ExtensionAPI;
	let mockRegisterProvider: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.clearAllMocks();
		mockRegisterProvider = vi.fn();
		mockFetchWithRetry.mockReset();

		mockPi = {
			registerProvider: mockRegisterProvider,
			registerCommand: vi.fn(),
		} as unknown as ExtensionAPI;
	});

	describe("initialization", () => {
		it("should register provider with fetched models", async () => {
			mockFetchWithRetry.mockResolvedValue({
				ok: true,
				json: () => Promise.resolve(mockFireworksModelsResponse),
			});

			const { default: fireworksProvider } = await import(
				"../providers/fireworks/fireworks.ts"
			);
			await fireworksProvider(mockPi);

			expect(mockRegisterProvider).toHaveBeenCalledWith(
				"fireworks",
				expect.objectContaining({
					baseUrl: "https://api.fireworks.ai/inference/v1",
					apiKey: "FIREWORKS_API_KEY",
					api: "openai-completions",
					models: expect.any(Array),
				}),
			);
		});

		it("should set API key in environment", async () => {
			delete process.env.FIREWORKS_API_KEY;
			mockFetchWithRetry.mockResolvedValue({
				ok: true,
				json: () => Promise.resolve(mockFireworksModelsResponse),
			});

			const { default: fireworksProvider } = await import(
				"../providers/fireworks/fireworks.ts"
			);
			await fireworksProvider(mockPi);

			expect(process.env.FIREWORKS_API_KEY).toBe("test-fireworks-key");
		});

		it("should skip registration without API key", async () => {
			// Mock no API key
			const apiKeySpy = vi
				.spyOn(await import("../config.ts"), "FIREWORKS_API_KEY", "get")
				.mockReturnValue(undefined as any);

			const { default: fireworksProvider } = await import(
				"../providers/fireworks/fireworks.ts"
			);
			await fireworksProvider(mockPi);

			expect(mockRegisterProvider).not.toHaveBeenCalled();
			apiKeySpy.mockRestore();
		});
	});

	describe("model configuration", () => {
		it("should have dynamically fetched models with correct structure", async () => {
			mockFetchWithRetry.mockResolvedValue({
				ok: true,
				json: () => Promise.resolve(mockFireworksModelsResponse),
			});

			const { default: fireworksProvider } = await import(
				"../providers/fireworks/fireworks.ts"
			);
			await fireworksProvider(mockPi);

			expect(mockRegisterProvider).toHaveBeenCalled();
			const registerCall = mockRegisterProvider.mock.calls[0];
			expect(registerCall).toBeDefined();
			const models: ProviderModelConfig[] = registerCall?.[1]?.models;

			expect(models).toBeInstanceOf(Array);
			// Should only have chat-capable models (2 from mock, 1 filtered out)
			expect(models.length).toBe(2);

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

		it("should filter non-chat models", async () => {
			mockFetchWithRetry.mockResolvedValue({
				ok: true,
				json: () => Promise.resolve(mockFireworksModelsResponse),
			});

			const { default: fireworksProvider } = await import(
				"../providers/fireworks/fireworks.ts"
			);
			await fireworksProvider(mockPi);

			const registerCall = mockRegisterProvider.mock.calls[0];
			const models: ProviderModelConfig[] = registerCall?.[1]?.models;

			// Should not include the flux model (supports_chat: false)
			const fluxModel = models.find((m) => m.id.includes("flux"));
			expect(fluxModel).toBeUndefined();
		});

		it("should identify vision models correctly", async () => {
			mockFetchWithRetry.mockResolvedValue({
				ok: true,
				json: () => Promise.resolve(mockFireworksModelsResponse),
			});

			const { default: fireworksProvider } = await import(
				"../providers/fireworks/fireworks.ts"
			);
			await fireworksProvider(mockPi);

			const registerCall = mockRegisterProvider.mock.calls[0];
			const models: ProviderModelConfig[] = registerCall?.[1]?.models;

			// kimi-k2p5 supports vision
			const visionModel = models.find((m) => m.id.includes("kimi-k2p5"));
			expect(visionModel).toBeDefined();
			expect(visionModel?.input).toContain("image");
		});

		it("should format model names correctly", async () => {
			mockFetchWithRetry.mockResolvedValue({
				ok: true,
				json: () => Promise.resolve(mockFireworksModelsResponse),
			});

			const { default: fireworksProvider } = await import(
				"../providers/fireworks/fireworks.ts"
			);
			await fireworksProvider(mockPi);

			const registerCall = mockRegisterProvider.mock.calls[0];
			const models: ProviderModelConfig[] = registerCall?.[1]?.models;

			// Check name formatting
			const deepseekModel = models.find((m) => m.id.includes("deepseek"));
			expect(deepseekModel?.name).toBe("Deepseek V3.2");
		});
	});

	describe("error handling", () => {
		it("should handle API fetch errors gracefully", async () => {
			// Reset module cache to get fresh import
			mockFetchWithRetry.mockRejectedValue(new Error("API Error"));

			const { default: fireworksProvider } = await import(
				"../providers/fireworks/fireworks.ts?t=" + Date.now()
			);

			// Should not throw
			await expect(fireworksProvider(mockPi)).resolves.not.toThrow();

			// Should not register provider due to error
			expect(mockRegisterProvider).not.toHaveBeenCalled();
		});
	});
});
