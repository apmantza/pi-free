import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetGlobalFreeOnly = vi.fn();
const mockGetOpencodeShowPaid = vi.fn();
const mockGetOpenrouterShowPaid = vi.fn();
const mockGetOpencodeApiKey = vi.fn();
const mockGetOpenrouterApiKey = vi.fn();
const mockSaveConfig = vi.fn();
const mockRegisterWithGlobalToggle = vi.fn();
const mockProviderRegistry = new Map<string, unknown>();

vi.mock("../config.ts", () => ({
	getOpencodeApiKey: () => mockGetOpencodeApiKey(),
	getOpencodeShowPaid: () => mockGetOpencodeShowPaid(),
	getOpenrouterApiKey: () => mockGetOpenrouterApiKey(),
	getOpenrouterShowPaid: () => mockGetOpenrouterShowPaid(),
	saveConfig: (...args: unknown[]) => mockSaveConfig(...args),
}));

vi.mock("../lib/registry.ts", () => ({
	getGlobalFreeOnly: () => mockGetGlobalFreeOnly(),
	getProviderRegistry: () => mockProviderRegistry,
	isFreeModel: (
		model: {
			name: string;
			cost?: { input?: number; output?: number };
			_pricingKnown?: boolean;
			_freeKnown?: boolean;
			_isFree?: boolean;
		},
		allModels?: Array<{
			cost?: { input?: number; output?: number };
		}>,
	) => {
		if (model._freeKnown === true) return model._isFree === true;
		const pricingExposed = (allModels ?? []).some(
			(m) => (m.cost?.input ?? 0) > 0 || (m.cost?.output ?? 0) > 0,
		);
		const hasFreeInName = model.name.toLowerCase().includes("free");
		if (!pricingExposed || model._pricingKnown === false) return hasFreeInName;
		return (
			((model.cost?.input ?? 0) === 0 && (model.cost?.output ?? 0) === 0) ||
			hasFreeInName
		);
	},
	registerWithGlobalToggle: (...args: unknown[]) =>
		mockRegisterWithGlobalToggle(...args),
}));

