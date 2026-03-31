/**
 * Zen Provider Tests
 */

import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@mariozechner/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies
vi.mock("../config.ts", () => ({
	OPENCODE_API_KEY: "test-key",
	ZEN_SHOW_PAID: false,
	PROVIDER_ZEN: "zen",
	applyHidden: (models: ProviderModelConfig[]) => models,
}));

vi.mock("../constants.ts", () => ({
	BASE_URL_ZEN: "https://opencode.ai/zen/v1",
	DEFAULT_FETCH_TIMEOUT_MS: 10000,
	URL_MODELS_DEV: "https://models.dev/api.json",
	URL_ZEN_TOS: "https://opencode.ai/terms",
}));

vi.mock("../provider-helper.ts", () => ({
	setupProvider: vi.fn(),
}));

vi.mock("../util.ts", () => ({
	fetchWithRetry: vi.fn(),
	logWarning: vi.fn(),
}));

import { setupProvider } from "../provider-helper.ts";
import zenProvider from "../providers/zen.ts";
import { fetchWithRetry } from "../util.ts";

describe("Zen Provider", () => {
	let mockPi: ExtensionAPI;
	let mockOn: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.clearAllMocks();
		mockOn = vi.fn();

		mockPi = {
			on: mockOn,
		} as unknown as ExtensionAPI;
	});

	describe("initialization", () => {
		it("should register event handlers", async () => {
			vi.mocked(fetchWithRetry).mockResolvedValue({
				ok: true,
				json: vi.fn().mockResolvedValue({ data: [{ id: "test-model" }] }),
			} as unknown as Response);

			await zenProvider(mockPi);

			expect(mockOn).toHaveBeenCalledWith(
				"session_start",
				expect.any(Function),
			);
			expect(mockOn).toHaveBeenCalledWith(
				"before_agent_start",
				expect.any(Function),
			);
		});
	});

	describe("session_start handling", () => {
		it("should fetch and register models", async () => {
			const gatewayModels = {
				data: [{ id: "big-pickle" }, { id: "mimo-v2-pro-free" }],
			};
			const modelsDevResponse = {
				opencode: {
					id: "opencode",
					models: {
						"big-pickle": {
							id: "big-pickle",
							name: "Big Pickle",
							reasoning: true,
							cost: { input: 0, output: 0 },
							limit: { context: 200000, output: 128000 },
							modalities: { input: ["text"] },
						},
					},
				},
			};

			vi.mocked(fetchWithRetry)
				.mockResolvedValueOnce({
					ok: true,
					json: vi.fn().mockResolvedValue(gatewayModels),
				} as unknown as Response)
				.mockResolvedValueOnce({
					ok: true,
					json: vi.fn().mockResolvedValue(modelsDevResponse),
				} as unknown as Response);

			await zenProvider(mockPi);

			const sessionStartHandler = mockOn.mock.calls.find(
				(call) => call[0] === "session_start",
			)?.[1];

			const mockRegisterProvider = vi.fn();
			const mockCtx = {
				modelRegistry: {
					getAvailable: vi.fn().mockReturnValue([]),
					registerProvider: mockRegisterProvider,
				},
			};

			await sessionStartHandler({}, mockCtx);

			expect(mockRegisterProvider).toHaveBeenCalledWith(
				"zen",
				expect.objectContaining({
					baseUrl: "https://opencode.ai/zen/v1",
					apiKey: "PI_FREE_ZEN_API_KEY",
					headers: expect.objectContaining({
						"X-Title": "Pi",
						"x-opencode-session": expect.any(String),
					}),
				}),
			);
		});
	});

	describe("fallback behavior", () => {
		it("should use static fallback when API fails", async () => {
			vi.mocked(fetchWithRetry).mockRejectedValue(new Error("Network error"));

			await zenProvider(mockPi);

			const sessionStartHandler = mockOn.mock.calls.find(
				(call) => call[0] === "session_start",
			)?.[1];

			const mockRegisterProvider = vi.fn();
			const mockCtx = {
				modelRegistry: {
					getAvailable: vi.fn().mockReturnValue([]),
					registerProvider: mockRegisterProvider,
				},
			};

			await sessionStartHandler({}, mockCtx);

			// When API fails, it should not register (let Pi use built-in)
			expect(mockRegisterProvider).not.toHaveBeenCalled();
		});
	});

	describe("setupProvider integration", () => {
		it("should call setupProvider with correct config", async () => {
			vi.mocked(fetchWithRetry).mockResolvedValue({
				ok: true,
				json: vi.fn().mockResolvedValue({ data: [] }),
			} as unknown as Response);

			await zenProvider(mockPi);

			expect(setupProvider).toHaveBeenCalledWith(
				mockPi,
				expect.objectContaining({
					providerId: "zen",
					tosUrl: "https://opencode.ai/terms",
					hasKey: true,
				}),
				expect.any(Object),
			);
		});
	});
});
