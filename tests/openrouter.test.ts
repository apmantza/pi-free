/**
 * OpenRouter Provider Tests
 */

import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@mariozechner/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies
vi.mock("../config.ts", () => ({
	OPENROUTER_API_KEY: "test-api-key",
	OPENROUTER_SHOW_PAID: false,
	PROVIDER_OPENROUTER: "openrouter",
	applyHidden: (models: ProviderModelConfig[]) => models,
}));

vi.mock("../constants.ts", () => ({
	BASE_URL_OPENROUTER: "https://openrouter.ai/api/v1",
	DEFAULT_FETCH_TIMEOUT_MS: 10000,
}));

vi.mock("../metrics.ts", () => ({
	fetchOpenRouterMetrics: vi.fn(),
}));

vi.mock("../provider-helper.ts", () => ({
	createReRegister: vi.fn(() => vi.fn()),
	createCtxReRegister: vi.fn(() => vi.fn()),
	setupProvider: vi.fn(),
}));

vi.mock("../util.ts", () => ({
	logWarning: vi.fn(),
}));

vi.mock("../providers/model-fetcher.ts", () => ({
	fetchOpenRouterModelsWithFree: vi.fn(),
}));

import { setupProvider } from "../provider-helper.ts";
import { fetchOpenRouterModelsWithFree } from "../providers/model-fetcher.ts";
import openrouterProvider from "../providers/openrouter.ts";

describe("OpenRouter Provider", () => {
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
		} as unknown as ExtensionAPI;
	});

	describe("initialization", () => {
		it("should register event handlers", async () => {
			vi.mocked(fetchOpenRouterModelsWithFree).mockResolvedValue({
				free: [],
				all: [],
			});

			await openrouterProvider(mockPi);

			expect(mockOn).toHaveBeenCalledWith(
				"session_start",
				expect.any(Function),
			);
		});
	});

	describe("session_start handling", () => {
		it("should handle existing auth with free models", async () => {
			const mockFreeModels: ProviderModelConfig[] = [
				{
					id: "gpt-3.5",
					name: "GPT-3.5",
					reasoning: false,
					input: ["text"],
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					contextWindow: 16000,
					maxTokens: 4096,
				},
			];

			const mockAllModels: ProviderModelConfig[] = [
				...mockFreeModels,
				{
					id: "gpt-4",
					name: "GPT-4",
					reasoning: true,
					input: ["text"],
					cost: { input: 30, output: 60, cacheRead: 0, cacheWrite: 0 },
					contextWindow: 128000,
					maxTokens: 4096,
				},
			];

			vi.mocked(fetchOpenRouterModelsWithFree).mockResolvedValue({
				free: mockFreeModels,
				all: mockAllModels,
			});

			await openrouterProvider(mockPi);

			// Get session_start handler
			const sessionStartHandler = mockOn.mock.calls.find(
				(call) => call[0] === "session_start",
			)?.[1];

			expect(sessionStartHandler).toBeDefined();

			// Mock context with existing auth
			const mockCtx = {
				modelRegistry: {
					getAll: vi
						.fn()
						.mockReturnValue(
							mockAllModels.map((m) => ({ ...m, provider: "openrouter" })),
						),
					getAvailable: vi.fn().mockReturnValue([{ provider: "openrouter" }]),
					registerProvider: vi.fn(),
				},
			};

			await sessionStartHandler({}, mockCtx);

			expect(mockCtx.modelRegistry.registerProvider).toHaveBeenCalled();
		});

		it("should set API key in env when no existing auth", async () => {
			vi.mocked(fetchOpenRouterModelsWithFree).mockResolvedValue({
				free: [
					{
						id: "test-model",
						name: "Test",
						reasoning: false,
						input: ["text"],
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
						contextWindow: 128000,
						maxTokens: 4096,
					},
				],
				all: [],
			});

			await openrouterProvider(mockPi);

			const sessionStartHandler = mockOn.mock.calls.find(
				(call) => call[0] === "session_start",
			)?.[1];

			const mockCtx = {
				modelRegistry: {
					getAll: vi.fn().mockReturnValue([]),
					getAvailable: vi.fn().mockReturnValue([]),
					registerProvider: vi.fn(),
				},
			};

			await sessionStartHandler({}, mockCtx);

			expect(process.env.OPENROUTER_API_KEY).toBe("test-api-key");
		});
	});

	describe("setupProvider integration", () => {
		it("should call setupProvider with correct config", async () => {
			vi.mocked(fetchOpenRouterModelsWithFree).mockResolvedValue({
				free: [],
				all: [],
			});

			await openrouterProvider(mockPi);

			expect(setupProvider).toHaveBeenCalledWith(
				mockPi,
				expect.objectContaining({
					providerId: "openrouter",
					reRegister: expect.any(Function),
				}),
				expect.objectContaining({ free: [], all: [] }),
			);
		});
	});
});
