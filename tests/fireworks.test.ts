/**
 * Fireworks Provider Tests
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies
vi.mock("../config.ts", () => ({
	FIREWORKS_API_KEY: "test-fireworks-key",
	PROVIDER_FIREWORKS: "fireworks",
}));

vi.mock("../constants.ts", () => ({
	BASE_URL_FIREWORKS: "https://api.fireworks.ai/inference/v1",
}));

vi.mock("../provider-helper.ts", () => ({
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
import fireworksProvider from "../providers/fireworks.ts";

describe("Fireworks Provider", () => {
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
		it("should register provider with hardcoded models", async () => {
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

			await fireworksProvider(mockPi);

			expect(process.env.FIREWORKS_API_KEY).toBe("test-fireworks-key");
		});

		it("should skip registration without API key", async () => {
			// Mock no API key by temporarily clearing the module
			const { FIREWORKS_API_KEY } = await import("../config.ts");
			vi.spyOn(
				await import("../config.ts"),
				"FIREWORKS_API_KEY",
				"get",
			).mockReturnValue(undefined as any);

			await fireworksProvider(mockPi);

			// Should not register provider
			expect(mockRegisterProvider).not.toHaveBeenCalled();
		});
	});

	describe("model configuration", () => {
		it("should have hardcoded models with correct structure", async () => {
			await fireworksProvider(mockPi);

			const registerCall = mockRegisterProvider.mock.calls[0];
			const models = registerCall[1].models;

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
	});

	describe("setupProvider integration", () => {
		it("should call setupProvider with stored models", async () => {
			await fireworksProvider(mockPi);

			expect(setupProvider).toHaveBeenCalledWith(
				mockPi,
				expect.objectContaining({
					providerId: "fireworks",
				}),
				expect.objectContaining({
					free: expect.any(Array),
					all: expect.any(Array),
				}),
			);
		});
	});
});
