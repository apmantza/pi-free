/**
 * Unit tests for the LLM7 native provider (createProvider object form).
 *
 * Mirrors tests/cline-provider.test.ts, plus the LLM7-specific pieces:
 *   - keyless proof case: auth always resolves (empty auth when no key), so
 *     Pi's availability filtering keeps the public free catalog visible
 *     with zero credential — verified through the REAL pi-ai Models registry
 *   - static selector catalog: refreshModels performs ZERO network I/O even
 *     when allowNetwork is true (asserted via a global fetch spy)
 */

import { createModels } from "@earendil-works/pi-ai";
import type {
	ModelsStoreEntry,
	ProviderModelsStore,
	RefreshModelsContext,
} from "@earendil-works/pi-ai/compat";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetLlm7ShowPaid = vi.hoisted(() => vi.fn(() => false));
const mockGetLlm7ApiKey = vi.hoisted(() =>
	vi.fn((): string | undefined => undefined),
);
const mockApplyHidden = vi.hoisted(() =>
	vi.fn(<T extends { id: string }>(models: T[]): T[] => models),
);
const mockGetGlobalFreeOnly = vi.hoisted(() => vi.fn(() => true));
const mockFetch = vi.hoisted(() => vi.fn());

vi.mock("../config.ts", () => ({
	getLlm7ApiKey: () => mockGetLlm7ApiKey(),
	getLlm7ShowPaid: () => mockGetLlm7ShowPaid(),
	applyHidden: (models: { id: string }[]) => mockApplyHidden(models),
}));

vi.mock("../lib/registry.ts", () => ({
	getGlobalFreeOnly: () => mockGetGlobalFreeOnly(),
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

vi.mock("../lib/logger.ts", () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	}),
}));

import { llm7Auth } from "../providers/llm7/llm7-auth.ts";
import { fetchLlm7Catalog } from "../providers/llm7/llm7-models.ts";
import { createLlm7Provider } from "../providers/llm7/llm7-provider.ts";

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
		contextWindow: 32_000,
		maxTokens: 4096,
		...over,
	};
}

function freeCfg(id: string) {
	return cfg({ id, name: `LLM7 ${id}` });
}
function paidCfg(id: string) {
	return cfg({
		id,
		name: `LLM7 ${id}`,
		cost: { input: 0.3, output: 0.9, cacheRead: 0, cacheWrite: 0 },
	});
}

function nativeCfg(id: string, paid = false) {
	return {
		...(paid ? paidCfg(id) : freeCfg(id)),
		api: "openai-completions",
		provider: "llm7",
		baseUrl: "https://api.llm7.io/v1",
	};
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
	mockGetLlm7ShowPaid.mockReturnValue(false);
	mockGetLlm7ApiKey.mockReturnValue(undefined);
	mockApplyHidden.mockImplementation(<T extends { id: string }>(models: T[]) => models);
	mockGetGlobalFreeOnly.mockReturnValue(true);
	vi.stubGlobal("fetch", mockFetch);
});

// ---------------------------------------------------------------------------
// Provider object shape
// ---------------------------------------------------------------------------

