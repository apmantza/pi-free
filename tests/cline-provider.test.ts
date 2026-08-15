/**
 * Unit tests for the Cline native provider (createProvider object form).
 *
 * Mirrors tests/kilo-provider.test.ts, plus the Cline-specific pieces:
 *   - the standard "openai-completions" wire api: stream AND streamSimple
 *     delegate to the lazy OpenAI compat bridge (#433)
 *   - public catalog: refreshModels fetches without any credential
 *   - stored-store migration: restored models with the retired legacy XML
 *     wire api are normalized to "openai-completions"
 *   - the shared mutable headers record (task-id rotation without re-register)
 */

import { createModels } from "@earendil-works/pi-ai";
import type {
	AssistantMessageEventStream,
	ModelsStoreEntry,
	ProviderModelsStore,
	RefreshModelsContext,
} from "@earendil-works/pi-ai/compat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockFetchClineCatalog = vi.hoisted(() => vi.fn());
const mockGetClineShowPaid = vi.hoisted(() => vi.fn(() => false));
const mockGetClineApiKey = vi.hoisted(() =>
	vi.fn((): string | undefined => undefined),
);
const mockGetGlobalFreeOnly = vi.hoisted(() => vi.fn(() => true));

vi.mock("../config.ts", () => ({
	getClineApiKey: () => mockGetClineApiKey(),
	getClineShowPaid: () => mockGetClineShowPaid(),
	applyHidden: (models: unknown[]) => models,
	PROVIDER_CLINE: "cline",
}));

