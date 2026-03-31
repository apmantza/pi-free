/**
 * Kilo Provider Tests
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Create mock functions first
const mockFetchKiloModels = vi.fn();
const mockSetupProvider = vi.fn();
const mockLoginKilo = vi.fn();

// Mock dependencies before importing the provider
vi.mock("../kilo-auth.ts", () => ({
	loginKilo: (...args: unknown[]) => mockLoginKilo(...args),
	refreshKiloToken: vi.fn(),
}));

vi.mock("../kilo-models.ts", () => ({
	fetchKiloModels: (...args: unknown[]) => mockFetchKiloModels(...args),
	KILO_GATEWAY_BASE: "https://api.kilo.ai/api/gateway",
}));

vi.mock("../provider-helper.ts", () => ({
	setupProvider: (...args: unknown[]) => mockSetupProvider(...args),
	enhanceWithCI: (models: unknown[]) => models,
}));

vi.mock("../usage-widget.ts", () => ({
	registerUsageWidget: vi.fn(),
}));

vi.mock("../util.ts", () => ({
	logWarning: vi.fn(),
}));

import kiloProvider from "../providers/kilo.ts";

describe("Kilo Provider", () => {
	let _mockPi: ExtensionAPI;
	let mockRegisterProvider: ReturnType<typeof vi.fn>;
	let mockOn: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.clearAllMocks();
		mockFetchKiloModels.mockReset();
		mockSetupProvider.mockReset();
		mockLoginKilo.mockReset();

		mockRegisterProvider = vi.fn();
		mockOn = vi.fn();

		_mockPi = {
			registerProvider: mockRegisterProvider,
			on: mockOn,
			registerCommand: vi.fn(),
		} as unknown as ExtensionAPI;
	});

describe("Kilo Provider", () => {
	let mockPi: ExtensionAPI;
	let mockRegisterProvider: ReturnType<typeof vi.fn>;
	let mockOn: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.clearAllMocks();
		mockRegisterProvider = vi.fn();
		mockOn = vi.fn();

		mockPi = {
			registerProvider: mockRegisterProvider,
			on: mockOn,
			registerCommand: vi.fn(),
		} as unknown as ExtensionAPI;
	});

	describe("initialization", () => {
		it("should register provider with free models on startup", async () => {
			const mockModels = [
				{
					id: "gpt-4",
					name: "GPT-4",
					reasoning: true,
					input: ["text"],
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					contextWindow: 128000,
					maxTokens: 4096,
				},
			];
			vi.mocked(fetchKiloModels).mockResolvedValue(mockModels);

			await kiloProvider(mockPi);

			expect(mockRegisterProvider).toHaveBeenCalledWith(
				"kilo",
				expect.objectContaining({
					baseUrl: "https://api.kilo.ai/api/gateway",
					apiKey: "KILO_API_KEY",
					api: "openai-completions",
					models: mockModels,
					oauth: expect.any(Object),
				}),
			);
		});

		it("should handle model fetch failure gracefully", async () => {
			vi.mocked(fetchKiloModels).mockRejectedValue(new Error("Network error"));

			await kiloProvider(mockPi);

			// Should still register with empty models
			expect(mockRegisterProvider).toHaveBeenCalled();
		});
	});

	describe("OAuth integration", () => {
		it("should have oauth configuration", async () => {
			vi.mocked(fetchKiloModels).mockResolvedValue([]);

			await kiloProvider(mockPi);

			const registerCall = mockRegisterProvider.mock.calls[0];
			expect(registerCall[1]).toHaveProperty("oauth");
			expect(registerCall[1].oauth).toHaveProperty("name", "Kilo");
			expect(registerCall[1].oauth).toHaveProperty("login");
			expect(registerCall[1].oauth).toHaveProperty("refreshToken");
			expect(registerCall[1].oauth).toHaveProperty("getApiKey");
			expect(registerCall[1].oauth).toHaveProperty("modifyModels");
		});

		it("should fetch all models after login", async () => {
			vi.mocked(fetchKiloModels).mockResolvedValue([]);

			await kiloProvider(mockPi);

			const oauth = mockRegisterProvider.mock.calls[0][1].oauth;
			const _mockCreds = {
				access: "test-token",
				refresh: "",
				expires: Date.now() + 3600000,
			};

			vi.mocked(fetchKiloModels).mockResolvedValue([
				{ id: "gpt-4", name: "GPT-4" },
				{ id: "claude-3", name: "Claude 3" },
			]);

			await oauth.login({ onProgress: vi.fn() });

			expect(fetchKiloModels).toHaveBeenCalledWith({ token: "test-token" });
		});
	});

	describe("event handlers", () => {
		it("should register session_start handler", async () => {
			vi.mocked(fetchKiloModels).mockResolvedValue([]);

			await kiloProvider(mockPi);

			expect(mockOn).toHaveBeenCalledWith(
				"session_start",
				expect.any(Function),
			);
		});
	});

	describe("setupProvider integration", () => {
		it("should call setupProvider with correct config", async () => {
			vi.mocked(fetchKiloModels).mockResolvedValue([]);

			await kiloProvider(mockPi);

			expect(setupProvider).toHaveBeenCalledWith(
				mockPi,
				expect.objectContaining({
					providerId: "kilo",
					tosUrl: expect.stringContaining("kilo.ai"),
					reRegister: expect.any(Function),
				}),
				expect.objectContaining({ free: [], all: [] }),
			);
		});
	});
});
});
