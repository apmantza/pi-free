import type {
	ModelsStoreEntry,
	ProviderModelsStore,
	RefreshModelsContext,
} from "@earendil-works/pi-ai/compat";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetOllamaApiKey = vi.hoisted(() =>
	vi.fn((): string | undefined => undefined),
);
const mockGetOllamaShowPaid = vi.hoisted(() => vi.fn(() => false));
const mockGetGlobalFreeOnly = vi.hoisted(() => vi.fn(() => true));
const mockFetchWithRetry = vi.hoisted(() => vi.fn());
const mockFetchWithTimeout = vi.hoisted(() => vi.fn());
const mockSaveProviderCache = vi.hoisted(() =>
	vi.fn(async (..._args: unknown[]) => undefined),
);

vi.mock("../config.ts", () => ({
	getOllamaApiKey: () => mockGetOllamaApiKey(),
	getOllamaShowPaid: () => mockGetOllamaShowPaid(),
	applyHidden: (models: unknown[]) => models,
	updateConfig: vi.fn(),
	saveConfig: vi.fn(),
}));

vi.mock("../lib/registry.ts", () => ({
	getGlobalFreeOnly: () => mockGetGlobalFreeOnly(),
	registerWithGlobalToggle: vi.fn(),
}));

vi.mock("../lib/provider-cache.ts", () => ({
	loadProviderCache: () => undefined,
	saveProviderCache: (providerId: string, models: unknown[]) =>
		mockSaveProviderCache(providerId, models),
}));

vi.mock("../lib/probe-cache.ts", () => ({
	getModelsDueForProbe: () => [],
	recordModelProbeResults: vi.fn(async () => undefined),
	areAllModelsFresh: () => true,
}));

vi.mock("../lib/session-start-metrics.ts", () => ({
	wrapSessionStartHandler: (_providerId: string, handler: unknown) => handler,
}));

vi.mock("../lib/util.ts", () => ({
	fetchWithRetry: (...args: unknown[]) => mockFetchWithRetry(...args),
	fetchWithTimeout: (...args: unknown[]) => mockFetchWithTimeout(...args),
}));

vi.mock("../provider-helper.ts", () => ({
	enhanceWithCI: (models: unknown[]) => models,
}));

vi.mock("../lib/logger.ts", () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	}),
}));

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import ollamaEntry, {
	createOllamaProvider,
} from "../providers/ollama/ollama.ts";
import { ollamaAuth } from "../providers/ollama/ollama-auth.ts";

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

function model(id: string) {
	return {
		id,
		name: id,
		reasoning: false,
		input: ["text"] as ("text" | "image")[],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 32_000,
		maxTokens: 16_384,
		api: "openai-completions",
		provider: "ollama-cloud",
		baseUrl: "https://ollama.com/v1",
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mockGetOllamaApiKey.mockReturnValue(undefined);
	mockGetOllamaShowPaid.mockReturnValue(false);
	mockGetGlobalFreeOnly.mockReturnValue(true);
});

describe("createOllamaProvider", () => {
	it("builds an OpenAI-compatible native provider", async () => {
		const { provider } = createOllamaProvider([model("initial")]);
		expect(provider.id).toBe("ollama-cloud");
		expect(provider.baseUrl).toBe("https://ollama.com/v1");
		expect(provider.getModels().map((item) => item.id)).toEqual(["initial"]);
		expect(
			await ollamaAuth.apiKey?.resolve({ ctx: {} as never }),
		).toBeUndefined();
	});

	it("restores the native store offline without network access", async () => {
		const { store } = makeStore({
			models: [model("stored")],
			checkedAt: Date.now(),
		} as unknown as ModelsStoreEntry);
		const { provider } = createOllamaProvider([model("initial")]);

		await provider.refreshModels?.(context(store));

		expect(mockFetchWithRetry).not.toHaveBeenCalled();
		expect(provider.getModels().map((item) => item.id)).toEqual(["stored"]);
	});

	it("fetches model details with the effective key and persists the catalog", async () => {
		mockGetOllamaApiKey.mockReturnValue("ollama-ambient");
		const controller = new AbortController();
		mockFetchWithRetry.mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ data: [{ id: "cloud-model" }] }),
		});
		mockFetchWithTimeout.mockResolvedValue({
			ok: true,
			status: 200,
			statusText: "OK",
			json: async () => ({
				details: {
					parameter_size: "7B",
					quantization_level: "Q4_K_M",
				},
				model_info: { "x.context_length": 64_000 },
				capabilities: ["tools", "thinking"],
			}),
		});
		const { store, written } = makeStore();
		const { provider } = createOllamaProvider([]);

		await provider.refreshModels?.(
			context(store, {
				allowNetwork: true,
				credential: { type: "api_key", key: "ollama-stored" },
				signal: controller.signal,
			}),
		);

		expect(mockFetchWithRetry).toHaveBeenCalledWith(
			"https://ollama.com/v1/models",
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: "Bearer ollama-stored",
				}),
				signal: controller.signal,
			}),
			3,
			1000,
			10_000,
		);
		expect(mockFetchWithTimeout).toHaveBeenCalledWith(
			"https://ollama.com/api/show",
			expect.objectContaining({ signal: controller.signal }),
			10_000,
		);
		expect(mockSaveProviderCache).toHaveBeenCalled();
		expect(written).toHaveLength(1);
		expect(provider.getModels().map((item) => item.id)).toEqual([
			"cloud-model",
		]);
	});

	it("honors an already-aborted refresh signal", async () => {
		mockGetOllamaApiKey.mockReturnValue("ollama-ambient");
		const controller = new AbortController();
		controller.abort();
		const { store, written } = makeStore();
		const { provider } = createOllamaProvider([model("initial")]);

		await provider.refreshModels?.(
			context(store, { allowNetwork: true, signal: controller.signal }),
		);

		expect(mockFetchWithRetry).not.toHaveBeenCalled();
		expect(written).toHaveLength(0);
	});
});

describe("Ollama native factory", () => {
	it("registers a native provider with fallback models without network work", async () => {
		const registerProvider = vi.fn();
		const registerCommand = vi.fn();
		const on = vi.fn();
		const pi = {
			registerProvider,
			registerCommand,
			on,
		} as unknown as ExtensionAPI;

		await ollamaEntry(pi);

		expect(registerProvider).toHaveBeenCalledTimes(1);
		expect(registerProvider.mock.calls[0][0].id).toBe("ollama-cloud");
		expect(registerCommand).toHaveBeenCalledWith(
			"toggle-ollama-cloud",
			expect.any(Object),
		);
		expect(mockFetchWithRetry).not.toHaveBeenCalled();
	});
});
