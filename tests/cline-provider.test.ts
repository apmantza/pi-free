/**
 * Unit tests for the Cline native provider (createProvider object form).
 *
 * Mirrors tests/kilo-provider.test.ts, plus the Cline-specific pieces:
 *   - the custom "cline-xml-tools" wire api: stream AND streamSimple both
 *     delegate to the XML bridge (message reshaping carried over verbatim)
 *   - public catalog: refreshModels fetches without any credential
 */

import { createModels } from "@earendil-works/pi-ai";
import type {
	ModelsStoreEntry,
	ProviderModelsStore,
	RefreshModelsContext,
} from "@earendil-works/pi-ai/compat";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { createClineProvider } from "../providers/cline/cline-provider.ts";

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

	it("keeps the public catalog available without a credential", async () => {
		const handle = createClineProvider();
		handle.ingest([freeCfg("public")], [freeCfg("public")]);

		const models = createModels();
		models.setProvider(handle.provider);

		const available = await models.getAvailable();
		expect(available.map((model) => model.id)).toEqual(["public"]);
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
					api: "cline-xml-tools",
					provider: "cline",
					baseUrl: "x",
				},
				{
					...paidCfg("b"),
					api: "cline-xml-tools",
					provider: "cline",
					baseUrl: "x",
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
					api: "cline-xml-tools",
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
		// Persisted models carry the native wire api + provider.
		expect(written[0].models.every((m) => m.api === "cline-xml-tools")).toBe(
			true,
		);
		expect(written[0].models.every((m) => m.provider === "cline")).toBe(true);
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
					api: "cline-xml-tools",
					provider: "cline",
					baseUrl: "x",
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
// XML bridge delegation (the message-reshaping entry points)
// ---------------------------------------------------------------------------

describe("stream wiring", () => {
	function clineModel() {
		return {
			id: "xiaomi/mimo-v2.5",
			name: "mimo",
			api: "cline-xml-tools",
			provider: "cline",
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

	it("streamSimple delegates to the XML bridge (unchanged reshaping entry point)", async () => {
		const { provider } = createClineProvider();
		const model = provider.getModels().length
			? provider.getModels()[0]
			: (clineModel() as never);

		// No apiKey -> the bridge's own guard error, proving the native provider
		// routes through streamClineXml rather than a generic OpenAI stream.
		const result = await provider
			.streamSimple(model, clineContext() as never, {})
			.result();

		expect(result.stopReason).toBe("error");
		expect(result.errorMessage).toContain("No Cline access token found");
	});

	it("stream delegates to the XML bridge too (legacy composer routed both here)", async () => {
		const { provider } = createClineProvider();
		const result = await provider
			.stream(clineModel() as never, clineContext() as never, {})
			.result();

		expect(result.stopReason).toBe("error");
		expect(result.errorMessage).toContain("No Cline access token found");
	});
});
