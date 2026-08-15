import type {
	Api,
	Model,
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
const mockLoggerWarn = vi.hoisted(() => vi.fn());
const mockLoggerError = vi.hoisted(() => vi.fn());
vi.mock("../lib/logger.ts", () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: mockLoggerWarn,
		error: mockLoggerError,
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
	refreshNativeProviderModels,
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
				signal: new AbortController().signal,
			} as never),
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

	it("supports Pi 0.84 stored/publish model lifecycle", async () => {
		const controller = new AbortController();
		const publish = vi.fn(
			async (publication: {
				persist?: { models: readonly unknown[]; checkedAt: number };
				update?: () => void;
			}) => {
				publication.update?.();
				return true;
			},
		);
		const handle = createNativeOpenAIProvider({
			...options,
			fetchModels: async () => [model("modern", "Modern model")],
		});

		await handle.provider.refreshModels?.({
			allowNetwork: true,
			credential: { type: "api_key", key: "stored-key" },
			stored: undefined,
			publish,
			signal: controller.signal,
		} as unknown as RefreshModelsContext);

		expect(publish).toHaveBeenCalledOnce();
		expect(publish.mock.calls[0][0].persist?.models[0]).toMatchObject({
			id: "modern",
		});
		expect(handle.provider.getModels()[0].id).toBe("modern");
	});

	it("does not apply a stale Pi 0.84 publication", async () => {
		const publish = vi.fn(async () => false);
		const handle = createNativeOpenAIProvider({
			...options,
			fetchModels: async () => [model("stale", "Stale model")],
		});

		await handle.provider.refreshModels?.({
			allowNetwork: true,
			credential: { type: "api_key", key: "stored-key" },
			stored: undefined,
			publish,
			signal: new AbortController().signal,
		} as unknown as RefreshModelsContext);

		expect(publish).toHaveBeenCalledOnce();
		expect(handle.provider.getModels().map((item) => item.id)).toEqual([
			"free",
			"paid",
		]);
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

	it("registers one stable provider object and shared lifecycle hooks", async () => {
		const registerProvider = vi.fn();
		const registerCommand = vi.fn();
		const on = vi.fn();
		const pi = {
			registerProvider,
			registerCommand,
			on,
		} as unknown as ExtensionAPI;

		registerNativeOpenAIProvider(pi, options);
		registerNativeOpenAIProvider(pi, options);

		expect(registerProvider).toHaveBeenCalledTimes(2);
		expect(registerProvider.mock.calls[0][0].id).toBe("test-native");
		expect(registerCommand).toHaveBeenCalledWith(
			"toggle-test-native",
			expect.any(Object),
		);
		expect(on).toHaveBeenCalledOnce();
		expect(on).toHaveBeenCalledWith("session_start", expect.any(Function));

		const refresh = vi.fn(async () => ({ errors: new Map() }));
		const sessionHandler = on.mock.calls[0][1] as (
			event: unknown,
			context: { modelRegistry: { refresh: typeof refresh } },
		) => Promise<void>;
		await sessionHandler({}, { modelRegistry: { refresh } });
		expect(refresh).toHaveBeenCalledOnce();
	});

	it("suppresses expected abort errors without logging a failure (#419)", async () => {
		// Pi 0.84 aborts a superseded refresh; cancellation must not surface as
		// a visible provider failure. fetchModels rejects mid-flight while the
		// signal is already aborted.
		const controller = new AbortController();
		const { store, written } = makeStore({
			models: [
				{
					...model("stored", "Stored"),
					provider: "test-native",
					api: "openai-completions",
					baseUrl: "https://example.test/v1",
				},
			],
			checkedAt: 123,
		} as unknown as ModelsStoreEntry);
		const onRestore = vi.fn();
		const onFetched = vi.fn();
		const fetchModels = vi.fn(async () => {
			controller.abort();
			throw new Error("This operation was aborted");
		});

		await refreshNativeProviderModels(
			"test-native",
			context(store, {
				allowNetwork: true,
			signal: controller.signal,
			}),
			onRestore,
			fetchModels,
			onFetched,
		);

		expect(fetchModels).toHaveBeenCalledOnce();
		// No failure was logged at warn or error level.
		expect(mockLoggerWarn).not.toHaveBeenCalledWith(
			expect.stringContaining("Failed to refresh"),
			expect.anything(),
		);
		// The previous catalog is retained: nothing was persisted over it.
		expect(onFetched).not.toHaveBeenCalled();
		expect(written).toHaveLength(0);
		// Offline restore still served the stored snapshot.
		expect(onRestore).toHaveBeenCalledWith(
			expect.arrayContaining([expect.objectContaining({ id: "stored" })]),
		);
	});

	it("still logs a real fetch failure when the signal is not aborted", async () => {
		// The guard must be narrow: a genuine provider/network failure (signal
		// live) IS logged so it isn't hidden behind a cancelled-signal heuristic.
		const { store } = makeStore();
		const fetchModels = vi.fn(async () => {
			throw new Error("boom: network unreachable");
		});

		await refreshNativeProviderModels(
			"test-native",
			context(store, {
				allowNetwork: true,
				signal: new AbortController().signal,
			}),
			vi.fn(),
			fetchModels,
			vi.fn(),
		);

		expect(mockLoggerWarn).toHaveBeenCalledWith(
			expect.stringContaining("Failed to refresh"),
			expect.objectContaining({ error: expect.stringContaining("boom") }),
		);
	});

	it("records abort/empty-retain/ok refresh outcomes in startup timing (M1)", async () => {
		const startup = await import("../lib/startup-timing.ts");
		startup.beginStartup();

		// Abort: signal aborted before the fetch — counted, never logged.
		const controller = new AbortController();
		controller.abort();
		await refreshNativeProviderModels(
			"test-native",
			context(makeStore().store, {
				allowNetwork: true,
				signal: controller.signal,
			}),
			vi.fn(),
			vi.fn(
				async () =>
					[
						{
							...model("m", "M"),
							provider: "test-native",
							api: "openai-completions",
							baseUrl: "https://example.test/v1",
						},
					] as Model<Api>[],
			),
			vi.fn(),
		);

		// Empty retain: fetch returns 0 models — previous list retained.
		await refreshNativeProviderModels(
			"test-native",
			context(makeStore().store, { allowNetwork: true }),
			vi.fn(),
			vi.fn(async () => []),
			vi.fn(),
		);

		// Ok: fetch publishes 2 models.
		await refreshNativeProviderModels(
			"test-native",
			context(makeStore().store, { allowNetwork: true }),
			vi.fn(),
			vi.fn(
				async () =>
					[
						{
							...model("m1", "M1"),
							provider: "test-native",
							api: "openai-completions",
							baseUrl: "https://example.test/v1",
						},
						{
							...model("m2", "M2"),
							provider: "test-native",
							api: "openai-completions",
							baseUrl: "https://example.test/v1",
						},
					] as Model<Api>[],
			),
			vi.fn(),
		);

		const summary = startup.getStartupSummary();
		const entry = summary.cacheNetwork.find(
			(entry) => entry.provider === "test-native",
		);
		expect(entry).toMatchObject({
			aborts: 1,
			emptyRetains: 1,
			refreshOks: 1,
			lastRefreshModelCount: 2,
		});
		// Aborts are expected — the abort path must not log as a failure.
		expect(mockLoggerWarn).not.toHaveBeenCalledWith(
			expect.stringContaining("Failed to refresh"),
			expect.anything(),
		);
	});

	it("records a store restore with checkedAt age (M1) and flags stale stores (Mn2)", async () => {
		const startup = await import("../lib/startup-timing.ts");
		startup.beginStartup();

		const { store } = makeStore({
			models: [
				{
					...model("stored", "Stored"),
					provider: "test-native",
					api: "openai-completions",
					baseUrl: "https://example.test/v1",
				},
			],
			checkedAt: Date.now() - 2 * 60 * 60 * 1000, // 2h old
		} as unknown as ModelsStoreEntry);

		await refreshNativeProviderModels(
			"test-native",
			context(store, { allowNetwork: false }),
			vi.fn(),
			vi.fn(async () => []),
			vi.fn(),
		);

		const entry = startup
			.getStartupSummary()
			.cacheNetwork.find((entry) => entry.provider === "test-native");
		expect(entry?.restoredCount).toBe(1);
		expect(entry?.storeAgeMs).toBeLessThan(3 * 60 * 60 * 1000);
		expect(entry?.storeAgeMs).toBeGreaterThan(60 * 60 * 1000);
	});
});
