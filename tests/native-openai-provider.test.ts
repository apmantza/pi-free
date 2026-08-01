import type {
	ModelsStoreEntry,
	ProviderModelsStore,
	RefreshModelsContext,
} from "@earendil-works/pi-ai/compat";
import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetGlobalFreeOnly = vi.hoisted(() => vi.fn(() => true));
const mockGetGlobalFreeOnlyForced = vi.hoisted(() => vi.fn(() => false));
const mockSaveConfig = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("../config.ts", () => ({
	saveConfig: mockSaveConfig,
	applyHidden: (models: unknown[]) => models,
}));
vi.mock("../lib/registry.ts", () => ({
	getGlobalFreeOnly: () => mockGetGlobalFreeOnly(),
	getGlobalFreeOnlyForced: () => mockGetGlobalFreeOnlyForced(),
	isFreeModel: (model: { name: string }) => /free/i.test(model.name),
	registerWithGlobalToggle: vi.fn(),
}));
vi.mock("../provider-helper.ts", () => ({
	enhanceWithCI: (models: ProviderModelConfig[]) => models,
}));
vi.mock("../lib/logger.ts", () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	}),
}));
vi.mock("../lib/session-start-metrics.ts", () => ({
	wrapSessionStartHandler: (_id: string, handler: unknown) => handler,
}));

import {
	createNativeApiKeyAuth,
	createNativeOpenAIProvider,
	registerNativeOpenAIProvider,
} from "../lib/native-provider.ts";

function model(id: string, name: string): ProviderModelConfig {
	return {
		id,
		name,
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 32_000,
		maxTokens: 4_096,
	};
}

function makeStore(seed?: ModelsStoreEntry): {
	store: ProviderModelsStore;
	written: ModelsStoreEntry[];
} {
	let entry = seed;
	const written: ModelsStoreEntry[] = [];
	return {
		store: {
			read: async () => entry,
			write: async (next: ModelsStoreEntry) => {
				entry = next;
				written.push(next);
			},
			delete: async () => {
				entry = undefined;
			},
		},
		written,
	};
}

function context(
	store: ProviderModelsStore,
	overrides: Partial<RefreshModelsContext> = {},
): RefreshModelsContext {
	return { store, allowNetwork: false, ...overrides } as RefreshModelsContext;
}

const options = {
	providerId: "test-native",
	name: "Test Native",
	baseUrl: "https://example.test/v1",
	auth: createNativeApiKeyAuth({
		name: "Test API key",
		prompt: "Test API key",
		source: "TEST_API_KEY",
		getApiKey: () => "ambient-key",
	}),
	getApiKey: () => "ambient-key",
	getShowPaid: () => false,
	initialModels: [model("free", "Free model"), model("paid", "Paid model")],
	fetchModels: async (
		_key: string,
		_signal?: AbortSignal,
	): Promise<ProviderModelConfig[]> => [],
};

beforeEach(() => {
	vi.clearAllMocks();
	mockGetGlobalFreeOnly.mockReturnValue(true);
	mockGetGlobalFreeOnlyForced.mockReturnValue(false);
});

describe("createNativeApiKeyAuth", () => {
	it("prefers stored keys and supports native login", async () => {
		const prompt = vi.fn(async () => "prompted-key");
		const auth = createNativeApiKeyAuth({
			name: "Test API key",
			prompt: "Enter test key",
			source: "TEST_API_KEY",
			getApiKey: () => "ambient-key",
		});

		expect(
			await auth.apiKey?.resolve({
				ctx: {} as never,
				credential: { type: "api_key", key: "stored-key" },
			}),
		).toMatchObject({ auth: { apiKey: "stored-key" } });
		const apiKeyAuth = auth.apiKey;
		if (!apiKeyAuth?.login) throw new Error("API-key login was not created");
		expect(await apiKeyAuth.login({ prompt } as never)).toEqual({
			type: "api_key",
			key: "prompted-key",
		});
	});
});

