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
	getGlobalFreeOnlyForced: () => false,
	isFreeModel: (model: { id: string }) => model.id.endsWith(":free"),
	registerWithGlobalToggle: vi.fn(),
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
import { createAssistantMessageEventStream } from "../lib/assistant-message-event-stream.ts";
import { __setCompatLoaderForTests } from "../lib/lazy-compat.ts";
import { tokenRouterAuth } from "../providers/tokenrouter/tokenrouter-auth.ts";
import tokenRouterEntry, {
	createTokenRouterProvider,
	isTokenRouterHighLoadError,
	streamWithTokenRouterHighLoadRetry,
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
		api: "openai-completions",
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
			await tokenRouterAuth.apiKey?.resolve({
				ctx: {} as never,
				signal: new AbortController().signal,
			} as never),
		).toBeUndefined();
	});

	it("prefers the stored credential over the ambient key", async () => {
		mockGetTokenrouterApiKey.mockReturnValue("sk-ambient");
		await expect(
			tokenRouterAuth.apiKey?.resolve({
				ctx: {} as never,
				credential: { type: "api_key", key: "sk-stored" },
				signal: new AbortController().signal,
			} as never),
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
		expect(provider.getModels().map((item) => item.id)).toEqual([
			"free:free",
			"paid",
		]);
		expect(
			provider.filterModels!(provider.getModels(), undefined).map(
				(item) => item.id,
			),
		).toEqual(["free:free"]);
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
			"paid-model",
		]);
		expect(
			provider.filterModels!(provider.getModels(), undefined).map(
				(item) => item.id,
			),
		).toEqual(["free-model:free"]);
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

	it("before_provider_request returns the adaptive-patched MiniMax payload", async () => {
		const registerProvider = vi.fn();
		const registerCommand = vi.fn();
		const on = vi.fn();
		const pi = {
			registerProvider,
			registerCommand,
			on,
		} as unknown as ExtensionAPI;

		await tokenRouterEntry(pi);

		// The runner replaces the request payload with the handler's return
		// value, so a hook that only calls the patch (discarding the result)
		// is a silent no-op. Assert the registered handler returns the patch.
		const requestHandlers = on.mock.calls
			.map(([event, handler]) => [event, handler] as const)
			.filter(([event]) => event === "before_provider_request");
		expect(requestHandlers).toHaveLength(1);
		const [, handler] = requestHandlers[0];

		const patched = await handler(
			{ payload: { model: "MiniMax-M3", thinking: { type: "enabled" } } },
			{ model: { provider: "tokenrouter", id: "MiniMax-M3" } },
		);
		expect(patched).toEqual({
			model: "MiniMax-M3",
			thinking: { type: "adaptive" },
		});

		const untouched = await handler(
			{ payload: { model: "claude-3-5-sonnet", thinking: { type: "enabled" } } },
			{ model: { provider: "anthropic", id: "claude-3-5-sonnet" } },
		);
		expect(untouched).toBeUndefined();
	});
});