describe("built-in provider toggles", () => {
	let mockPi: ExtensionAPI;
	let handlers: Record<string, Function>;
	let commands: Record<string, Function>;
	let mockRegisterProvider: ReturnType<typeof vi.fn>;
	let setupBuiltInProviderToggles: typeof import("../lib/built-in-toggle.ts")["setupBuiltInProviderToggles"];

	beforeEach(async () => {
		vi.clearAllMocks();
		vi.resetModules();
		handlers = {};
		commands = {};
		mockRegisterProvider = vi.fn();
		mockProviderRegistry.clear();
		mockGetGlobalFreeOnly.mockReturnValue(true);
		mockGetOpencodeShowPaid.mockReturnValue(false);
		mockGetOpenrouterShowPaid.mockReturnValue(false);
		mockGetOpencodeApiKey.mockReturnValue(undefined);
		mockGetOpenrouterApiKey.mockReturnValue(undefined);
		globalThis.fetch = vi.fn();

		mockPi = {
			registerCommand: vi.fn((name: string, config: { handler: Function }) => {
				commands[name] = config.handler;
			}),
			registerProvider: mockRegisterProvider,
			on: vi.fn((event: string, handler: Function) => {
				handlers[event] = handler;
			}),
		} as unknown as ExtensionAPI;

		({ setupBuiltInProviderToggles } = await import(
			"../lib/built-in-toggle.ts"
		));
	});

	it("applies saved show-paid mode after capturing built-in models", async () => {
		mockGetOpencodeShowPaid.mockReturnValue(true);
		setupBuiltInProviderToggles(mockPi);

		const allModels = [
			{
				provider: "opencode",
				id: "free-model",
				name: "Free Model",
				api: "openai-completions",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128000,
				maxTokens: 4096,
				baseUrl: "https://example.com",
			},
			{
				provider: "opencode",
				id: "paid-model",
				name: "Paid Model",
				api: "openai-completions",
				reasoning: false,
				input: ["text"],
				cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128000,
				maxTokens: 4096,
				baseUrl: "https://example.com",
			},
		];

		await handlers.session_start(
			{},
			{
				modelRegistry: {
					getAvailable: () => allModels,
				},
			},
		);

		expect(mockRegisterProvider).toHaveBeenCalledWith(
			"opencode",
			expect.objectContaining({
				api: "opencode-dynamic",
				apiKey: "$OPENCODE_API_KEY",
				streamSimple: expect.any(Function),
				models: expect.arrayContaining([
					expect.objectContaining({
						id: "free-model",
						api: "opencode-dynamic",
					}),
					expect.objectContaining({
						id: "paid-model",
						api: "opencode-dynamic",
					}),
				]),
			}),
		);
	});

	it("skips fallback capture for providers already registered dynamically", () => {
		mockProviderRegistry.set("opencode", {});
		mockProviderRegistry.set("opencode-go", {});
		mockProviderRegistry.set("openrouter", {});

		setupBuiltInProviderToggles(mockPi);

		expect(mockPi.registerCommand).not.toHaveBeenCalled();
		expect(mockPi.on).not.toHaveBeenCalled();
	});

	it("discovers OpenCode models on-demand when Pi registry has not loaded them", async () => {
		mockGetOpencodeApiKey.mockReturnValue("opencode-token");
		setupBuiltInProviderToggles(mockPi);

		vi.mocked(globalThis.fetch).mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({
				data: [
					{ id: "claude-fable-5", object: "model" },
					{ id: "deepseek-v4-flash-free", object: "model" },
				],
			}),
		} as unknown as Response);

		const notify = vi.fn();
		await commands["toggle-opencode"](
			{},
			{
				ui: { notify },
				modelRegistry: { getAvailable: () => [] },
			},
		);

		expect(globalThis.fetch).toHaveBeenCalledWith(
			"https://opencode.ai/zen/v1/models",
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: "Bearer opencode-token",
				}),
			}),
		);
		expect(mockRegisterProvider).toHaveBeenCalledWith(
			"opencode",
			expect.objectContaining({
				api: "opencode-dynamic",
				apiKey: "opencode-token",
				streamSimple: expect.any(Function),
				models: expect.arrayContaining([
					expect.objectContaining({ id: "claude-fable-5" }),
					expect.objectContaining({ id: "deepseek-v4-flash-free" }),
				]),
			}),
		);
		const registeredModels = mockRegisterProvider.mock.calls[0][1].models;
		const paidModel = registeredModels.find(
			(m: { id: string }) => m.id === "claude-fable-5",
		);
		const freeModel = registeredModels.find(
			(m: { id: string }) => m.id === "deepseek-v4-flash-free",
		);
		expect(paidModel).toMatchObject({
			_pricingKnown: false,
			_freeKnown: true,
			_isFree: false,
			cost: expect.objectContaining({ input: 0.000001, output: 0.000001 }),
		});
		expect(freeModel).toMatchObject({
			_pricingKnown: false,
			_freeKnown: true,
			_isFree: true,
			cost: expect.objectContaining({ input: 0, output: 0 }),
		});
		expect(notify).toHaveBeenCalledWith(
			"opencode: showing all 2 models",
			"info",
		);
	});

	it("keeps warning when registry is empty and on-demand discovery has no key", async () => {
		setupBuiltInProviderToggles(mockPi);

		const notify = vi.fn();
		await commands["toggle-opencode"](
			{},
			{
				ui: { notify },
				modelRegistry: { getAvailable: () => [] },
			},
		);

		expect(globalThis.fetch).not.toHaveBeenCalled();
		expect(notify).toHaveBeenCalledWith(
			"opencode: models not loaded yet and on-demand discovery failed. Check your API key, then try again.",
			"warning",
		);
	});

	it("toggles from the actual current mode instead of an assumed boolean", async () => {
		mockGetOpencodeShowPaid.mockReturnValue(true);
		setupBuiltInProviderToggles(mockPi);

		const allModels = [
			{
				provider: "opencode",
				id: "free-model",
				name: "Free Model",
				api: "openai-completions",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128000,
				maxTokens: 4096,
				baseUrl: "https://example.com",
			},
			{
				provider: "opencode",
				id: "paid-model",
				name: "Paid Model",
				api: "openai-completions",
				reasoning: false,
				input: ["text"],
				cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128000,
				maxTokens: 4096,
				baseUrl: "https://example.com",
			},
		];

		await handlers.session_start(
			{},
			{
				modelRegistry: {
					getAvailable: () => allModels,
				},
			},
		);

		const notify = vi.fn();
		await commands["toggle-opencode"]({}, { ui: { notify } });

		expect(mockSaveConfig).toHaveBeenCalledWith({ opencode_show_paid: false });
		expect(mockRegisterProvider).toHaveBeenLastCalledWith(
			"opencode",
			expect.objectContaining({
				models: [expect.objectContaining({ id: "free-model" })],
			}),
		);
		expect(notify).toHaveBeenCalledWith(
			"opencode: showing 1 free models",
			"info",
		);
	});
});
