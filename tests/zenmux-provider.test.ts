import { createModels } from "@earendil-works/pi-ai";
import type {
	ModelsStoreEntry,
	ProviderModelsStore,
	RefreshModelsContext,
} from "@earendil-works/pi-ai/compat";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetZenmuxApiKey = vi.hoisted(() =>
	vi.fn((): string | undefined => undefined),
);
const mockGetZenmuxShowPaid = vi.hoisted(() => vi.fn(() => false));
const mockGetGlobalFreeOnly = vi.hoisted(() => vi.fn(() => true));
const mockApplyHidden = vi.hoisted(() =>
	vi.fn((models: { id: string }[], _providerId?: string) => models),
);
const mockFetchWithRetry = vi.hoisted(() => vi.fn());

vi.mock("../config.ts", () => ({
	getZenmuxApiKey: () => mockGetZenmuxApiKey(),
	getZenmuxShowPaid: () => mockGetZenmuxShowPaid(),
	applyHidden: (models: { id: string }[], providerId?: string) =>
		mockApplyHidden(models, providerId),
	saveConfig: vi.fn(),
}));

vi.mock("../lib/registry.ts", () => ({
	getGlobalFreeOnly: () => mockGetGlobalFreeOnly(),
	getGlobalFreeOnlyForced: () => false,
	isFreeModel: (model: { cost?: { input?: number; output?: number } }) =>
		(model.cost?.input ?? 0) === 0 && (model.cost?.output ?? 0) === 0,
}));

vi.mock("../lib/util.ts", () => ({
	fetchWithRetry: (...args: unknown[]) => mockFetchWithRetry(...args),
}));

vi.mock("../lib/model-metadata.ts", () => ({
	safeEnrichModelsWithModelsDev: async <T>(models: T[]) => models,
}));

vi.mock("../lib/provider-compat.ts", () => ({
	getProxyModelCompat: () => undefined,
}));

vi.mock("../provider-helper.ts", async () => {
	const actual = await vi.importActual<Record<string, unknown>>(
		"../provider-helper.ts",
	);
	return {
		...actual,
		enhanceWithCI: (models: unknown[]) => models,
	};
});

vi.mock("../lib/logger.ts", () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	}),
}));

import { zenmuxAuth } from "../providers/zenmux/zenmux-auth.ts";
import { fetchZenmuxCatalog } from "../providers/zenmux/zenmux-models.ts";
import { createZenmuxProvider } from "../providers/zenmux/zenmux-provider.ts";