describe("createNativeOpenAIProvider", () => {
	it("restores offline and exposes the selected free view", async () => {
		const { store } = makeStore({
			models: [
				{
					...model("stored-free", "Stored free"),
					provider: "test-native",
					api: "openai-completions",
					baseUrl: "https://example.test/v1",
				},
			],
			checkedAt: Date.now(),
		} as unknown as ModelsStoreEntry);
		const handle = createNativeOpenAIProvider(options);

		await handle.provider.refreshModels?.(context(store));

		expect(handle.provider.getModels().map((item) => item.id)).toEqual([
			"stored-free",
		]);
		expect(handle.provider.getModels()[0].provider).toBe("test-native");
	});

	it("supports native-store-only initialization without a legacy cache", () => {
		const handle = createNativeOpenAIProvider({
			...options,
			initialModels: undefined,
		});

		expect(handle.provider.getModels()).toEqual([]);
	});

	it("keeps the complete catalog and filters it without replacing the provider", () => {
		const handle = createNativeOpenAIProvider(options);
		expect(handle.provider.getModels().map((item) => item.id)).toEqual([
			"free",
			"paid",
		]);
		expect(
			handle.provider.filterModels!(handle.provider.getModels(), undefined).map(
				(item) => item.id,
			),
		).toEqual(["free"]);

		mockGetGlobalFreeOnly.mockReturnValue(false);
		expect(
			handle.provider.filterModels!(handle.provider.getModels(), undefined).map(
				(item) => item.id,
			),
		).toEqual(["free", "paid"]);

		mockGetGlobalFreeOnly.mockReturnValue(true);
		mockGetGlobalFreeOnlyForced.mockReturnValue(true);
		expect(
			handle.provider.filterModels!(handle.provider.getModels(), undefined).map(
				(item) => item.id,
			),
		).toEqual(["free"]);
	});

	it("fetches with the effective key and persists native models", async () => {
		const controller = new AbortController();
		const fetchModels = vi.fn(async (key: string, signal?: AbortSignal) => {
			expect(key).toBe("stored-key");
			expect(signal).toBe(controller.signal);
			return [model("fresh-free", "Fresh free")];
		});
		const { store, written } = makeStore();
		const handle = createNativeOpenAIProvider({
			...options,
			fetchModels,
		});

		await handle.provider.refreshModels?.(
			context(store, {
				allowNetwork: true,
				credential: { type: "api_key", key: "stored-key" },
				signal: controller.signal,
			}),
		);

		expect(fetchModels).toHaveBeenCalledOnce();
		expect(written).toHaveLength(1);
		expect(written[0].models[0]).toMatchObject({
			id: "fresh-free",
			provider: "test-native",
			api: "openai-completions",
		});
	});

	it("fetches a public catalog without a credential when enabled", async () => {
		const fetchModels = vi.fn(async (key: string) => {
			expect(key).toBe("");
			return [model("public", "Public free")];
		});
		const { store, written } = makeStore();
		const handle = createNativeOpenAIProvider({
			...options,
			getApiKey: () => undefined,
			allowUnauthenticated: true,
			fetchModels,
		});

		await handle.provider.refreshModels?.(
			context(store, { allowNetwork: true }),
		);

		expect(fetchModels).toHaveBeenCalledOnce();
		expect(written[0].models[0]).toMatchObject({ id: "public" });
	});

	it("registers one stable provider object and shared lifecycle hooks", () => {
		const registerProvider = vi.fn();
		const registerCommand = vi.fn();
		const on = vi.fn();
		const pi = {
			registerProvider,
			registerCommand,
			on,
		} as unknown as ExtensionAPI;

		registerNativeOpenAIProvider(pi, options);

		expect(registerProvider).toHaveBeenCalledOnce();
		expect(registerProvider.mock.calls[0][0].id).toBe("test-native");
		expect(registerCommand).toHaveBeenCalledWith(
			"toggle-test-native",
			expect.any(Object),
		);
		expect(on).toHaveBeenCalledWith("session_start", expect.any(Function));
	});
});
