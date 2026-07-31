/**
 * Unit tests for the Kilo native provider (createProvider object form).
 *
 * Covers the pieces the migration is responsible for:
 *   - refreshModels offline init (store-only, zero network)
 *   - refreshModels online (fetch + store.write + credential passing)
 *   - store persistence + poisoning guard + abort signal
 *   - free/paid toggle via setView / decideView
 *   - the native provider object shape (auth, getModels, stream wiring)
 */

import type {
	Credential,
	ModelsStoreEntry,
	ProviderModelsStore,
	RefreshModelsContext,
} from "@earendil-works/pi-ai/compat";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFetchKiloCatalog = vi.hoisted(() => vi.fn());
const mockGetKiloApiKey = vi.hoisted(() => vi.fn((): string | undefined => undefined));
const mockGetKiloShowPaid = vi.hoisted(() => vi.fn(() => false));
const mockGetKiloFreeOnly = vi.hoisted(() => vi.fn(() => false));
const mockGetGlobalFreeOnly = vi.hoisted(() => vi.fn(() => true));

vi.mock("../config.ts", () => ({
	getKiloApiKey: () => mockGetKiloApiKey(),
	getKiloShowPaid: () => mockGetKiloShowPaid(),
	getKiloFreeOnly: () => mockGetKiloFreeOnly(),
	applyHidden: (models: unknown[]) => models,
	PROVIDER_KILO: "kilo",
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

vi.mock("../providers/kilo/kilo-models.ts", async () => {
	const actual = await vi.importActual<Record<string, unknown>>(
		"../providers/kilo/kilo-models.ts",
	);
	return {
		...actual,
		fetchKiloCatalog: (...args: unknown[]) => mockFetchKiloCatalog(...args),
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

import { createKiloProvider } from "../providers/kilo/kilo-provider.ts";

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
	mockFetchKiloCatalog.mockReset();
	mockGetKiloApiKey.mockReturnValue(undefined);
	mockGetKiloShowPaid.mockReturnValue(false);
	mockGetKiloFreeOnly.mockReturnValue(false);
	mockGetGlobalFreeOnly.mockReturnValue(true);
});

// ---------------------------------------------------------------------------
// Provider object shape
// ---------------------------------------------------------------------------

describe("createKiloProvider shape", () => {
	it("builds a native provider with auth, getModels, refreshModels, streams", () => {
		const { provider } = createKiloProvider();
		expect(provider.id).toBe("kilo");
		expect(provider.name).toBe("Kilo");
		expect(provider.baseUrl).toContain("/api/gateway");
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
});

// ---------------------------------------------------------------------------
// refreshModels: offline init
// ---------------------------------------------------------------------------

describe("refreshModels offline init", () => {
	it("restores models from the store with zero network when allowNetwork=false", async () => {
		const seeded = {
			models: [
				{ ...freeCfg("a"), api: "openai-completions", provider: "kilo", baseUrl: "x" },
				{ ...paidCfg("b"), api: "openai-completions", provider: "kilo", baseUrl: "x" },
			],
			checkedAt: Date.now(),
		} as unknown as ModelsStoreEntry;
		const { store } = makeStore(seeded);
		const { provider } = createKiloProvider();

		await provider.refreshModels?.(ctx({ store, allowNetwork: false }));

		expect(mockFetchKiloCatalog).not.toHaveBeenCalled();
		// getModels exposes the complete catalog; Pi applies filterModels.
		const models = provider.getModels();
		expect(models.map((m) => m.id).sort()).toEqual(["a", "b"]);
		expect(provider.filterModels!(models, undefined).map((m) => m.id)).toEqual(["a"]);
	});

	it("stays empty when the store is empty and network is disallowed", async () => {
		const { provider } = createKiloProvider();
		await provider.refreshModels?.(ctx({ allowNetwork: false }));
		expect(mockFetchKiloCatalog).not.toHaveBeenCalled();
		expect(provider.getModels()).toEqual([]);
	});

	it("ignores stored models from other providers", async () => {
		const seeded = {
			models: [
				{ ...freeCfg("a"), api: "openai-completions", provider: "other", baseUrl: "x" },
			],
		} as unknown as ModelsStoreEntry;
		const { store } = makeStore(seeded);
		const { provider } = createKiloProvider();
		await provider.refreshModels?.(ctx({ store, allowNetwork: false }));
		expect(provider.getModels()).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// refreshModels: online
// ---------------------------------------------------------------------------

describe("refreshModels online", () => {
	it("fetches, persists to the store, and publishes models", async () => {
		mockFetchKiloCatalog.mockResolvedValue({
			all: [freeCfg("a"), paidCfg("b")],
			free: [freeCfg("a")],
		});
		const { store, written } = makeStore();
		const { provider, stored } = createKiloProvider();

		await provider.refreshModels?.(ctx({ store, allowNetwork: true }));

		expect(mockFetchKiloCatalog).toHaveBeenCalledTimes(1);
		// Store persisted exactly once with the full catalog.
		expect(written).toHaveLength(1);
		expect(written[0].models.map((m) => m.id).sort()).toEqual(["a", "b"]);
		expect(typeof written[0].checkedAt).toBe("number");
		// Catalogs populated for the toggle.
		expect(stored.all).toHaveLength(2);
		expect(stored.free).toHaveLength(1);
		// getModels exposes the complete catalog; Pi applies filterModels.
		expect(provider.getModels().map((m) => m.id).sort()).toEqual(["a", "b"]);
		expect(provider.filterModels!(provider.getModels(), undefined).map((m) => m.id)).toEqual(["a"]);
	});

	it("passes the OAuth access token from context.credential to the fetcher", async () => {
		mockFetchKiloCatalog.mockResolvedValue({ all: [], free: [] });
		const { store } = makeStore();
		const { provider } = createKiloProvider();
		const credential: Credential = {
			type: "oauth",
			refresh: "r",
			access: "oauth-access-token",
			expires: Date.now() + 1000,
		};

		await provider.refreshModels?.(ctx({ store, allowNetwork: true, credential }));

		expect(mockFetchKiloCatalog).toHaveBeenCalledWith(
			expect.objectContaining({ token: "oauth-access-token" }),
		);
	});

	it("passes the api_key credential key to the fetcher", async () => {
		mockFetchKiloCatalog.mockResolvedValue({ all: [], free: [] });
		const { store } = makeStore();
		const { provider } = createKiloProvider();
		const credential: Credential = { type: "api_key", key: "sk-stored" };

		await provider.refreshModels?.(ctx({ store, allowNetwork: true, credential }));

		expect(mockFetchKiloCatalog).toHaveBeenCalledWith(
			expect.objectContaining({ token: "sk-stored" }),
		);
	});

	it("falls back to the ambient KILO_API_KEY when no credential is present", async () => {
		mockGetKiloApiKey.mockReturnValue("sk-ambient");
		mockFetchKiloCatalog.mockResolvedValue({ all: [], free: [] });
		const { store } = makeStore();
		const { provider } = createKiloProvider();

		await provider.refreshModels?.(ctx({ store, allowNetwork: true }));

		expect(mockFetchKiloCatalog).toHaveBeenCalledWith(
			expect.objectContaining({ token: "sk-ambient" }),
		);
	});

	it("retains the previous catalog when a fetch returns nothing (poisoning guard)", async () => {
		const seeded = {
			models: [
				{ ...freeCfg("a"), api: "openai-completions", provider: "kilo", baseUrl: "x" },
			],
		} as unknown as ModelsStoreEntry;
		const { store, written } = makeStore(seeded);
		mockFetchKiloCatalog.mockResolvedValue({ all: [], free: [] });
		const { provider } = createKiloProvider();

		await provider.refreshModels?.(ctx({ store, allowNetwork: true }));

		// Kept the seeded model, did not persist an empty catalog.
		expect(provider.getModels().map((m) => m.id)).toEqual(["a"]);
		expect(written).toHaveLength(0);
	});

	it("does not fetch or persist when the signal is already aborted", async () => {
		mockFetchKiloCatalog.mockResolvedValue({
			all: [freeCfg("a")],
			free: [freeCfg("a")],
		});
		const { store, written } = makeStore();
		const { provider } = createKiloProvider();
		const controller = new AbortController();
		controller.abort();

		await provider.refreshModels?.(
			ctx({ store, allowNetwork: true, signal: controller.signal }),
		);

		expect(mockFetchKiloCatalog).not.toHaveBeenCalled();
		expect(written).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// Toggle interop (setView / decideView)
// ---------------------------------------------------------------------------

describe("toggle interop", () => {
	async function seededProvider() {
		mockFetchKiloCatalog.mockResolvedValue({
			all: [freeCfg("a"), paidCfg("b")],
			free: [freeCfg("a")],
		});
		const { store } = makeStore();
		const handle = createKiloProvider();
		await handle.provider.refreshModels?.(ctx({ store, allowNetwork: true }));
		return handle;
	}

	it("keeps the full catalog while filterModels selects the free view", async () => {
		const { provider, stored, setView } = await seededProvider();
		expect(provider.getModels().map((m) => m.id).sort()).toEqual(["a", "b"]);
		expect(provider.filterModels!(provider.getModels(), undefined).map((m) => m.id)).toEqual(["a"]);

		// Re-registration is now an availability-snapshot invalidation signal.
		setView(stored.all);
		setView(stored.free);
		expect(provider.getModels().map((m) => m.id).sort()).toEqual(["a", "b"]);
		expect(provider.filterModels!(provider.getModels(), undefined).map((m) => m.id)).toEqual(["a"]);
	});

	it("decideView shows all when per-provider show_paid is set under global free-only", async () => {
		mockGetKiloShowPaid.mockReturnValue(true);
		const { provider } = await seededProvider();
		// show_paid true + global free-only true => filterModels returns all.
		expect(provider.filterModels!(provider.getModels(), undefined).map((m) => m.id).sort()).toEqual(["a", "b"]);
	});

	it("filterModels shows all when global free-only is off", async () => {
		mockGetGlobalFreeOnly.mockReturnValue(false);
		const { provider } = await seededProvider();
		expect(provider.filterModels!(provider.getModels(), undefined).map((m) => m.id).sort()).toEqual(["a", "b"]);
	});

	it("filterModels forces free when kilo_free_only is set", async () => {
		mockGetKiloFreeOnly.mockReturnValue(true);
		mockGetKiloShowPaid.mockReturnValue(true);
		const { provider } = await seededProvider();
		expect(provider.filterModels!(provider.getModels(), undefined).map((m) => m.id)).toEqual(["a"]);
	});
});
