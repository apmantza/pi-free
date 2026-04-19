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
	DEFAULT_MIN_SIZE_B: 30,
}));

vi.mock("../usage/metrics.ts", () => ({
	fetchOpenRouterMetrics: vi.fn(),
}));

vi.mock("../provider-helper.ts", async () => {
	const actual = await vi.importActual("../provider-helper.ts");
	return {
		...actual,
		setupProvider: vi.fn(),
		createReRegister: vi.fn(() => vi.fn()),
		createCtxReRegister: vi.fn(
			(ctx, config) => (models: ProviderModelConfig[]) => {
				ctx.modelRegistry.registerProvider(config.providerId || "openrouter", {
					...config,
					models,
				});
			},
		),
	};
});

vi.mock("../lib/util.ts", async () => {
	const actual = await vi.importActual("../lib/util.ts");
	return {
		...actual,
		logWarning: vi.fn(),
	};
});

vi.mock("../providers/model-fetcher.ts", () => ({
	fetchOpenRouterModelsWithFree: vi.fn(),
}));

import { setupProvider } from "../provider-helper.ts";
import { fetchOpenRouterModelsWithFree } from "../providers/model-fetcher.ts";
import openrouterProvider from "../providers/openrouter/openrouter.ts";

describe("OpenRouter Provider", () => {
	let mockPi: ExtensionAPI;
	let mockRegisterProvider: ReturnType<typeof vi.fn>;
	let mockOn: ReturnType<typeof vi.fn>;

	const mockFreeModels: ProviderModelConfig[] = [
		{
			id: "google/gemini-2.0-flash-exp:free",
			name: "Gemini 2.0 Flash",
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128000,
			maxTokens: 8192,
		},
	];

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
		it("should register models immediately for --list-models visibility", async () => {
			vi.mocked(fetchOpenRouterModelsWithFree).mockResolvedValue({
				free: mockFreeModels,
				all: mockFreeModels,
			});

			await openrouterProvider(mockPi);

			// Should register immediately
			expect(mockPi.registerProvider).toHaveBeenCalledWith(
				"openrouter",
				expect.objectContaining({
					baseUrl: "https://openrouter.ai/api/v1",
					models: expect.any(Array),
				}),
			);

			// Should register event handlers
			expect(mockOn).toHaveBeenCalledWith(
				"session_start",
				expect.any(Function),
			);
		});

		it("should not register if API call fails at startup", async () => {
			vi.mocked(fetchOpenRouterModelsWithFree).mockRejectedValue(
				new Error("Network error"),
			);

			await openrouterProvider(mockPi);

			// Should not register immediately
			expect(mockPi.registerProvider).not.toHaveBeenCalled();
		});
	});

	describe("session_start handling", () => {
		it("should refresh models when no existing auth", async () => {
			vi.mocked(fetchOpenRouterModelsWithFree).mockResolvedValue({
				free: mockFreeModels,
				all: mockFreeModels,
			});

			await openrouterProvider(mockPi);

			// Get session_start handler
			const sessionStartHandler = mockOn.mock.calls.find(
				(call) => call[0] === "session_start",
			)?.[1];

			expect(sessionStartHandler).toBeDefined();

			// Mock context without existing auth
			const mockCtx = {
				modelRegistry: {
					getAll: vi.fn().mockReturnValue([]),
					getAvailable: vi.fn().mockReturnValue([]),
					registerProvider: vi.fn(),
				},
			};

			await sessionStartHandler({}, mockCtx);

			// Should call fetch again and register
			expect(fetchOpenRouterModelsWithFree).toHaveBeenCalled();
			expect(mockCtx.modelRegistry.registerProvider).toHaveBeenCalled();
		});

		it("should use existing auth when available", async () => {
			vi.mocked(fetchOpenRouterModelsWithFree).mockResolvedValue({
				free: mockFreeModels,
				all: mockFreeModels,
			});

			await openrouterProvider(mockPi);

			// Get session_start handler
			const sessionStartHandler = mockOn.mock.calls.find(
				(call) => call[0] === "session_start",
			)?.[1];

			// Mock context with existing auth
			const existingModels = [
				{
					id: "anthropic/claude-3.5-haiku:free",
					name: "Claude Haiku",
					reasoning: false,
					input: ["text"],
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					contextWindow: 200000,
					maxTokens: 8192,
				},
			];

			const mockCtx = {
				modelRegistry: {
					getAll: vi
						.fn()
						.mockReturnValue(
							existingModels.map((m) => ({ ...m, provider: "openrouter" })),
						),
					getAvailable: vi
						.fn()
						.mockReturnValue(
							existingModels.map((m) => ({ ...m, provider: "openrouter" })),
						),
					registerProvider: vi.fn(),
				},
			};

			await sessionStartHandler({}, mockCtx);

			// Should filter to free models from existing auth
			expect(mockCtx.modelRegistry.registerProvider).toHaveBeenCalled();
		});
	});

	describe("setupProvider integration", () => {
		it("should call setupProvider with correct config", async () => {
			vi.mocked(fetchOpenRouterModelsWithFree).mockResolvedValue({
				free: mockFreeModels,
				all: mockFreeModels,
			});

			await openrouterProvider(mockPi);

			expect(setupProvider).toHaveBeenCalledWith(
				mockPi,
				expect.objectContaining({
					providerId: "openrouter",
					reRegister: expect.any(Function),
				}),
				expect.objectContaining({
					free: expect.any(Array),
					all: expect.any(Array),
				}),
			);
		});
	});
});
