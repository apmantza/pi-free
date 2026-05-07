/**
 * Cline Provider Tests
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies
vi.mock("../constants.ts", () => ({
	BASE_URL_CLINE: "https://api.cline.bot/api/v1",
	PROVIDER_CLINE: "cline",
}));

vi.mock("../lib/registry.ts", () => ({
	registerWithGlobalToggle: vi.fn(),
	isFreeModel: (m: any) => (m.cost?.input ?? 0) === 0,
	getGlobalFreeOnly: () => false,
}));

const mockGetClineShowPaid = vi.fn();
const mockSaveConfig = vi.fn();

vi.mock("../lib/util.ts", () => ({
	logWarning: vi.fn(),
}));

vi.mock("../config.ts", () => ({
	getClineShowPaid: () => mockGetClineShowPaid(),
	saveConfig: (...args: unknown[]) => mockSaveConfig(...args),
}));

vi.mock("../providers/cline/cline-auth.ts", () => ({
	loginCline: vi.fn(),
	refreshClineToken: vi.fn(),
}));

vi.mock("../providers/cline/cline-models.ts", () => ({
	fetchClineModels: vi.fn(),
}));

vi.mock("../provider-helper.ts", () => ({
	enhanceWithCI: (models: unknown[]) => models,
}));

import clineProvider from "../providers/cline/cline.ts";
import { loginCline } from "../providers/cline/cline-auth.ts";
import { fetchClineModels } from "../providers/cline/cline-models.ts";

describe("Cline Provider", () => {
	let mockPi: ExtensionAPI;
	let mockRegisterProvider: ReturnType<typeof vi.fn>;
	let mockOn: ReturnType<typeof vi.fn>;
	let commandHandlers: Record<string, Function>;

	beforeEach(() => {
		vi.clearAllMocks();
		mockRegisterProvider = vi.fn();
		mockOn = vi.fn();
		commandHandlers = {};
		mockGetClineShowPaid.mockReturnValue(false);

		mockPi = {
			registerProvider: mockRegisterProvider,
			on: mockOn,
			registerCommand: vi.fn((name: string, config: { handler: Function }) => {
				commandHandlers[name] = config.handler;
			}),
		} as unknown as ExtensionAPI;
	});

	describe("initialization", () => {
		it("should register provider with models", async () => {
			const mockModels = [
				{
					id: "claude-3-5-sonnet",
					name: "Claude 3.5 Sonnet",
					reasoning: true,
					input: ["text" as const],
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					contextWindow: 200000,
					maxTokens: 8192,
				},
			];

			vi.mocked(fetchClineModels).mockResolvedValue(mockModels);

			await clineProvider(mockPi);

			expect(mockRegisterProvider).toHaveBeenCalledWith(
				"cline",
				expect.objectContaining({
					baseUrl: "https://api.cline.bot/api/v1",
					models: expect.any(Array), // enhanced via enhanceWithCI
					oauth: expect.any(Object),
				}),
			);
		});

		it("should register event handlers", async () => {
			vi.mocked(fetchClineModels).mockResolvedValue([]);

			await clineProvider(mockPi);

			expect(mockOn).toHaveBeenCalledWith(
				"before_agent_start",
				expect.any(Function),
			);
			expect(mockOn).toHaveBeenCalledWith("context", expect.any(Function));
			expect(mockOn).toHaveBeenCalledWith(
				"session_start",
				expect.any(Function),
			);
		});
	});

	describe("OAuth integration", () => {
		it("should have OAuth configuration", async () => {
			vi.mocked(fetchClineModels).mockResolvedValue([]);

			await clineProvider(mockPi);

			const registerCall = mockRegisterProvider.mock.calls[0];
			expect(registerCall[1]).toHaveProperty("oauth");
			expect(registerCall[1].oauth).toHaveProperty("name", "Cline");
			expect(registerCall[1].oauth).toHaveProperty("login");
			expect(registerCall[1].oauth).toHaveProperty("refreshToken");
		});

		it("should call loginCline on OAuth login", async () => {
			vi.mocked(fetchClineModels).mockResolvedValue([]);
			const mockCreds = {
				access: "token",
				refresh: "refresh",
				expires: Date.now(),
			};
			vi.mocked(loginCline).mockResolvedValue(mockCreds);

			await clineProvider(mockPi);

			const oauth = mockRegisterProvider.mock.calls[0][1].oauth;
			await oauth.login({ onProgress: vi.fn() });

			expect(loginCline).toHaveBeenCalled();
		});
	});

	describe("request handling", () => {
		it("should persist and re-apply paid mode across lifecycle hooks", async () => {
			const initialModels = [
				{
					id: "free-model",
					name: "Free Model",
					reasoning: false,
					input: ["text" as const],
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					contextWindow: 200000,
					maxTokens: 8192,
				},
				{
					id: "paid-model",
					name: "Paid Model",
					reasoning: false,
					input: ["text" as const],
					cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
					contextWindow: 200000,
					maxTokens: 8192,
				},
			];
			vi.mocked(fetchClineModels)
				.mockResolvedValueOnce(initialModels)
				.mockResolvedValueOnce(initialModels);

			await clineProvider(mockPi);
			mockRegisterProvider.mockClear();

			const notify = vi.fn();
			await commandHandlers["toggle-cline"]({}, { ui: { notify } });

			expect(mockSaveConfig).toHaveBeenCalledWith({ cline_show_paid: true });
			expect(mockRegisterProvider).toHaveBeenLastCalledWith(
				"cline",
				expect.objectContaining({
					models: expect.arrayContaining([
						expect.objectContaining({ id: "free-model" }),
						expect.objectContaining({ id: "paid-model" }),
					]),
				}),
			);

			mockRegisterProvider.mockClear();
			const beforeRequestHandler = mockOn.mock.calls.find(
				(call) => call[0] === "before_agent_start",
			)?.[1];
			await beforeRequestHandler({}, { model: { provider: "cline" } });

			expect(mockRegisterProvider).toHaveBeenCalledWith(
				"cline",
				expect.objectContaining({
					models: expect.arrayContaining([
						expect.objectContaining({ id: "free-model" }),
						expect.objectContaining({ id: "paid-model" }),
					]),
				}),
			);

			mockRegisterProvider.mockClear();
			const sessionStartHandler = mockOn.mock.calls.find(
				(call) => call[0] === "session_start",
			)?.[1];
			await sessionStartHandler(
				{},
				{ model: { provider: "cline" }, ui: { notify } },
			);

			expect(mockRegisterProvider).toHaveBeenCalledWith(
				"cline",
				expect.objectContaining({
					models: expect.arrayContaining([
						expect.objectContaining({ id: "free-model" }),
						expect.objectContaining({ id: "paid-model" }),
					]),
				}),
			);
		});

		it("should re-register provider with fresh headers on before_agent_start", async () => {
			vi.mocked(fetchClineModels).mockResolvedValue([]);

			await clineProvider(mockPi);

			// Clear calls from initial registration
			mockRegisterProvider.mockClear();

			const beforeRequestHandler = mockOn.mock.calls.find(
				(call) => call[0] === "before_agent_start",
			)?.[1];

			expect(beforeRequestHandler).toBeDefined();

			// Mock context with Cline provider selected
			const mockCtx = { model: { provider: "cline" } };
			await beforeRequestHandler({}, mockCtx);

			// Should re-register provider with fresh headers (new X-Task-ID)
			expect(mockRegisterProvider).toHaveBeenCalledWith(
				"cline",
				expect.objectContaining({
					headers: expect.objectContaining({
						"HTTP-Referer": "https://cline.bot",
						"X-Title": "Cline",
						"X-Task-ID": expect.any(String),
					}),
				}),
			);
		});

		it("should skip re-registration when different provider is active", async () => {
			vi.mocked(fetchClineModels).mockResolvedValue([]);

			await clineProvider(mockPi);

			// Clear calls from initial registration
			mockRegisterProvider.mockClear();

			const beforeRequestHandler = mockOn.mock.calls.find(
				(call) => call[0] === "before_agent_start",
			)?.[1];

			// Mock context with different provider
			const mockCtx = { model: { provider: "openrouter" } };
			await beforeRequestHandler({}, mockCtx);

			// Should not re-register when different provider is active
			expect(mockRegisterProvider).not.toHaveBeenCalled();
		});
	});
});
