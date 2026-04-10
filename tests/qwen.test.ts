/**
 * Qwen OAuth Provider Tests
 *
 * Free tier — all models are free, so test that all are shown.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies
vi.mock("../constants.ts", () => ({
	BASE_URL_QWEN: "https://dashscope.aliyuncs.com/compatible-mode/v1",
	URL_QWEN_TOS: "https://terms.alicloud.com/",
	PROVIDER_QWEN: "qwen",
}));

vi.mock("../provider-helper.ts", () => ({
	enhanceWithCI: (models: unknown[]) => models,
	createReRegister: vi.fn(() => vi.fn()),
	setupProvider: vi.fn(),
}));

vi.mock("../usage/metrics.ts", () => ({
	incrementRequestCount: vi.fn(),
}));

vi.mock("../lib/logger.ts", () => ({
	createLogger: () => ({
		warn: vi.fn(),
		info: vi.fn(),
		debug: vi.fn(),
		error: vi.fn(),
	}),
}));

vi.mock("../lib/util.ts", () => ({
	logWarning: vi.fn(),
}));

vi.mock("../providers/qwen-auth.ts", () => ({
	loginQwen: vi.fn(),
	refreshQwenToken: vi.fn(),
	getQwenBaseUrl: vi.fn(
		() => "https://dashscope.aliyuncs.com/compatible-mode/v1",
	),
}));

vi.mock("../providers/qwen-models.ts", () => ({
	fetchQwenModels: vi.fn(),
	QWEN_FREE_MODELS: [
		{
			id: "coder-model",
			name: "Qwen 3.6 Plus (Coder) — Free 1k/day",
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 131_072,
			maxTokens: 16_384,
		},
	],
}));

import { setupProvider } from "../provider-helper.ts";
import { loginQwen } from "../providers/qwen-auth.ts";
import { fetchQwenModels } from "../providers/qwen-models.ts";
import { incrementRequestCount } from "../usage/metrics.ts";

const MOCK_MODEL = {
	id: "coder-model",
	name: "Qwen 3.6 Plus (Coder) — Free 1k/day",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 131_072,
	maxTokens: 16_384,
};

describe("Qwen OAuth Provider", () => {
	let mockPi: ExtensionAPI;
	let mockRegisterProvider: ReturnType<typeof vi.fn>;
	let mockOn: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.clearAllMocks();
		mockRegisterProvider = vi.fn();
		mockOn = vi.fn();

		mockPi = {
			registerProvider: mockRegisterProvider,
			registerCommand: vi.fn(),
			on: mockOn,
		} as unknown as ExtensionAPI;
	});

	describe("initialization", () => {
		it("should register provider with OAuth config", async () => {
			vi.mocked(fetchQwenModels).mockResolvedValue([MOCK_MODEL]);

			const { default: qwenProvider } = await import(
				"../providers/qwen.ts"
			);
			await qwenProvider(mockPi);

			expect(mockRegisterProvider).toHaveBeenCalledWith(
				"qwen",
				expect.objectContaining({
					baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
					apiKey: "QWEN_API_KEY",
					api: "openai-completions",
					models: [MOCK_MODEL],
					oauth: expect.objectContaining({
						name: "Qwen",
						login: expect.any(Function),
						refreshToken: expect.any(Function),
						getApiKey: expect.any(Function),
					}),
				}),
			);
		});

		it("should register event handlers", async () => {
			vi.mocked(fetchQwenModels).mockResolvedValue([MOCK_MODEL]);

			const { default: qwenProvider } = await import(
				"../providers/qwen.ts"
			);
			await qwenProvider(mockPi);

			expect(mockOn).toHaveBeenCalledWith("turn_end", expect.any(Function));
			expect(mockOn).toHaveBeenCalledWith(
				"before_provider_request",
				expect.any(Function),
			);
		});
	});

	describe("free tier — all models shown", () => {
		it("should show all models as free (zero cost)", async () => {
			vi.mocked(fetchQwenModels).mockResolvedValue([MOCK_MODEL]);

			const { default: qwenProvider } = await import(
				"../providers/qwen.ts"
			);
			await qwenProvider(mockPi);

			// setupProvider should receive stored models where free === all
			expect(setupProvider).toHaveBeenCalledWith(
				mockPi,
				expect.objectContaining({ providerId: "qwen" }),
				expect.objectContaining({
					free: expect.any(Array),
					all: expect.any(Array),
				}),
			);

			// Both free and all should have the same models
			const storedArg = vi.mocked(setupProvider).mock.calls[0][2];
			expect(storedArg.free).toEqual(storedArg.all);
			expect(storedArg.free.length).toBeGreaterThan(0);

			// All models should have zero cost
			for (const model of storedArg.free) {
				expect(model.cost.input).toBe(0);
				expect(model.cost.output).toBe(0);
			}
		});

		it("should include coder-model in the free tier", async () => {
			vi.mocked(fetchQwenModels).mockResolvedValue([MOCK_MODEL]);

			const { default: qwenProvider } = await import(
				"../providers/qwen.ts"
			);
			await qwenProvider(mockPi);

			const registerCall = mockRegisterProvider.mock.calls[0];
			const models = registerCall?.[1]?.models;

			expect(models).toHaveLength(1);
			expect(models[0].id).toBe("coder-model");
			expect(models[0].contextWindow).toBe(131_072);
			expect(models[0].maxTokens).toBe(16_384);
		});
	});

	describe("OAuth integration", () => {
		it("should call loginQwen on OAuth login", async () => {
			vi.mocked(fetchQwenModels).mockResolvedValue([MOCK_MODEL]);

			const mockCreds = {
				access: "qwen-access-token",
				refresh: "resource.dashscope.aliyuncs.com::refresh-token",
				expires: Date.now() + 3600000,
			};
			vi.mocked(loginQwen).mockResolvedValue(mockCreds);

			const { default: qwenProvider } = await import(
				"../providers/qwen.ts"
			);
			await qwenProvider(mockPi);

			const oauth = mockRegisterProvider.mock.calls[0][1].oauth;
			const result = await oauth.login({ onProgress: vi.fn() });

			expect(loginQwen).toHaveBeenCalled();
			expect(result).toEqual(mockCreds);
		});

		it("should use access token as API key", async () => {
			vi.mocked(fetchQwenModels).mockResolvedValue([MOCK_MODEL]);

			const { default: qwenProvider } = await import(
				"../providers/qwen.ts"
			);
			await qwenProvider(mockPi);

			const oauth = mockRegisterProvider.mock.calls[0][1].oauth;
			const apiKey = oauth.getApiKey({
				access: "my-access-token",
				refresh: "refresh",
				expires: Date.now() + 3600000,
			});

			expect(apiKey).toBe("my-access-token");
		});
	});

	describe("request tracking", () => {
		it("should track requests on turn_end for qwen provider", async () => {
			vi.mocked(fetchQwenModels).mockResolvedValue([MOCK_MODEL]);

			const { default: qwenProvider } = await import(
				"../providers/qwen.ts"
			);
			await qwenProvider(mockPi);

			// Find turn_end handler
			const turnEndCall = mockOn.mock.calls.find(
				(call: unknown[]) => call[0] === "turn_end",
			);
			expect(turnEndCall).toBeDefined();

			const handler = turnEndCall![1];
			const mockCtx = { model: { provider: "qwen" } };
			await handler({}, mockCtx);

			expect(incrementRequestCount).toHaveBeenCalledWith("qwen");
		});

		it("should not track requests for other providers", async () => {
			vi.mocked(fetchQwenModels).mockResolvedValue([MOCK_MODEL]);

			const { default: qwenProvider } = await import(
				"../providers/qwen.ts"
			);
			await qwenProvider(mockPi);

			const turnEndCall = mockOn.mock.calls.find(
				(call: unknown[]) => call[0] === "turn_end",
			);
			const handler = turnEndCall![1];

			// Different provider
			const mockCtx = { model: { provider: "openrouter" } };
			await handler({}, mockCtx);

			expect(incrementRequestCount).not.toHaveBeenCalled();
		});
	});

	describe("setupProvider integration", () => {
		it("should call setupProvider with correct config", async () => {
			vi.mocked(fetchQwenModels).mockResolvedValue([MOCK_MODEL]);

			const { default: qwenProvider } = await import(
				"../providers/qwen.ts"
			);
			await qwenProvider(mockPi);

			expect(setupProvider).toHaveBeenCalledWith(
				mockPi,
				expect.objectContaining({
					providerId: "qwen",
					tosUrl: "https://terms.alicloud.com/",
					initialShowPaid: false,
				}),
				expect.objectContaining({
					free: expect.any(Array),
					all: expect.any(Array),
				}),
			);
		});
	});
});