describe("TokenRouter high-load retry and streaming", () => {
	it("detects upstream 2064 high-load errors", () => {
		expect(isTokenRouterHighLoadError("Error: (2064) upstream error")).toBe(true);
		expect(
			isTokenRouterHighLoadError("Server cluster is currently under high load"),
		).toBe(true);
		expect(isTokenRouterHighLoadError("401 unauthorized")).toBe(false);
		expect(isTokenRouterHighLoadError(undefined)).toBe(false);
	});

	it("retries once after a pre-output 2064 error", async () => {
		let attempts = 0;
		const createAttempt = () => {
			attempts += 1;
			const inner = createAssistantMessageEventStream();
			if (attempts === 1) {
				queueMicrotask(() => {
					inner.push({
						type: "error",
						reason: "error",
						error: {
							errorMessage: "Server cluster is currently under high load (2064)",
						},
					} as never);
				});
			} else {
				queueMicrotask(() => {
					inner.push({ type: "text_start", text: "ok" } as never);
					inner.push({ type: "done", message: {} as never } as never);
				});
			}
			return inner;
		};

		const out = streamWithTokenRouterHighLoadRetry(
			{
				id: "deepseek-r1",
				api: "openai-completions",
				provider: "tokenrouter",
			} as never,
			createAttempt,
			undefined,
			1, // test-only retry delay
		);
		const events: Array<{ type?: string }> = [];
		for await (const event of out) events.push(event as { type?: string });

		expect(attempts).toBe(2);
		expect(events.filter((event) => event.type === "error")).toHaveLength(0);
		expect(events.some((event) => event.type === "text_start")).toBe(true);
	});

	it("does not retry on ordinary errors", async () => {
		let attempts = 0;
		const createAttempt = () => {
			attempts += 1;
			const inner = createAssistantMessageEventStream();
			queueMicrotask(() => {
				inner.push({
					type: "error",
					reason: "error",
					error: { errorMessage: "401 unauthorized" },
				} as never);
			});
			return inner;
		};

		const out = streamWithTokenRouterHighLoadRetry(
			{
				id: "deepseek-r1",
				api: "openai-completions",
				provider: "tokenrouter",
			} as never,
			createAttempt,
			undefined,
			1,
		);
		const events: Array<{ type?: string }> = [];
		for await (const event of out) events.push(event as { type?: string });

		expect(attempts).toBe(1);
		expect(events.filter((event) => event.type === "error")).toHaveLength(1);
	});

	it("does not retry once output has started", async () => {
		let attempts = 0;
		const createAttempt = () => {
			attempts += 1;
			const inner = createAssistantMessageEventStream();
			queueMicrotask(() => {
				inner.push({ type: "text_start", text: "partial" } as never);
				inner.push({
					type: "error",
					reason: "error",
					error: { errorMessage: "(2064) high load" },
				} as never);
			});
			return inner;
		};

		const out = streamWithTokenRouterHighLoadRetry(
			{
				id: "deepseek-r1",
				api: "openai-completions",
				provider: "tokenrouter",
			} as never,
			createAttempt,
			undefined,
			1,
		);
		const events: Array<{ type?: string }> = [];
		for await (const event of out) events.push(event as { type?: string });

		expect(attempts).toBe(1);
		expect(events.some((event) => event.type === "text_start")).toBe(true);
	});

	it("streams through the standard lazy OpenAI-completions bridge", async () => {
		const stream = vi.fn(() => {
			const inner = createAssistantMessageEventStream();
			queueMicrotask(() => {
				inner.push({ type: "text_start", text: "" } as never);
				inner.push({ type: "done", message: {} as never } as never);
			});
			return inner;
		});
		const streamSimple = vi.fn(() => {
			const inner = createAssistantMessageEventStream();
			queueMicrotask(() => {
				inner.push({ type: "text_delta", text: "standard" } as never);
				inner.push({ type: "done", message: {} as never } as never);
			});
			return inner;
		});
		__setCompatLoaderForTests(async () =>
			Promise.resolve({
				openAICompletionsApi: () => ({ stream, streamSimple }),
				anthropicMessagesApi: vi.fn(),
			} as never),
		);
		try {
			const { provider } = createTokenRouterProvider();
			const model = {
				id: "deepseek-r1",
				api: "openai-completions",
				provider: "tokenrouter",
				baseUrl: "https://api.tokenrouter.com/v1",
			} as never;

			const simpleEvents: Array<{ type?: string }> = [];
			for await (const event of provider.streamSimple(model, {} as never)) {
				simpleEvents.push(event as { type?: string });
			}
			const streamEvents: Array<{ type?: string }> = [];
			for await (const event of provider.stream(model, {} as never)) {
				streamEvents.push(event as { type?: string });
			}

			// Both provider stream entries delegate to pi-ai's openAICompletionsApi
			// through the lazy bridge — no custom wire implementation.
			expect(streamSimple).toHaveBeenCalledTimes(1);
			expect(stream).toHaveBeenCalledTimes(1);
			expect(simpleEvents.some((event) => event.type === "text_delta")).toBe(true);
			expect(streamEvents.some((event) => event.type === "text_start")).toBe(true);
		} finally {
			__setCompatLoaderForTests(undefined);
		}
	});
});
