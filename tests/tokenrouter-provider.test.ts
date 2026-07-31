import type {
	ModelsStoreEntry,
	ProviderModelsStore,
	RefreshModelsContext,
} from "@earendil-works/pi-ai/compat";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetTokenrouterApiKey = vi.hoisted(() =>
	vi.fn((): string | undefined => undefined),
);
const mockGetTokenrouterShowPaid = vi.hoisted(() => vi.fn(() => false));
const mockGetGlobalFreeOnly = vi.hoisted(() => vi.fn(() => true));
const mockFetchWithRetry = vi.hoisted(() => vi.fn());

vi.mock("../config.ts", () => ({
	getTokenrouterApiKey: () => mockGetTokenrouterApiKey(),
	getTokenrouterShowPaid: () => mockGetTokenrouterShowPaid(),
	applyHidden: (models: unknown[]) => models,
	saveConfig: vi.fn(),
}));

vi.mock("../lib/registry.ts", () => ({
	getGlobalFreeOnly: () => mockGetGlobalFreeOnly(),
	isFreeModel: (model: { id: string }) => model.id.endsWith(":free"),
	registerWithGlobalToggle: vi.fn(),
}));

vi.mock("../lib/provider-cache.ts", () => ({
	loadProviderCache: () => undefined,
}));

vi.mock("../lib/util.ts", () => ({
	cleanModelName: (id: string) => id,
	fetchWithRetry: (...args: unknown[]) => mockFetchWithRetry(...args),
}));

vi.mock("../lib/model-metadata.ts", () => ({
	safeEnrichModelsWithModelsDev: async <T>(models: T[]) => models,
}));

vi.mock("../lib/provider-compat.ts", () => ({
	getProxyModelCompat: () => undefined,
	isLikelyReasoningModel: () => false,
	DEEPSEEK_PROXY_COMPAT: {},
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

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { tokenRouterAuth } from "../providers/tokenrouter/tokenrouter-auth.ts";
import tokenRouterEntry, {
	createTokenRouterProvider,
} from "../providers/tokenrouter/tokenrouter.ts";

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

function model(id: string, paid = false) {
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
		contextWindow: 128_000,
		maxTokens: 16_384,
		api: "tokenrouter-openai-completions",
		provider: "tokenrouter",
		baseUrl: "https://api.tokenrouter.com/v1",
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mockGetTokenrouterApiKey.mockReturnValue(undefined);
	mockGetTokenrouterShowPaid.mockReturnValue(false);
	mockGetGlobalFreeOnly.mockReturnValue(true);
});

describe("createTokenRouterProvider", () => {
	it("builds a keyed native provider and hides it without credentials", async () => {
		const { provider } = createTokenRouterProvider();
		expect(provider.id).toBe("tokenrouter");
		expect(provider.baseUrl).toBe("https://api.tokenrouter.com/v1");
		expect(provider.getModels()).toEqual([]);
		expect(
			await tokenRouterAuth.apiKey?.resolve({ ctx: {} as never }),
		).toBeUndefined();
	});

	it("prefers the stored credential over the ambient key", async () => {
		mockGetTokenrouterApiKey.mockReturnValue("sk-ambient");
		await expect(
			tokenRouterAuth.apiKey?.resolve({
				ctx: {} as never,
				credential: { type: "api_key", key: "sk-stored" },
			}),
		).resolves.toMatchObject({
			auth: { apiKey: "sk-stored" },
			source: "stored API key",
		});
	});

	it("restores the native store offline", async () => {
		const { store } = makeStore({
			models: [model("free:free"), model("paid", true)],
			checkedAt: Date.now(),
		} as unknown as ModelsStoreEntry);
		const { provider } = createTokenRouterProvider();

		await provider.refreshModels?.(context(store));

		expect(mockFetchWithRetry).not.toHaveBeenCalled();
		expect(provider.getModels().map((item) => item.id)).toEqual(["free:free"]);
	});

	it("fetches with the stored key and persists the native catalog", async () => {
		mockGetTokenrouterApiKey.mockReturnValue("sk-ambient");
		mockFetchWithRetry.mockResolvedValue(
			response([
				{
					id: "free-model:free",
					object: "model",
					created: 0,
					owned_by: "tokenrouter",
					supported_endpoint_types: ["openai"],
					tags: "text",
				},
				{
					id: "paid-model",
					object: "model",
					created: 0,
					owned_by: "tokenrouter",
					supported_endpoint_types: ["openai"],
					tags: "text",
				},
			]),
		);
		const { store, written } = makeStore();
		const { provider, stored } = createTokenRouterProvider();

		await provider.refreshModels?.(
			context(store, {
				allowNetwork: true,
				credential: { type: "api_key", key: "sk-stored" },
			}),
		);

		expect(mockFetchWithRetry).toHaveBeenCalledWith(
			"https://api.tokenrouter.com/v1/models",
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
		expect(provider.getModels().map((item) => item.id)).toEqual([
			"free-model:free",
		]);
	});

	it("honors an already-aborted refresh signal", async () => {
		mockGetTokenrouterApiKey.mockReturnValue("sk-ambient");
		const controller = new AbortController();
		controller.abort();
		const { store, written } = makeStore();
		const { provider } = createTokenRouterProvider();

		await provider.refreshModels?.(
			context(store, { allowNetwork: true, signal: controller.signal }),
		);

		expect(mockFetchWithRetry).not.toHaveBeenCalled();
		expect(written).toHaveLength(0);
	});
});

describe("TokenRouter native factory", () => {
	it("registers a native provider without doing network work", async () => {
		const registerProvider = vi.fn();
		const registerCommand = vi.fn();
		const on = vi.fn();
		const pi = {
			registerProvider,
			registerCommand,
			on,
		} as unknown as ExtensionAPI;

		await tokenRouterEntry(pi);

		expect(registerProvider).toHaveBeenCalledTimes(1);
		expect(registerProvider.mock.calls[0][0].id).toBe("tokenrouter");
		expect(registerCommand).toHaveBeenCalledWith(
			"toggle-tokenrouter",
			expect.any(Object),
		);
		expect(mockFetchWithRetry).not.toHaveBeenCalled();
	});
});
