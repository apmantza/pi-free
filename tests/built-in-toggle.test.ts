import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetGlobalFreeOnly = vi.fn();
const mockGetOpencodeShowPaid = vi.fn();
const mockGetOpencodeFreeShowPaid = vi.fn();
const mockGetOpencodeGoShowPaid = vi.fn();
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
	getOpencodeFreeShowPaid: () => mockGetOpencodeFreeShowPaid(),
	getOpencodeGoShowPaid: () => mockGetOpencodeGoShowPaid(),
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

// Identity enrichment: the real models.dev fetch retries 3×250ms on failure,
// which would push the detached endpoint refresh past the settle window.
vi.mock("../lib/model-metadata.ts", () => ({
	safeEnrichModelsWithModelsDev: async (models: unknown[]) => models,
}));

describe("built-in provider toggles", () => {
	let mockPi: ExtensionAPI;
	let handlers: Record<string, Function>;
	let commands: Record<string, Function>;
	let mockRegisterProvider: ReturnType<typeof vi.fn>;
	let setupBuiltInProviderToggles: typeof import("../lib/built-in-toggle.ts")["setupBuiltInProviderToggles"];

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	beforeEach(async () => {
		vi.clearAllMocks();
		vi.resetModules();
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error("network disabled in built-in-toggle tests");
			}),
		);
		handlers = {};
		commands = {};
		mockRegisterProvider = vi.fn();
		mockProviderRegistry.clear();
		mockGetGlobalFreeOnly.mockReturnValue(true);
		mockGetOpencodeShowPaid.mockReturnValue(false);
		mockGetOpencodeFreeShowPaid.mockReturnValue(false);
		mockGetOpencodeGoShowPaid.mockReturnValue(false);
		mockGetOpenrouterShowPaid.mockReturnValue(false);
		mockGetOpenrouterApiKey.mockReturnValue(undefined);

		mockPi = {
			registerCommand: vi.fn((name: string, config: { handler: Function }) => {
				commands[name] = config.handler;
			}),
			registerProvider: mockRegisterProvider,
			setModel: vi.fn(async () => true),
			on: vi.fn((event: string, handler: Function) => {
				handlers[event] = handler;
			}),
		} as unknown as ExtensionAPI;

		({ setupBuiltInProviderToggles } = await import("../lib/built-in-toggle.ts"));
	});

	it("applies saved show-paid mode after capturing built-in models", async () => {
		mockGetOpencodeFreeShowPaid.mockReturnValue(true);
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
				refreshModels: expect.any(Function),
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

	it("refreshes opencode-free from Zen after session_start without blocking it", async () => {
		setupBuiltInProviderToggles(mockPi);

		let resolveFetch: ((response: Response) => void) | undefined;
		const fetchGate = new Promise<Response>((resolve) => {
			resolveFetch = resolve;
		});
		const fetchMock = vi.fn(() => fetchGate);
		vi.stubGlobal("fetch", fetchMock);

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
			{ modelRegistry: { getAvailable: () => models } },
		);
		// The endpoint is deliberately unresolved, but session_start has already
		// returned and the initial capture can still register its baseline.
		await settleDetachedCapture();
		expect(fetchMock).toHaveBeenCalledWith(
			"https://opencode.ai/zen/v1/models",
			expect.objectContaining({ signal: expect.any(AbortSignal) }),
		);
		expect(mockRegisterProvider).toHaveBeenCalledTimes(1);

		resolveFetch?.(
			new Response(
				JSON.stringify({
					data: [{ id: "free-model" }, { id: "new-free-model" }],
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			),
		);
		await settleDetachedCapture();

		const lastModels = mockRegisterProvider.mock.calls.at(-1)?.[1]
			.models as Array<{ id: string }>;
		expect(lastModels.map((model) => model.id)).toEqual([
			"free-model",
			"new-free-model",
		]);
	});

	it("refreshes the built-in openrouter catalog from the public endpoint", async () => {
		setupBuiltInProviderToggles(mockPi);

		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		const models = [
			{
				provider: "openrouter",
				id: "known/model",
				name: "Known Model",
				api: "openai-completions",
				reasoning: false,
				input: ["text"],
				cost: { input: 3, output: 15, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128000,
				maxTokens: 4096,
				baseUrl: "https://openrouter.ai/api/v1",
			},
		];

		fetchMock.mockImplementation((url: string) => {
			if (url === "https://openrouter.ai/api/v1/models") {
				return Promise.resolve(
					new Response(
						JSON.stringify({
							data: [
								// Known ID — must keep Pi's curated built-in metadata.
								{ id: "known/model", name: "Known Model (live)" },
								// New ID — synthesized from live endpoint metadata.
								{
									id: "vendor/new-model",
									name: "Vendor New Model",
									context_length: 200000,
									max_completion_tokens: 8192,
									pricing: { prompt: "0.000002", completion: "0.00001" },
									architecture: { input_modalities: ["text", "image"] },
									supported_parameters: ["reasoning"],
								},
							],
						}),
						{ status: 200, headers: { "content-type": "application/json" } },
					),
				);
			}
			return Promise.reject(new Error(`unexpected fetch: ${url}`));
		});

		await handlers.session_start(
			{},
			{ modelRegistry: { getAvailable: () => models } },
		);
		await settleDetachedCapture();

		expect(fetchMock).toHaveBeenCalledWith(
			"https://openrouter.ai/api/v1/models",
			expect.objectContaining({ signal: expect.any(AbortSignal) }),
		);

		const lastModels = mockRegisterProvider.mock.calls.at(-1)?.[1]
			.models as Array<{
			id: string;
			name: string;
			cost?: { input: number };
			contextWindow?: number;
		}>;
		expect(lastModels.map((model) => model.id)).toEqual([
			"known/model",
			"vendor/new-model",
		]);
		// Known ID keeps Pi's curated metadata (name + cost untouched).
		expect(lastModels[0].name).toBe("Known Model");
		expect(lastModels[0].cost?.input).toBe(3);
		// New ID is synthesized from live endpoint data.
		expect(lastModels[1].name).toBe("Vendor New Model");
		expect(lastModels[1].contextWindow).toBe(200000);
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
		expect(notify).toHaveBeenCalledWith(
			"opencode-free: showing all 2 models",
			"info",
		);
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
		mockGetOpencodeFreeShowPaid.mockReturnValue(true);
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

		expect(mockSaveConfig).toHaveBeenCalledWith({
			opencode_free_show_paid: false,
		});
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

	it("persists the opencode-go toggle under its own snake_case key", async () => {
		setupBuiltInProviderToggles(mockPi);

		const allModels = [
			{
				provider: "opencode-go",
				id: "go-model",
				name: "Go Model",
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
			{ modelRegistry: { getAvailable: () => allModels } },
		);
		await settleDetachedCapture();

		const notify = vi.fn();
		await commands["toggle-opencode-go"]({}, { ui: { notify } });

		// Pre-fix this wrote the dead dashed key `opencode-go_show_paid`,
		// which no getter ever read, so the toggle was lost on restart.
		expect(mockSaveConfig).toHaveBeenCalledWith({
			opencode_go_show_paid: true,
		});
		expect(notify).toHaveBeenCalledWith(
			"opencode-go: showing all 1 models",
			"info",
		);
	});

	it("restores the session's saved model once the late capture registers it", async () => {
		setupBuiltInProviderToggles(mockPi);

		const capturedModel = {
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
		// Post-registration the registry also serves the re-registered
		// opencode-free view; getAll reflects that.
		const restoredModel = { ...capturedModel, provider: "opencode-free" };

		await handlers.session_start(
			{},
			{
				modelRegistry: {
					getAll: () => [capturedModel, restoredModel],
					getAvailable: () => [capturedModel],
				},
				sessionManager: {
					buildSessionContext: () => ({
						model: { provider: "opencode-free", modelId: "free-model" },
					}),
				},
				// Pi fell back to another model because opencode-free was not
				// registered yet when the session was restored.
				model: { provider: "kilo", id: "fallback-model" },
			},
		);
		await settleDetachedCapture();

		expect(mockPi.setModel).toHaveBeenCalledWith(
			expect.objectContaining({ provider: "opencode-free", id: "free-model" }),
		);
	});

	it("restores the saved model even when Pi's fallback poisoned the context model", async () => {
		setupBuiltInProviderToggles(mockPi);

		const capturedModel = {
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
		// Post-registration the registry also serves the re-registered
		// opencode-free view; getAll reflects that.
		const restoredModel = { ...capturedModel, provider: "opencode-free" };
		// Pi appended a model_change for its fallback during THIS resume, so
		// buildSessionContext().model no longer reports the persisted choice.
		const now = new Date().toISOString();

		await handlers.session_start(
			{},
			{
				modelRegistry: {
					getAll: () => [capturedModel, restoredModel],
					getAvailable: () => [capturedModel],
				},
				sessionManager: {
					buildSessionContext: () => ({
						model: { provider: "openai-codex", modelId: "gpt-5.5" },
					}),
					getEntries: () => [
						{ type: "model_change", provider: "opencode-free", modelId: "free-model", timestamp: "2026-01-01T00:00:00.000Z" },
						{ type: "model_change", provider: "openai-codex", modelId: "gpt-5.5", timestamp: now },
					],
				},
				model: { provider: "openai-codex", id: "gpt-5.5" },
			},
		);
		await settleDetachedCapture();

		expect(mockPi.setModel).toHaveBeenCalledWith(
			expect.objectContaining({ provider: "opencode-free", id: "free-model" }),
		);
	});

	it("does not restore when the trailing switch predates this run (deliberate)", async () => {
		setupBuiltInProviderToggles(mockPi);

		const capturedModel = {
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
		// Both changes are from a PREVIOUS run: the user deliberately moved to
		// another provider and saved that way. No restore.

		await handlers.session_start(
			{},
			{
				modelRegistry: { getAll: () => [capturedModel], getAvailable: () => [] },
				sessionManager: {
					buildSessionContext: () => ({
						model: { provider: "kilo", modelId: "other-model" },
					}),
					getEntries: () => [
						{ type: "model_change", provider: "opencode-free", modelId: "free-model", timestamp: "2026-01-01T00:00:00.000Z" },
						{ type: "model_change", provider: "kilo", modelId: "other-model", timestamp: "2026-01-01T00:05:00.000Z" },
					],
				},
				model: { provider: "kilo", id: "other-model" },
			},
		);
		await settleDetachedCapture();

		expect(mockPi.setModel).not.toHaveBeenCalled();
	});

	it("does not restore when the saved model belongs to another provider", async () => {
		setupBuiltInProviderToggles(mockPi);

		const capturedModel = {
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

		await handlers.session_start(
			{},
			{
				modelRegistry: { getAvailable: () => [capturedModel] },
				sessionManager: {
					buildSessionContext: () => ({
						model: { provider: "kilo", modelId: "other-model" },
					}),
				},
				model: { provider: "kilo", id: "other-model" },
			},
		);
		await settleDetachedCapture();

		expect(mockPi.setModel).not.toHaveBeenCalled();
	});

	it("does not restore when the saved model is already active", async () => {
		setupBuiltInProviderToggles(mockPi);

		const capturedModel = {
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

		await handlers.session_start(
			{},
			{
				modelRegistry: { getAvailable: () => [capturedModel] },
				sessionManager: {
					buildSessionContext: () => ({
						model: { provider: "opencode-free", modelId: "free-model" },
					}),
				},
				model: { provider: "opencode-free", id: "free-model" },
			},
		);
		await settleDetachedCapture();

		expect(mockPi.setModel).not.toHaveBeenCalled();
	});
});