vi.mock("../lib/registry.ts", () => ({
	getGlobalFreeOnly: () => mockGetGlobalFreeOnly(),
	getGlobalFreeOnlyForced: () => false,
	isFreeModel: (m: { cost?: { input?: number } }) => (m.cost?.input ?? 0) === 0,
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

vi.mock("../providers/cline/cline-models.ts", async () => {
	const actual = await vi.importActual<Record<string, unknown>>(
		"../providers/cline/cline-models.ts",
	);
	return {
		...actual,
		fetchClineCatalog: (...args: unknown[]) => mockFetchClineCatalog(...args),
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

import { __setCompatLoaderForTests } from "../lib/lazy-compat.ts";
import { getClineProviderHeaders } from "../providers/cline/cline-headers.ts";
import {
	buildClineHeaders,
	createClineProvider,
	LEGACY_CLINE_API,
	normalizeStoredClineModels,
	rotateClineTaskId,
} from "../providers/cline/cline-provider.ts";
import { BASE_URL_CLINE } from "../constants.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cfg(over: Record<string, unknown> = {}) {
	return {
		id: "m-1",
		name: "Model One",
		reasoning: false,
		input: ["text"] as ("text" | "image")[],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 4096,
		...over,
	};
}

function freeCfg(id: string) {
	return cfg({ id, name: `${id} free` });
}
function paidCfg(id: string) {
	return cfg({
		id,
		name: id,
		cost: { input: 3, output: 15, cacheRead: 0, cacheWrite: 0 },
	});
}

/** In-memory ProviderModelsStore mirroring Pi's native store contract. */
function makeStore(seed?: ModelsStoreEntry): {
	store: ProviderModelsStore;
	written: ModelsStoreEntry[];
} {
	let entry = seed;
	const written: ModelsStoreEntry[] = [];
	const store: ProviderModelsStore = {
		read: async () => entry,
		write: async (e: ModelsStoreEntry) => {
			entry = e;
			written.push(e);
		},
		delete: async () => {
			entry = undefined;
		},
	};
	return { store, written };
}

function ctx(over: Partial<RefreshModelsContext> = {}): RefreshModelsContext {
	const { store } = makeStore();
	return {
		store,
		allowNetwork: false,
		...over,
	} as RefreshModelsContext;
}

beforeEach(() => {
	vi.clearAllMocks();
	mockFetchClineCatalog.mockReset();
	mockGetClineShowPaid.mockReturnValue(false);
	mockGetClineApiKey.mockReturnValue(undefined);
	mockGetGlobalFreeOnly.mockReturnValue(true);
	__setCompatLoaderForTests(undefined);
});

afterEach(() => {
	__setCompatLoaderForTests(undefined);
});

// ---------------------------------------------------------------------------
// Provider object shape
// ---------------------------------------------------------------------------

describe("createClineProvider shape", () => {
	it("builds a native provider with auth, getModels, refreshModels, streams", () => {
		const { provider } = createClineProvider();
		expect(provider.id).toBe("cline");
		expect(provider.name).toBe("Cline");
		expect(provider.baseUrl).toBe("https://api.cline.bot/api/v1");
		expect(typeof provider.getModels).toBe("function");
		expect(typeof provider.refreshModels).toBe("function");
		expect(typeof provider.stream).toBe("function");
		expect(typeof provider.streamSimple).toBe("function");
		// Native auth: both apiKey and oauth present.
		expect(provider.auth.apiKey).toBeDefined();
		expect(provider.auth.oauth).toBeDefined();
		// Empty before the first refresh (dynamic provider contract).
		expect(provider.getModels()).toEqual([]);
	});

	it("exposes the shared Cline headers record as provider.headers", () => {
		const { provider } = createClineProvider();
		expect(provider.headers).toBe(buildClineHeaders());
		expect(provider.headers).toMatchObject({
			"HTTP-Referer": "https://cline.bot",
			"X-Title": "Cline",
			"X-PLATFORM": "Visual Studio Code",
			"X-CLIENT-TYPE": "VSCode Extension",
			"X-Is-Multiroot": "false",
		});
		expect(typeof provider.headers!["X-Task-ID"]).toBe("string");
		expect(provider.headers!["X-Task-ID"]).not.toBe("");
	});

	it("keeps the public catalog available without a credential", async () => {
		const handle = createClineProvider();
		handle.ingest([freeCfg("public")], [freeCfg("public")]);

		const models = createModels();
		models.setProvider(handle.provider);

		const available = await models.getAvailable();
		expect(available.map((model) => model.id)).toEqual(["public"]);
	});

	it("resolves a truthy keyless auth when no key is configured (anonymous catalog)", async () => {
		const { provider } = createClineProvider();
		mockGetClineApiKey.mockReturnValue(undefined);
		const result = await provider.auth.apiKey!.resolve!({
			ctx: {} as never,
			signal: new AbortController().signal,
		});
		expect(result).toEqual({
			auth: {},
			source: "public catalog (no account)",
		});

		// A configured ambient key is returned normally.
		mockGetClineApiKey.mockReturnValue("sk-cline");
		const keyed = await provider.auth.apiKey!.resolve!({
			ctx: {} as never,
			signal: new AbortController().signal,
		});
		expect(keyed).toEqual({
			auth: { apiKey: "sk-cline" },
			source: "CLINE_API_KEY",
		});
	});
});

// ---------------------------------------------------------------------------
// refreshModels: offline init
// ---------------------------------------------------------------------------

describe("refreshModels offline init", () => {
	it("restores models from the store with zero network when allowNetwork=false", async () => {
		const seeded = {
			models: [
				{
					...freeCfg("a"),
					api: "openai-completions",
					provider: "cline",
					baseUrl: BASE_URL_CLINE,
				},
				{
					...paidCfg("b"),
					api: "openai-completions",
					provider: "cline",
					baseUrl: BASE_URL_CLINE,
				},
			],
			checkedAt: Date.now(),
		} as unknown as ModelsStoreEntry;
		const { store } = makeStore(seeded);
		const { provider } = createClineProvider();

		await provider.refreshModels?.(ctx({ store, allowNetwork: false }));

		expect(mockFetchClineCatalog).not.toHaveBeenCalled();
		// getModels exposes the complete catalog; Pi applies filterModels.
		const models = provider.getModels();
		expect(models.map((m) => m.id).sort()).toEqual(["a", "b"]);
		expect(provider.filterModels!(models, undefined).map((m) => m.id)).toEqual([
			"a",
		]);
	});

	it("normalizes legacy XML-api models restored from the legacy store", async () => {
		const seeded = {
			models: [
				{
					...freeCfg("a"),
					api: LEGACY_CLINE_API,
					provider: "cline",
					baseUrl: "https://stale.example",
				},
			],
			checkedAt: Date.now(),
		} as unknown as ModelsStoreEntry;
		const { store } = makeStore(seeded);
		const { provider } = createClineProvider();

		await provider.refreshModels?.(ctx({ store, allowNetwork: false }));

		const models = provider.getModels();
		expect(models).toHaveLength(1);
		expect(models[0].api).toBe("openai-completions");
		expect(models[0].baseUrl).toBe(BASE_URL_CLINE);
	});

	it("normalizes legacy XML-api models restored from the Pi 0.84+ stored snapshot", async () => {
		const published: Array<{ persist?: ModelsStoreEntry | null }> = [];
		const context = {
			allowNetwork: false,
			stored: {
				models: [
					{
						...freeCfg("a"),
						api: LEGACY_CLINE_API,
						provider: "cline",
						baseUrl: "https://stale.example",
					},
					{
						...paidCfg("b"),
						api: "openai-completions",
						provider: "cline",
						baseUrl: BASE_URL_CLINE,
					},
				],
				checkedAt: Date.now(),
			},
			publish: async (publication: {
				persist?: ModelsStoreEntry | null;
				update?: () => void;
			}) => {
				published.push(publication);
				publication.update?.();
				return true;
			},
		} as unknown as RefreshModelsContext;
		const { provider } = createClineProvider();

		await provider.refreshModels?.(context);

		const models = provider.getModels();
		expect(models.map((m) => m.id).sort()).toEqual(["a", "b"]);
		expect(models.every((m) => m.api === "openai-completions")).toBe(true);
		expect(models.every((m) => m.baseUrl === BASE_URL_CLINE)).toBe(true);
		// Offline init never publishes.
		expect(published).toHaveLength(0);
	});

	it("stays empty when the store is empty and network is disallowed", async () => {
		const { provider } = createClineProvider();
		await provider.refreshModels?.(ctx({ allowNetwork: false }));
		expect(mockFetchClineCatalog).not.toHaveBeenCalled();
		expect(provider.getModels()).toEqual([]);
	});

	it("ignores stored models from other providers", async () => {
		const seeded = {
			models: [
				{
					...freeCfg("a"),
					api: "openai-completions",
					provider: "other",
					baseUrl: "x",
				},
			],
		} as unknown as ModelsStoreEntry;
		const { store } = makeStore(seeded);
		const { provider } = createClineProvider();
		await provider.refreshModels?.(ctx({ store, allowNetwork: false }));
		expect(provider.getModels()).toEqual([]);
	});

	it("survives a failing store read without throwing", async () => {
		const store: ProviderModelsStore = {
			read: async () => {
				throw new Error("disk on fire");
			},
			write: async () => {},
			delete: async () => {},
		};
		const { provider } = createClineProvider();
		await expect(
			provider.refreshModels?.(ctx({ store, allowNetwork: false })),
		).resolves.toBeUndefined();
		expect(provider.getModels()).toEqual([]);
	});
});

describe("normalizeStoredClineModels", () => {
	it("rewrites legacy-api entries and stamps the live headers on every restored model", () => {
		const legacy = {
			id: "legacy",
			api: LEGACY_CLINE_API,
			provider: "cline",
			baseUrl: "old",
		};
		const modern = {
			id: "modern",
			api: "openai-completions",
			provider: "cline",
			baseUrl: BASE_URL_CLINE,
		};
		const normalized = normalizeStoredClineModels([legacy, modern] as never);
		expect(normalized).toEqual([
			{
				...legacy,
				api: "openai-completions",
				baseUrl: BASE_URL_CLINE,
				headers: getClineProviderHeaders(),
			},
			{
				...modern,
				// Restored models must carry the LIVE shared record, not a stale
				// serialized snapshot, so task-id rotation keeps working.
				headers: getClineProviderHeaders(),
			},
		]);
		// The input array is not mutated.
		expect(legacy.api).toBe(LEGACY_CLINE_API);
	});
});

// ---------------------------------------------------------------------------
// refreshModels: online (public catalog — no credential)
// ---------------------------------------------------------------------------

describe("refreshModels online", () => {
	it("fetches the public catalog, persists to the store, and publishes models", async () => {
		mockFetchClineCatalog.mockResolvedValue({
			all: [freeCfg("a"), paidCfg("b")],
			free: [freeCfg("a")],
		});
		const { store, written } = makeStore();
		const { provider, stored } = createClineProvider();

		await provider.refreshModels?.(ctx({ store, allowNetwork: true }));

		expect(mockFetchClineCatalog).toHaveBeenCalledTimes(1);
		// The catalog is public: the fetcher receives a signal but no token.
		expect(mockFetchClineCatalog).toHaveBeenCalledWith(
			expect.not.objectContaining({ token: expect.anything() }),
		);
		// Store persisted exactly once with the full catalog.
		expect(written).toHaveLength(1);
		expect(written[0].models.map((m) => m.id).sort()).toEqual(["a", "b"]);
		expect(typeof written[0].checkedAt).toBe("number");
		// Persisted models carry the standard OpenAI wire api + provider + baseUrl.
		expect(written[0].models.every((m) => m.api === "openai-completions")).toBe(
			true,
		);
		expect(written[0].models.every((m) => m.provider === "cline")).toBe(true);
		expect(written[0].models.every((m) => m.baseUrl === BASE_URL_CLINE)).toBe(
			true,
		);
		// Catalogs populated for the toggle.
		expect(stored.all).toHaveLength(2);
		expect(stored.free).toHaveLength(1);
		// getModels exposes the complete catalog; Pi applies filterModels.
		expect(
			provider
				.getModels()
				.map((m) => m.id)
				.sort(),
		).toEqual(["a", "b"]);
		expect(
			provider.filterModels!(provider.getModels(), undefined).map((m) => m.id),
		).toEqual(["a"]);
	});

	it("retains the previous catalog when a fetch returns nothing (poisoning guard)", async () => {
		const seeded = {
			models: [
				{
					...freeCfg("a"),
					api: "openai-completions",
					provider: "cline",
					baseUrl: BASE_URL_CLINE,
				},
			],
		} as unknown as ModelsStoreEntry;
		const { store, written } = makeStore(seeded);
		mockFetchClineCatalog.mockResolvedValue({ all: [], free: [] });
		const { provider } = createClineProvider();

		await provider.refreshModels?.(ctx({ store, allowNetwork: true }));

		// Kept the seeded model, did not persist an empty catalog.
		expect(provider.getModels().map((m) => m.id)).toEqual(["a"]);
		expect(written).toHaveLength(0);
	});

	it("does not fetch or persist when the signal is already aborted", async () => {
		mockFetchClineCatalog.mockResolvedValue({
			all: [freeCfg("a")],
			free: [freeCfg("a")],
		});
		const { store, written } = makeStore();
		const { provider } = createClineProvider();
		const controller = new AbortController();
		controller.abort();

		await provider.refreshModels?.(
			ctx({ store, allowNetwork: true, signal: controller.signal }),
		);

		expect(mockFetchClineCatalog).not.toHaveBeenCalled();
		expect(written).toHaveLength(0);
	});

	it("publishes models even if persisting to the store fails", async () => {
		mockFetchClineCatalog.mockResolvedValue({
			all: [freeCfg("a")],
			free: [freeCfg("a")],
		});
		const store: ProviderModelsStore = {
			read: async () => undefined,
			write: async () => {
				throw new Error("read-only fs");
			},
			delete: async () => {},
		};
		const { provider } = createClineProvider();

		await expect(
			provider.refreshModels?.(ctx({ store, allowNetwork: true })),
		).resolves.toBeUndefined();
		expect(provider.getModels().map((m) => m.id)).toEqual(["a"]);
	});
});

// ---------------------------------------------------------------------------
// Toggle interop (filterModels / decideView)
// ---------------------------------------------------------------------------

describe("toggle interop", () => {
	async function seededProvider() {
		mockFetchClineCatalog.mockResolvedValue({
			all: [freeCfg("a"), paidCfg("b")],
			free: [freeCfg("a")],
		});
		const { store } = makeStore();
		const handle = createClineProvider();
		await handle.provider.refreshModels?.(ctx({ store, allowNetwork: true }));
		return handle;
	}

	it("keeps the full catalog while filterModels selects the free view", async () => {
		const { provider } = await seededProvider();
		expect(
			provider
				.getModels()
				.map((m) => m.id)
				.sort(),
		).toEqual(["a", "b"]);
		expect(
			provider.filterModels!(provider.getModels(), undefined).map((m) => m.id),
		).toEqual(["a"]);
	});

	it("decideView shows all when per-provider show_paid is set under global free-only", async () => {
		mockGetClineShowPaid.mockReturnValue(true);
		const { provider } = await seededProvider();
		// show_paid true + global free-only true => filterModels returns all.
		expect(
			provider.filterModels!(provider.getModels(), undefined)
				.map((m) => m.id)
				.sort(),
		).toEqual(["a", "b"]);
	});

	it("decideView shows all when global free-only is off", async () => {
		mockGetGlobalFreeOnly.mockReturnValue(false);
		const { provider } = await seededProvider();
		expect(
			provider
				.getModels()
				.map((m) => m.id)
				.sort(),
		).toEqual(["a", "b"]);
	});
});

// ---------------------------------------------------------------------------
// Stream wiring (standard openai-completions via the lazy compat bridge)
// ---------------------------------------------------------------------------

describe("stream wiring", () => {
	function clineModel() {
		return {
			id: "nvidia/nemotron-3.5-lightning:free",
			name: "nemotron",
			api: "openai-completions",
			provider: "cline",
			baseUrl: BASE_URL_CLINE,
		};
	}

	function clineContext() {
		return {
			systemPrompt: "system",
			messages: [
				{
					role: "user",
					content: [{ type: "text", text: "hello" }],
					timestamp: 1,
				},
			],
			tools: [],
		};
	}

	/** Minimal fake of pi-ai's EventStream contract (async iterable + result). */
	function makeFakeStream(events: unknown[], finalResult: unknown) {
		return {
			async *[Symbol.asyncIterator]() {
				for (const event of events) yield event;
			},
			result: () => Promise.resolve(finalResult),
		};
	}

	function stubCompat(recordInto?: {
		streamCalls: unknown[][];
		streamSimpleCalls: unknown[][];
	}) {
		const doneMessage = { role: "assistant", content: [], stopReason: "stop" };
		const textEvent = { type: "text", text: "hello" };
		const doneEvent = { type: "done", message: doneMessage };
		__setCompatLoaderForTests((async () => ({
			openAICompletionsApi: () => ({
				stream: (...args: unknown[]) => {
					recordInto?.streamCalls.push(args);
					return makeFakeStream(
						[textEvent, doneEvent],
						doneMessage,
					) as unknown as AssistantMessageEventStream;
				},
				streamSimple: (...args: unknown[]) => {
					recordInto?.streamSimpleCalls.push(args);
					return makeFakeStream(
						[textEvent, doneEvent],
						doneMessage,
					) as unknown as AssistantMessageEventStream;
				},
			}),
			anthropicMessagesApi: () => {
				throw new Error("anthropic must not be used");
			},
		})) as Parameters<typeof __setCompatLoaderForTests>[0]);
		return doneMessage;
	}

	it("sends the Cline identity headers on the wire (model.headers, not provider.headers)", async () => {
		// Regression test for the B1 review finding: pi-ai's Models.getAuth
		// merges only the MODEL's headers into the request, never
		// provider.headers. The Cline identity record must therefore be
		// stamped on every model and actually reach the gateway.
		const captured: Array<{ url: string; headers: Record<string, string> }> = [];
		const sse = [
			`data: ${JSON.stringify({
				id: "gen-1",
				object: "chat.completion.chunk",
				created: 0,
				model: "nvidia/nemotron-3.5-lightning:free",
				choices: [{ index: 0, delta: { content: "hi" } }],
			})}\n\n`,
			`data: ${JSON.stringify({
				id: "gen-1",
				object: "chat.completion.chunk",
				created: 0,
				model: "nvidia/nemotron-3.5-lightning:free",
				choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
			})}\n\n`,
			"data: [DONE]\n\n",
		].join("");

		const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
			// fetch normalizes header names to lowercase; read them back flat.
			const flat: Record<string, string> = {};
			const h = init?.headers as unknown as {
				forEach(cb: (value: string, key: string) => void): void;
			};
			h?.forEach((v, k) => {
				flat[k] = v;
			});
			captured.push({ url: String(url), headers: flat });
			return new Response(sse, {
				status: 200,
				headers: { "Content-Type": "text/event-stream" },
			});
		});
		vi.stubGlobal("fetch", fetchMock);
		try {
			// Real compat path (the seam is reset in beforeEach, so the actual
			// @earendil-works/pi-ai/compat module loads and issues the fetch).
			const { createClineProvider: create } = await import(
				"../providers/cline/cline-provider.ts"
			);
			const { provider, stored } = create();
			stored.all = [
				{
					...clineModel(),
					input: ["text"],
					headers: getClineProviderHeaders(),
				} as never,
			];
			const models = createModels();
			models.setProvider(provider);
			const model = models.getModels("cline")[0];

			const stream = models.stream(model as never, clineContext() as never, {
				apiKey: "workos:test-token",
			});
			for await (const _event of stream as AsyncIterable<unknown>) {
				// drain
			}

			expect(captured).toHaveLength(1);
			expect(captured[0].url).toBe(`${BASE_URL_CLINE}/chat/completions`);
			const sent = captured[0].headers;
			expect(sent["authorization"]).toBe("Bearer workos:test-token");
			expect(sent["user-agent"]).toBe("Cline/4.1.10");
			expect(sent["x-client-version"]).toBe("4.1.10");
			expect(sent["x-client-type"]).toBe("VSCode Extension");
			expect(sent["x-task-id"]).toBeTruthy();
			expect(sent["http-referer"]).toBe("https://cline.bot");
			expect(sent["x-title"]).toBe("Cline");
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("stream delegates to the lazy openai-completions compat bridge", async () => {
		const calls = {
			streamCalls: [] as unknown[][],
			streamSimpleCalls: [] as unknown[][],
		};
		const doneMessage = stubCompat(calls);
		const { provider } = createClineProvider();
		const model = clineModel();
		const context = clineContext();
		const options = { apiKey: "workos:test-token" };

		const outer = provider.stream(
			model as never,
			context as never,
			options as never,
		);
		const events: unknown[] = [];
		for await (const event of outer as AsyncIterable<unknown>) {
			events.push(event);
		}

		expect(calls.streamCalls).toHaveLength(1);
		expect(calls.streamCalls[0]).toEqual([model, context, options]);
		expect(events).toEqual([
			{ type: "text", text: "hello" },
			{ type: "done", message: doneMessage },
		]);
		expect(await outer.result()).toBe(doneMessage);
	});

	it("streamSimple delegates to the lazy openai-completions compat bridge too", async () => {
		const calls = {
			streamCalls: [] as unknown[][],
			streamSimpleCalls: [] as unknown[][],
		};
		stubCompat(calls);
		const { provider } = createClineProvider();
		const model = clineModel();
		const context = clineContext();

		const outer = provider.streamSimple(model as never, context as never);
		for await (const _event of outer as AsyncIterable<unknown>) {
			// drain
		}

		expect(calls.streamSimpleCalls).toHaveLength(1);
		expect(calls.streamSimpleCalls[0]).toEqual([model, context, undefined]);
		expect(calls.streamCalls).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// Task-id rotation (shared mutable headers record)
// ---------------------------------------------------------------------------

describe("task-id rotation", () => {
	it("rotateClineTaskId mutates the shared headers object (provider.headers)", () => {
		const { provider } = createClineProvider();
		const before = buildClineHeaders()["X-Task-ID"];
		expect(provider.headers!["X-Task-ID"]).toBe(before);

		rotateClineTaskId();

		const after = buildClineHeaders()["X-Task-ID"];
		expect(after).not.toBe(before);
		// The SAME object is exposed as provider.headers — the mutation is
		// visible there, so the next request picks it up with no re-register.
		expect(provider.headers).toBe(buildClineHeaders());
		expect(provider.headers!["X-Task-ID"]).toBe(after);
		// The rest of the VS Code-spoofing headers are unchanged.
		expect(provider.headers).toMatchObject({
			"HTTP-Referer": "https://cline.bot",
			"X-Title": "Cline",
			"X-CLIENT-TYPE": "VSCode Extension",
		});
	});
});
