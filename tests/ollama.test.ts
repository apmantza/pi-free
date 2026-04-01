/**
 * Ollama Provider Tests
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies
vi.mock("../config.ts", () => ({
	OLLAMA_API_KEY: "test-ollama-key",
	OLLAMA_SHOW_PAID: true,
	PROVIDER_OLLAMA: "ollama",
	applyHidden: (models: unknown[]) => models,
}));

vi.mock("../constants.ts", () => ({
	BASE_URL_OLLAMA: "https://ollama.com/api",
	DEFAULT_FETCH_TIMEOUT_MS: 10000,
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

vi.mock("../util.ts", () => ({
	fetchWithRetry: vi.fn(),
	logWarning: vi.fn(),
}));

import { setupProvider } from "../provider-helper.ts";
import { fetchWithRetry } from "../util.ts";

describe("Ollama Provider", () => {
	let mockPi: ExtensionAPI;
	let mockRegisterProvider: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.clearAllMocks();
		mockRegisterProvider = vi.fn();

		mockPi = {
			registerProvider: mockRegisterProvider,
			registerCommand: vi.fn(),
		} as unknown as ExtensionAPI;
	});

	describe("initialization", () => {
		it("should register provider with cloud models", async () => {
			const mockModels = {
				models: [
					{
						name: "gpt-oss:120b-cloud",
						model: "gpt-oss:120b-cloud",
						details: { parameter_size: "120B" },
					},
				],
			};
			vi.mocked(fetchWithRetry).mockResolvedValue({
				ok: true,
				json: async () => mockModels,
			} as Response);

			const { default: ollamaProvider } = await import(
				"../providers/ollama.ts"
			);
			await ollamaProvider(mockPi);

			expect(mockRegisterProvider).toHaveBeenCalledWith(
				"ollama",
				expect.objectContaining({
					baseUrl: "https://ollama.com/api",
					apiKey: "OLLAMA_API_KEY",
					api: "ollama-chat",
					models: expect.any(Array),
				}),
			);
		});

		it("should set API key in environment", async () => {
			delete process.env.OLLAMA_API_KEY;

			const { default: ollamaProvider } = await import(
				"../providers/ollama.ts"
			);
			await ollamaProvider(mockPi);

			expect(process.env.OLLAMA_API_KEY).toBe("test-ollama-key");
		});

		it("should skip registration without API key", async () => {
			const apiKeySpy = vi
				.spyOn(await import("../config.ts"), "OLLAMA_API_KEY", "get")
				.mockReturnValue(undefined as any);

			const { default: ollamaProvider } = await import(
				"../providers/ollama.ts"
			);
			await ollamaProvider(mockPi);

			expect(mockRegisterProvider).not.toHaveBeenCalled();
			apiKeySpy.mockRestore();
		});

		it("should skip registration when SHOW_PAID is false", async () => {
			const showPaidSpy = vi
				.spyOn(await import("../config.ts"), "OLLAMA_SHOW_PAID", "get")
				.mockReturnValue(false);

			const { default: ollamaProvider } = await import(
				"../providers/ollama.ts"
			);
			await ollamaProvider(mockPi);

			expect(mockRegisterProvider).not.toHaveBeenCalled();
			showPaidSpy.mockRestore();
		});
	});

	describe("model fetching", () => {
		it("should filter for cloud models only", async () => {
			const mockModels = {
				models: [
					{
						name: "gpt-oss:120b-cloud",
						model: "gpt-oss:120b-cloud",
						details: { parameter_size: "120B" },
					},
					{
						name: "llama3.2:latest", // Should be filtered out
						model: "llama3.2:latest",
						details: { parameter_size: "3B" },
					},
					{
						name: "qwen3-coder:480b-cloud",
						model: "qwen3-coder:480b-cloud",
						details: { parameter_size: "480B" },
					},
				],
			};
			vi.mocked(fetchWithRetry).mockResolvedValue({
				ok: true,
				json: async () => mockModels,
			} as Response);

			const { default: ollamaProvider } = await import(
				"../providers/ollama.ts"
			);
			await ollamaProvider(mockPi);

			const registerCall = mockRegisterProvider.mock.calls[0];
			const models = registerCall?.[1]?.models;

			// Should only have cloud models
			expect(models).toHaveLength(2);
			expect(models[0].id).toBe("gpt-oss:120b-cloud");
			expect(models[1].id).toBe("qwen3-coder:480b-cloud");
		});

		it("should clean up model names", async () => {
			const mockModels = {
				models: [
					{
						name: "gpt-oss:120b-cloud",
						model: "gpt-oss:120b-cloud",
						details: {},
					},
				],
			};
			vi.mocked(fetchWithRetry).mockResolvedValue({
				ok: true,
				json: async () => mockModels,
			} as Response);

			const { default: ollamaProvider } = await import(
				"../providers/ollama.ts"
			);
			await ollamaProvider(mockPi);

			const registerCall = mockRegisterProvider.mock.calls[0];
			const models = registerCall?.[1]?.models;

			expect(models[0].name).toBe("Gpt Oss 120b"); // Cleaned up name
		});

		it("should detect reasoning models", async () => {
			const mockModels = {
				models: [
					{
						name: "deepseek-r1:70b-cloud",
						model: "deepseek-r1:70b-cloud",
						details: {},
					},
				],
			};
			vi.mocked(fetchWithRetry).mockResolvedValue({
				ok: true,
				json: async () => mockModels,
			} as Response);

			const { default: ollamaProvider } = await import(
				"../providers/ollama.ts"
			);
			await ollamaProvider(mockPi);

			const registerCall = mockRegisterProvider.mock.calls[0];
			const models = registerCall?.[1]?.models;

			expect(models[0].reasoning).toBe(true);
		});
	});

	describe("setupProvider integration", () => {
		it("should call setupProvider with stored models", async () => {
			const mockModels = {
				models: [
					{
						name: "gpt-oss:120b-cloud",
						model: "gpt-oss:120b-cloud",
						details: {},
					},
				],
			};
			vi.mocked(fetchWithRetry).mockResolvedValue({
				ok: true,
				json: async () => mockModels,
			} as Response);

			const { default: ollamaProvider } = await import(
				"../providers/ollama.ts"
			);
			await ollamaProvider(mockPi);

			expect(setupProvider).toHaveBeenCalledWith(
				mockPi,
				expect.objectContaining({
					providerId: "ollama",
				}),
				expect.objectContaining({
					free: expect.any(Array),
					all: expect.any(Array),
				}),
			);
		});
	});
});
