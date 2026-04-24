import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetGlobalFreeOnly = vi.fn();
const mockGetOpencodeShowPaid = vi.fn();
const mockGetOpenrouterShowPaid = vi.fn();
const mockSaveConfig = vi.fn();
const mockRegisterWithGlobalToggle = vi.fn();

vi.mock("../config.ts", () => ({
	getOpencodeShowPaid: () => mockGetOpencodeShowPaid(),
	getOpenrouterShowPaid: () => mockGetOpenrouterShowPaid(),
	saveConfig: (...args: unknown[]) => mockSaveConfig(...args),
}));

vi.mock("../lib/registry.ts", () => ({
	getGlobalFreeOnly: () => mockGetGlobalFreeOnly(),
	isFreeModel: (model: { cost?: { input?: number; output?: number } }) =>
		(model.cost?.input ?? 0) === 0 && (model.cost?.output ?? 0) === 0,
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
		mockGetGlobalFreeOnly.mockReturnValue(true);
		mockGetOpencodeShowPaid.mockReturnValue(false);
		mockGetOpenrouterShowPaid.mockReturnValue(false);

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
				models: expect.arrayContaining([
					expect.objectContaining({ id: "free-model" }),
					expect.objectContaining({ id: "paid-model" }),
				]),
			}),
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
