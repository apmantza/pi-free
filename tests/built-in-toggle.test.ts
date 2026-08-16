import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetGlobalFreeOnly = vi.fn();
const mockGetOpencodeShowPaid = vi.fn();
const mockGetOpenrouterShowPaid = vi.fn();
const mockGetOpenrouterApiKey = vi.fn();
const mockSaveConfig = vi.fn();
const mockRegisterWithGlobalToggle = vi.fn();
const mockProviderRegistry = new Map<string, unknown>();

/**
 * Session-start capture is detached (fires after the handler returns), so
 * tests asserting its effects must let the pending task settle first.
 */
async function settleDetachedCapture(): Promise<void> {
	for (let i = 0; i < 10; i += 1) {
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
}

vi.mock("../config.ts", () => ({
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
		mockGetOpenrouterApiKey.mockReturnValue(undefined);

		mockPi = {
			registerCommand: vi.fn((name: string, config: { handler: Function }) => {
				commands[name] = config.handler;
			}),
			registerProvider: mockRegisterProvider,
			on: vi.fn((event: string, handler: Function) => {
				handlers[event] = handler;
			}),
		} as unknown as ExtensionAPI;

		({ setupBuiltInProviderToggles } = await import("../lib/built-in-toggle.ts"));
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
		await settleDetachedCapture();

		expect(mockRegisterProvider).toHaveBeenCalledWith(
			"opencode-free",
			expect.objectContaining({
				api: "opencode-dynamic",
				apiKey: "$OPENCODE_API_KEY",
				streamSimple: expect.any(Function),
				models: expect.arrayContaining([
					expect.objectContaining({
						id: "free-model",
						api: "openai-completions",
					}),
					expect.objectContaining({
						id: "paid-model",
						api: "openai-completions",
					}),
				]),
			}),
		);
	});

	it("returns from session_start before the capture completes (detached)", async () => {
		setupBuiltInProviderToggles(mockPi);

		let resolveKey: ((key: string | undefined) => void) | undefined;
		const keyGate = new Promise<string | undefined>((resolve) => {
			resolveKey = resolve;
		});

		await handlers.session_start(
			{},
			{
				modelRegistry: {
					getAvailable: () => [
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
					],
					// Simulate a slow credential resolution (the real-world
					// session-start stall this detach fixes).
					getApiKeyForProvider: () => keyGate,
				},
			},
		);

		// Handler returned, but capture is still waiting on the credential.
		expect(mockRegisterProvider).not.toHaveBeenCalled();

		resolveKey?.(undefined);
		await settleDetachedCapture();

		expect(mockRegisterProvider).toHaveBeenCalledWith(
			"opencode-free",
			expect.objectContaining({ api: "opencode-dynamic" }),
		);
	});

	it("registers into the latest registry when session_start fires again mid-capture", async () => {
		setupBuiltInProviderToggles(mockPi);

		let resolveKey: ((key: string | undefined) => void) | undefined;
		const keyGate = new Promise<string | undefined>((resolve) => {
			resolveKey = resolve;
		});
		const models = [
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
		];
		const firstRegistry = {
			getAvailable: () => models,
			getApiKeyForProvider: () => keyGate,
			registerProvider: vi.fn(),
		};
		const secondRegistry = {
			getAvailable: () => models,
			getApiKeyForProvider: () => keyGate,
			registerProvider: vi.fn(),
		};

		await handlers.session_start({}, { modelRegistry: firstRegistry });
		// Pi fires session_start again while the capture is still resolving
		// credentials; the fresh registry must win.
		await handlers.session_start({}, { modelRegistry: secondRegistry });

		resolveKey?.(undefined);
		await settleDetachedCapture();

		expect(firstRegistry.registerProvider).not.toHaveBeenCalled();
		expect(secondRegistry.registerProvider).toHaveBeenCalledWith(
			"opencode-free",
			expect.objectContaining({ api: "opencode-dynamic" }),
		);
	});

	it("toggle waits for an in-flight detached capture instead of racing it", async () => {
		setupBuiltInProviderToggles(mockPi);

		let resolveKey: ((key: string | undefined) => void) | undefined;
		const keyGate = new Promise<string | undefined>((resolve) => {
			resolveKey = resolve;
		});
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
					getApiKeyForProvider: () => keyGate,
					registerProvider: mockRegisterProvider,
				},
			},
		);

		// Toggle while the capture is still pending: it must await the
		// in-flight capture, not start its own.
		const notify = vi.fn();
		const toggleDone = commands["toggle-opencode-free"]({}, { ui: { notify } });
		resolveKey?.(undefined);
		await toggleDone;

		// Exactly one capture: the detached initial apply (free view) plus the
		// user's toggle to all — no extra racy capture in between.
		expect(mockRegisterWithGlobalToggle).toHaveBeenCalledTimes(1);
		expect(mockRegisterProvider).toHaveBeenCalledTimes(2);
		expect(notify).toHaveBeenCalledWith("opencode-free: showing all 2 models", "info");
		expect(mockRegisterProvider).toHaveBeenLastCalledWith(
			"opencode-free",
			expect.objectContaining({ models: expect.any(Array) }),
		);
		const lastModels = mockRegisterProvider.mock.calls.at(-1)?.[1]
			.models as Array<{ id: string }>;
		expect(lastModels.map((m) => m.id).sort()).toEqual([
			"free-model",
			"paid-model",
		]);
	});

	it("clears stale pending captures when a new runner registers", async () => {
		setupBuiltInProviderToggles(mockPi);

		// Hang the first runner's capture forever (credential refresh stall).
		const hungGate = new Promise<string | undefined>(() => {});
		const models = [
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
		];
		await handlers.session_start(
			{},
			{
				modelRegistry: {
					getAvailable: () => models,
					getApiKeyForProvider: () => hungGate,
					registerProvider: vi.fn(),
				},
			},
		);

		// Extension reload: a new runner registers; the stale pending entry must
		// not block the new runner's capture.
		const mockPi2 = {
			registerCommand: vi.fn((name: string, config: { handler: Function }) => {
				commands[name] = config.handler;
			}),
			registerProvider: mockRegisterProvider,
			on: vi.fn((event: string, handler: Function) => {
				handlers[event] = handler;
			}),
		} as unknown as ExtensionAPI;
		setupBuiltInProviderToggles(mockPi2);

		const freshRegistry = {
			getAvailable: () => models,
			registerProvider: vi.fn(),
		};
		await handlers.session_start({}, { modelRegistry: freshRegistry });
		await settleDetachedCapture();

		expect(freshRegistry.registerProvider).toHaveBeenCalledWith(
			"opencode-free",
			expect.objectContaining({ api: "opencode-dynamic" }),
		);
	});

	it("captures the full catalog when models are not auth-available", async () => {
		setupBuiltInProviderToggles(mockPi);

		const model = {
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
		};
		const registerProvider = vi.fn();

		await handlers.session_start(
			{},
			{
				modelRegistry: {
					getAll: () => [model],
					getAvailable: () => [],
					getApiKeyForProvider: async (providerId: string) =>
						providerId === "opencode-go" ? "shared-key" : undefined,
					registerProvider,
				},
			},
		);
		await settleDetachedCapture();

		expect(registerProvider).toHaveBeenCalledWith(
			"opencode-free",
			expect.objectContaining({
				apiKey: "shared-key",
				models: [expect.objectContaining({ id: "free-model" })],
			}),
		);
	});

	it("preserves Pi-managed OpenRouter OAuth when toggling captured models", async () => {
		setupBuiltInProviderToggles(mockPi);

		const models = [
			{
				provider: "openrouter",
				id: "free-model",
				name: "Free Model",
				api: "openai-completions",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128000,
				maxTokens: 4096,
				baseUrl: "https://openrouter.ai/api/v1",
			},
			{
				provider: "openrouter",
				id: "paid-model",
				name: "Paid Model",
				api: "openai-completions",
				reasoning: false,
				input: ["text"],
				cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128000,
				maxTokens: 4096,
				baseUrl: "https://openrouter.ai/api/v1",
			},
		];

		await handlers.session_start(
			{},
			{ modelRegistry: { getAvailable: () => models } },
		);
		await settleDetachedCapture();
		await commands["toggle-openrouter"]({}, { ui: { notify: vi.fn() } });

		expect(mockRegisterProvider).toHaveBeenLastCalledWith(
			"openrouter",
			expect.not.objectContaining({ apiKey: expect.anything() }),
		);
	});

	it("skips fallback capture for providers already registered dynamically", () => {
		mockProviderRegistry.set("opencode-free", {});
		mockProviderRegistry.set("opencode-go", {});
		mockProviderRegistry.set("openrouter", {});

		setupBuiltInProviderToggles(mockPi);

		expect(mockPi.registerCommand).not.toHaveBeenCalled();
		expect(mockPi.on).not.toHaveBeenCalled();
	});

	it("does not perform on-demand discovery when built-in models are unavailable", async () => {
		setupBuiltInProviderToggles(mockPi);

		const notify = vi.fn();
		await commands["toggle-opencode-free"](
			{},
			{
				ui: { notify },
				modelRegistry: { getAvailable: () => [] },
			},
		);

		expect(notify).toHaveBeenCalledWith(
			"opencode-free: models not loaded yet. Start a session first, then try again.",
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
		await settleDetachedCapture();

		const notify = vi.fn();
		await commands["toggle-opencode-free"]({}, { ui: { notify } });

		expect(mockSaveConfig).toHaveBeenCalledWith({ "opencode-free_show_paid": false });
		expect(mockRegisterProvider).toHaveBeenLastCalledWith(
			"opencode-free",
			expect.objectContaining({
				models: [expect.objectContaining({ id: "free-model" })],
			}),
		);
		expect(notify).toHaveBeenCalledWith(
			"opencode-free: showing 1 free models",
			"info",
		);
	});
});