describe("createLlm7Provider shape", () => {
	it("builds a native provider with auth, getModels, refreshModels, streams", () => {
		const { provider } = createLlm7Provider();
		expect(provider.id).toBe("llm7");
		expect(provider.name).toBe("LLM7");
		expect(provider.baseUrl).toBe("https://api.llm7.io/v1");
		expect(provider.headers).toMatchObject({
			"User-Agent": "pi-free-providers",
		});
		expect(typeof provider.getModels).toBe("function");
		expect(typeof provider.refreshModels).toBe("function");
		expect(typeof provider.stream).toBe("function");
		expect(typeof provider.streamSimple).toBe("function");
		// Native auth: apiKey only — LLM7 has no OAuth flow.
		expect(provider.auth.apiKey).toBeDefined();
		expect(provider.auth.oauth).toBeUndefined();
		// Empty before the first refresh (dynamic provider contract).
		expect(provider.getModels()).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// Keyless auth (the proof case)
// ---------------------------------------------------------------------------

describe("keyless auth", () => {
	it("resolves with an empty auth when no key is configured (public catalog)", async () => {
		mockGetLlm7ApiKey.mockReturnValue(undefined);
		const result = await llm7Auth.apiKey?.resolve({
			ctx: {} as never,
			credential: undefined,
		});
		// Must RESOLVE (not undefined) so Pi's Models.refresh() does not skip
		// the provider for logged-out users.
		expect(result).toBeDefined();
		expect(result?.auth).toEqual({});
		expect(result?.auth).not.toHaveProperty("apiKey");
	});

	it("resolves the ambient LLM7_API_KEY when configured", async () => {
		mockGetLlm7ApiKey.mockReturnValue("sk-llm7");
		const result = await llm7Auth.apiKey?.resolve({
			ctx: {} as never,
			credential: undefined,
		});
		expect(result?.auth).toEqual({ apiKey: "sk-llm7" });
	});

	it("prefers a natively-stored key over the ambient config", async () => {
		mockGetLlm7ApiKey.mockReturnValue("sk-ambient");
		const result = await llm7Auth.apiKey?.resolve({
			ctx: {} as never,
			credential: { type: "api_key", key: "sk-stored" },
		});
		expect(result?.auth).toEqual({ apiKey: "sk-stored" });
	});

	it("has no apiKey.check that could hide the public catalog", () => {
		expect(llm7Auth.apiKey).not.toHaveProperty("check");
	});

	it("keeps the public catalog available without a credential (real Models registry)", async () => {
		const handle = createLlm7Provider();
		const { all, free } = fetchLlm7Catalog();
		handle.ingest(all, free);

		const models = createModels();
		models.setProvider(handle.provider);

		const available = await models.getAvailable();
		// Free-only view by default: the default + fast selectors, no key needed.
		expect(available.map((model) => model.id).sort()).toEqual([
			"default",
			"fast",
		]);
	});
});

// ---------------------------------------------------------------------------
// Static catalog
// ---------------------------------------------------------------------------

describe("fetchLlm7Catalog", () => {
	it("returns the three routing selectors split into all/free", () => {
		const { all, free } = fetchLlm7Catalog();
		expect(all.map((m) => m.id)).toEqual(["default", "fast", "pro"]);
		// Route A pricing detection: pro exposes cost, so free = zero-cost.
		expect(free.map((m) => m.id)).toEqual(["default", "fast"]);
	});

	it("applies the hidden_models filter", () => {
		mockApplyHidden.mockImplementation((models: { id: string }[]) =>
			models.filter((m) => m.id !== "pro"),
		);
		const { all } = fetchLlm7Catalog();
		expect(mockApplyHidden).toHaveBeenCalled();
		expect(all.map((m) => m.id)).toEqual(["default", "fast"]);
	});
});

// ---------------------------------------------------------------------------
// refreshModels: offline init
// ---------------------------------------------------------------------------

describe("refreshModels offline init", () => {
	it("restores models from the store with zero network when allowNetwork=false", async () => {
		const seeded = {
			models: [nativeCfg("default"), nativeCfg("fast"), nativeCfg("pro", true)],
			checkedAt: Date.now(),
		} as unknown as ModelsStoreEntry;
		const { store } = makeStore(seeded);
		const { provider } = createLlm7Provider();

		await provider.refreshModels?.(ctx({ store, allowNetwork: false }));

		expect(mockFetch).not.toHaveBeenCalled();
		// Global free-only on + no show_paid => free selectors only.
		expect(provider.getModels().map((m) => m.id)).toEqual([
			"default",
			"fast",
		]);
	});

	it("stays empty when the store is empty and network is disallowed", async () => {
		const { provider } = createLlm7Provider();
		await provider.refreshModels?.(ctx({ allowNetwork: false }));
		expect(mockFetch).not.toHaveBeenCalled();
		expect(provider.getModels()).toEqual([]);
	});

	it("ignores stored models from other providers", async () => {
		const seeded = {
			models: [{ ...nativeCfg("default"), provider: "other" }],
		} as unknown as ModelsStoreEntry;
		const { store } = makeStore(seeded);
		const { provider } = createLlm7Provider();
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
		const { provider } = createLlm7Provider();
		await expect(
			provider.refreshModels?.(ctx({ store, allowNetwork: false })),
		).resolves.toBeUndefined();
		expect(provider.getModels()).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// refreshModels: online (static catalog — still zero network)
// ---------------------------------------------------------------------------

describe("refreshModels online", () => {
	it("publishes the static selector catalog and persists it, with zero network", async () => {
		const { store, written } = makeStore();
		const { provider, stored } = createLlm7Provider();

		await provider.refreshModels?.(ctx({ store, allowNetwork: true }));

		// The catalog is static: NO fetch even on the online path.
		expect(mockFetch).not.toHaveBeenCalled();
		// Store persisted exactly once with the full catalog.
		expect(written).toHaveLength(1);
		expect(written[0].models.map((m) => m.id)).toEqual([
			"default",
			"fast",
			"pro",
		]);
		expect(typeof written[0].checkedAt).toBe("number");
		// Persisted models carry the native wire api + provider + baseUrl.
		expect(written[0].models.every((m) => m.api === "openai-completions")).toBe(
			true,
		);
		expect(written[0].models.every((m) => m.provider === "llm7")).toBe(true);
		expect(
			written[0].models.every((m) => m.baseUrl === "https://api.llm7.io/v1"),
		).toBe(true);
		// Catalogs populated for the toggle.
		expect(stored.all.map((m) => m.id)).toEqual(["default", "fast", "pro"]);
		expect(stored.free.map((m) => m.id)).toEqual(["default", "fast"]);
		// Free-only view by default.
		expect(provider.getModels().map((m) => m.id)).toEqual([
			"default",
			"fast",
		]);
	});

	it("retains the previous catalog when the build returns nothing (poisoning guard)", async () => {
		const seeded = {
			models: [nativeCfg("default")],
		} as unknown as ModelsStoreEntry;
		const { store, written } = makeStore(seeded);
		// Every selector hidden via hidden_models config.
		mockApplyHidden.mockImplementation(() => []);
		const { provider } = createLlm7Provider();

		await provider.refreshModels?.(ctx({ store, allowNetwork: true }));

		// Kept the seeded model, did not persist an empty catalog.
		expect(provider.getModels().map((m) => m.id)).toEqual(["default"]);
		expect(written).toHaveLength(0);
	});

	it("does not publish or persist when the signal is already aborted", async () => {
		const { store, written } = makeStore();
		const { provider } = createLlm7Provider();
		const controller = new AbortController();
		controller.abort();

		await provider.refreshModels?.(
			ctx({ store, allowNetwork: true, signal: controller.signal }),
		);

		expect(provider.getModels()).toEqual([]);
		expect(written).toHaveLength(0);
	});

	it("publishes models even if persisting to the store fails", async () => {
		const store: ProviderModelsStore = {
			read: async () => undefined,
			write: async () => {
				throw new Error("read-only fs");
			},
			delete: async () => {},
		};
		const { provider } = createLlm7Provider();

		await expect(
			provider.refreshModels?.(ctx({ store, allowNetwork: true })),
		).resolves.toBeUndefined();
		expect(provider.getModels().map((m) => m.id)).toEqual([
			"default",
			"fast",
		]);
	});
});

// ---------------------------------------------------------------------------
// Toggle interop (setView / decideView)
// ---------------------------------------------------------------------------

describe("toggle interop", () => {
	async function seededProvider() {
		const { store } = makeStore();
		const handle = createLlm7Provider();
		await handle.provider.refreshModels?.(ctx({ store, allowNetwork: true }));
		return handle;
	}

	it("setView swaps the visible catalog (what /toggle-llm7 and /toggle-free drive)", async () => {
		const { provider, stored, setView } = await seededProvider();
		expect(provider.getModels().map((m) => m.id)).toEqual([
			"default",
			"fast",
		]);

		// reRegister(stored.all) -> setView(stored.all) + re-register.
		setView(stored.all);
		expect(provider.getModels().map((m) => m.id)).toEqual([
			"default",
			"fast",
			"pro",
		]);

		// And back to free.
		setView(stored.free);
		expect(provider.getModels().map((m) => m.id)).toEqual([
			"default",
			"fast",
		]);
	});

	it("decideView shows all when per-provider show_paid is set under global free-only", async () => {
		mockGetLlm7ShowPaid.mockReturnValue(true);
		const { provider } = await seededProvider();
		// show_paid true + global free-only true => all models.
		expect(provider.getModels().map((m) => m.id)).toEqual([
			"default",
			"fast",
			"pro",
		]);
	});

	it("decideView shows all when global free-only is off", async () => {
		mockGetGlobalFreeOnly.mockReturnValue(false);
		const { provider } = await seededProvider();
		expect(provider.getModels().map((m) => m.id)).toEqual([
			"default",
			"fast",
			"pro",
		]);
	});
});