function nativeModel(id: string, paid = false) {
	return {
		id,
		name: id,
		reasoning: false,
		input: ["text"] as ("text" | "image")[],
		cost: {
			input: paid ? 0.000001 : 0,
			output: paid ? 0.000002 : 0,
			cacheRead: 0,
			cacheWrite: 0,
		},
		contextWindow: 32_000,
		maxTokens: 16_000,
		api: "openai-completions",
		provider: "zenmux",
		baseUrl: "https://zenmux.ai/api/v1",
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

function response(data: unknown) {
	return {
		ok: true,
		status: 200,
		json: async () => ({ data }),
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mockGetZenmuxApiKey.mockReturnValue(undefined);
	mockGetZenmuxShowPaid.mockReturnValue(false);
	mockGetGlobalFreeOnly.mockReturnValue(true);
	mockApplyHidden.mockImplementation((models) => models);
});

describe("createZenmuxProvider", () => {
	it("builds a keyed native provider", async () => {
		const { provider } = createZenmuxProvider();
		expect(provider.id).toBe("zenmux");
		expect(provider.name).toBe("ZenMux");
		expect(provider.baseUrl).toBe("https://zenmux.ai/api/v1");
		expect(provider.auth.apiKey).toBeDefined();
		expect(provider.auth.oauth).toBeUndefined();
		expect(provider.getModels()).toEqual([]);

		const models = createModels();
		models.setProvider(provider);
		expect(await models.getAvailable()).toEqual([]);
		// Keyed providers must not appear authenticated without a credential.
		expect(
			await zenmuxAuth.apiKey?.resolve({
			ctx: {} as never,
			signal: new AbortController().signal,
		} as never),
		).toBeUndefined();
	});

	it("restores the native store offline without network", async () => {
		const { store } = makeStore({
			models: [nativeModel("free"), nativeModel("paid", true)],
			checkedAt: Date.now(),
		} as unknown as ModelsStoreEntry);
		const { provider } = createZenmuxProvider();

		await provider.refreshModels?.(context(store));

		expect(mockFetchWithRetry).not.toHaveBeenCalled();
		expect(provider.getModels().map((model) => model.id)).toEqual([
			"free",
			"paid",
		]);
		expect(
			provider.filterModels!(provider.getModels(), undefined).map(
				(model) => model.id,
			),
		).toEqual(["free"]);
	});

	it("fetches with the effective stored key and persists the catalog", async () => {
		mockGetZenmuxApiKey.mockReturnValue("sk-ambient");
		mockFetchWithRetry.mockResolvedValue(
			response([
				{
					id: "free-model",
					display_name: "Free Model",
					context_length: 64_000,
					input_modalities: ["text"],
					pricings: {
						prompt: [{ value: 0 }],
						completion: [{ value: 0 }],
					},
				},
				{
					id: "paid-model",
					context_length: 128_000,
					input_modalities: ["text", "image"],
					pricings: {
						prompt: [{ value: 1 }],
						completion: [{ value: 2 }],
					},
				},
			]),
		);
		const { store, written } = makeStore();
		const { provider, stored } = createZenmuxProvider();

		await provider.refreshModels?.(
			context(store, {
				allowNetwork: true,
				credential: { type: "api_key", key: "sk-stored" },
			}),
		);

		expect(mockFetchWithRetry).toHaveBeenCalledWith(
			"https://zenmux.ai/api/v1/models",
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: "Bearer sk-stored",
				}),
			}),
			3,
			1000,
			10_000,
		);
		expect(stored.all).toHaveLength(2);
		expect(stored.free).toHaveLength(1);
		expect(written).toHaveLength(1);
		expect(written[0].models.map((model) => model.id)).toEqual([
			"free-model",
			"paid-model",
		]);
		expect(provider.getModels().map((model) => model.id)).toEqual([
			"free-model",
			"paid-model",
		]);
		expect(
			provider.filterModels!(provider.getModels(), undefined).map(
				(model) => model.id,
			),
		).toEqual(["free-model"]);
	});

	it("applies hidden models before publishing", async () => {
		mockGetZenmuxApiKey.mockReturnValue("sk-ambient");
		mockApplyHidden.mockImplementation((models: { id: string }[]) =>
			models.filter((model) => model.id !== "hidden"),
		);
		mockFetchWithRetry.mockResolvedValue(
			response([
				{ id: "visible", pricings: { prompt: [{ value: 0 }] } },
				{ id: "hidden", pricings: { prompt: [{ value: 0 }] } },
			]),
		);
		const { store } = makeStore();
		const handle = createZenmuxProvider();

		await handle.provider.refreshModels?.(
			context(store, { allowNetwork: true }),
		);
		expect(mockApplyHidden).toHaveBeenCalledWith(expect.any(Array), "zenmux");
		expect(handle.stored.all.map((model) => model.id)).toEqual(["visible"]);
	});

	it("retains the previous catalog when the fetch is empty", async () => {
		mockGetZenmuxApiKey.mockReturnValue("sk-ambient");
		mockFetchWithRetry.mockResolvedValue(response([]));
		const { store, written } = makeStore({
			models: [nativeModel("existing")],
			checkedAt: Date.now(),
		} as unknown as ModelsStoreEntry);
		const { provider } = createZenmuxProvider();

		await provider.refreshModels?.(context(store, { allowNetwork: true }));

		expect(provider.getModels().map((model) => model.id)).toEqual(["existing"]);
		expect(written).toHaveLength(0);
	});

	it("honors an already-aborted refresh signal", async () => {
		mockGetZenmuxApiKey.mockReturnValue("sk-ambient");
		const controller = new AbortController();
		controller.abort();
		const { store, written } = makeStore();
		const { provider } = createZenmuxProvider();

		await provider.refreshModels?.(
			context(store, { allowNetwork: true, signal: controller.signal }),
		);

		expect(mockFetchWithRetry).not.toHaveBeenCalled();
		expect(written).toHaveLength(0);
	});

	it("keeps the full catalog while filterModels selects the free view", async () => {
		const { provider, stored } = createZenmuxProvider();
		const free = nativeModel("free");
		const paid = nativeModel("paid", true);
		stored.free = [free];
		stored.all = [free, paid];
		expect(provider.getModels().map((model) => model.id)).toEqual([
			"free",
			"paid",
		]);
		expect(
			provider.filterModels!(provider.getModels(), undefined).map(
				(model) => model.id,
			),
		).toEqual(["free"]);
	});
});

describe("fetchZenmuxCatalog", () => {
	it("returns an empty catalog without a token", async () => {
		expect(await fetchZenmuxCatalog({})).toEqual({ all: [], free: [] });
		expect(mockFetchWithRetry).not.toHaveBeenCalled();
	});
});
