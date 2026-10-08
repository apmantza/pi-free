/**
 * Pi 1.x capture must not register non-chat entries as chat models (#604).
 *
 * Pi's built-in `opencode` provider mixes classifier entries into its
 * catalog (pi-ai registers [...OPENCODE_MODELS, ...OPENCODE_CLASSIFIER_MODELS]
 * under one id). tryCaptureProvider filters by provider id only, so without
 * a type filter those entries land in `opencode-free`'s chat catalog with
 * undefined reasoning/maxTokens/compat. tsc is blind (declared Model<Api>).
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetGlobalFreeOnly = vi.fn(() => false);
const mockSetModelViewOverride = vi.fn();
const mockRegisterWithGlobalToggle = vi.fn();
const mockRegisterProvider = vi.fn();
const mockProviderRegistry = new Map<string, unknown>();

async function settleDetachedCapture(): Promise<void> {
	for (let i = 0; i < 10; i += 1) {
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
}

vi.mock("../config.ts", () => ({
	getOpencodeApiKey: () => undefined,
	getOpencodeShowPaid: () => false,
	getOpencodeFreeShowPaid: () => false,
	getOpencodeGoShowPaid: () => false,
	getOpenrouterApiKey: () => undefined,
	getOpenrouterShowPaid: () => false,
	setModelViewOverride: (...args: unknown[]) =>
		mockSetModelViewOverride(...args),
	saveConfig: () => {},
}));

vi.mock("../lib/registry.ts", () => ({
	getGlobalFreeOnly: () => mockGetGlobalFreeOnly(),
	resolveModelView: () => "all",
	getProviderRegistry: () => mockProviderRegistry,
	isFreeModel: () => false,
	registerWithGlobalToggle: (...args: unknown[]) =>
		mockRegisterWithGlobalToggle(...args),
}));

vi.mock("../lib/model-metadata.ts", () => ({
	safeEnrichModelsWithModelsDev: async (models: unknown[]) => models,
}));

// Force a cache miss: never register from a real ~/.pi cache on dev machines.
vi.mock("../lib/opencode-catalog-cache.ts", () => ({
	loadSyncCacheEntry: () => undefined,
	persistSyncCacheEntry: () => {},
}));

const chatModel = {
	provider: "opencode",
	id: "chat-model",
	name: "Chat Model",
	api: "openai-completions",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 128000,
	maxTokens: 4096,
	baseUrl: "https://example.com",
};

// Pi 1.1 classifier shape: no reasoning/maxTokens/compat (the fields
// modelToProviderConfig reads unconditionally).
const classifierModel = {
	provider: "opencode",
	id: "typesafe-cls",
	name: "Typesafe Classifier",
	type: "classifier",
	api: "openai-completions",
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 128000,
	baseUrl: "https://example.com",
};

describe("built-in capture chat filter (#604)", () => {
	let mockPi: ExtensionAPI;
	let handlers: Record<string, Function>;
	let commands: Record<string, Function>;
	let setupBuiltInProviderToggles: (pi: ExtensionAPI) => void;

	beforeEach(async () => {
		vi.resetModules();
		vi.unstubAllGlobals();
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error("no network in tests");
			}),
		);
		mockRegisterWithGlobalToggle.mockClear();
		mockRegisterProvider.mockClear();
		mockProviderRegistry.clear();
		commands = {};
		handlers = {};
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

		({ setupBuiltInProviderToggles } =
			await import("../lib/built-in-toggle.ts"));
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("excludes non-chat entries when capturing Pi's built-in catalog", async () => {
		setupBuiltInProviderToggles(mockPi);
		const mixed = [chatModel, classifierModel];
		await handlers.session_start!(
			{},
			{
				modelRegistry: {
					getAll: () => mixed,
					getAvailable: () => mixed,
				},
			},
		);
		await settleDetachedCapture();

		const freeCall = mockRegisterWithGlobalToggle.mock.calls.find(
			([id]) => id === "opencode-free",
		) as unknown as
			| [string, { free: Array<{ id: string }>; all: Array<{ id: string }> }]
			| undefined;
		expect(freeCall).toBeDefined();
		expect(freeCall?.[1].all.map((m) => m.id)).toEqual(["chat-model"]);
	});
});
