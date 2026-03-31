/**
 * NVIDIA Provider Tests
 */

import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@mariozechner/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies
vi.mock("../config.ts", () => ({
	NVIDIA_API_KEY: "test-nvidia-key",
	NVIDIA_SHOW_PAID: false,
	PROVIDER_NVIDIA: "nvidia",
	applyHidden: (models: ProviderModelConfig[]) => models,
}));

vi.mock("../constants.ts", () => ({
	BASE_URL_NVIDIA: "https://integrate.api.nvidia.com/v1",
	DEFAULT_FETCH_TIMEOUT_MS: 10000,
	NVIDIA_MIN_SIZE_B: 70,
	URL_MODELS_DEV: "https://models.dev/api.json",
}));

vi.mock("../provider-helper.ts", () => ({
	setupProvider: vi.fn(),
}));

vi.mock("../util.ts", () => ({
	fetchWithRetry: vi.fn(),
	isUsableModel: vi.fn().mockReturnValue(true),
	logWarning: vi.fn(),
}));

import { setupProvider } from "../provider-helper.ts";
import nvidiaProvider from "../providers/nvidia.ts";
import { fetchWithRetry, isUsableModel } from "../util.ts";

describe("NVIDIA Provider", () => {
	let mockPi: ExtensionAPI;
	let mockRegisterProvider: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.clearAllMocks();
		mockRegisterProvider = vi.fn();

		mockPi = {
			registerProvider: mockRegisterProvider,
		} as unknown as ExtensionAPI;
	});

	describe("initialization", () => {
		it("should register provider with models", async () => {
			const mockModelsDevResponse = {
				nvidia: {
					id: "nvidia",
					models: {
						"llama-3-70b": {
							id: "llama-3-70b",
							name: "Llama 3 70B",
							reasoning: true,
							cost: { input: 0, output: 0 },
							limit: { context: 128000, output: 4096 },
							modalities: { input: ["text"] },
						},
					},
				},
			};

			vi.mocked(fetchWithRetry).mockResolvedValue({
				ok: true,
				json: vi.fn().mockResolvedValue(mockModelsDevResponse),
			} as unknown as Response);

			await nvidiaProvider(mockPi);

			expect(mockRegisterProvider).toHaveBeenCalledWith(
				"nvidia",
				expect.objectContaining({
					baseUrl: "https://integrate.api.nvidia.com/v1",
					apiKey: "NVIDIA_API_KEY",
					api: "openai-completions",
					models: expect.any(Array),
				}),
			);
		});

		it("should skip registration without API key", async () => {
			// Mock no API key
			const configModule = await import("../config.ts");
			vi.spyOn(configModule, "NVIDIA_API_KEY", "get").mockReturnValue(
				undefined as any,
			);

			await nvidiaProvider(mockPi);

			expect(mockRegisterProvider).not.toHaveBeenCalled();
		});
	});

	describe("model filtering", () => {
		it("should filter by minimum size", async () => {
			const mockModelsDevResponse = {
				nvidia: {
					id: "nvidia",
					models: {
						"small-model": { id: "small-model", name: "Small" },
						"large-model": { id: "large-model", name: "Large" },
					},
				},
			};

			vi.mocked(fetchWithRetry).mockResolvedValue({
				ok: true,
				json: vi.fn().mockResolvedValue(mockModelsDevResponse),
			} as unknown as Response);

			// First call allows small, second rejects
			vi.mocked(isUsableModel)
				.mockReturnValueOnce(false)
				.mockReturnValueOnce(true);

			await nvidiaProvider(mockPi);

			expect(isUsableModel).toHaveBeenCalledWith("small-model", 70);
			expect(isUsableModel).toHaveBeenCalledWith("large-model", 70);
		});
	});

	describe("setupProvider integration", () => {
		it("should call setupProvider", async () => {
			vi.mocked(fetchWithRetry).mockResolvedValue({
				ok: true,
				json: vi
					.fn()
					.mockResolvedValue({ nvidia: { id: "nvidia", models: {} } }),
			} as unknown as Response);

			await nvidiaProvider(mockPi);

			expect(setupProvider).toHaveBeenCalledWith(
				mockPi,
				expect.objectContaining({
					providerId: "nvidia",
				}),
				expect.any(Object),
			);
		});
	});
});
