/**
 * OpenModel anonymous catalog refresh (#421).
 *
 * Without a configured key the refresh must still populate models from the
 * public paginated web catalog (`GET /web/v1/models?page=N`) and must not hit
 * the authenticated `/v1/models` protocol endpoint.
 */

import type {
	ModelsStoreEntry,
	ProviderModelsStore,
	RefreshModelsContext,
} from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Provider } from "@earendil-works/pi-ai/compat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetOpenmodelApiKey = vi.hoisted(() =>
	vi.fn((): string | undefined => undefined),
);

vi.mock("../config.ts", () => ({
	getOpenmodelApiKey: () => mockGetOpenmodelApiKey(),
	getOpenmodelShowPaid: () => false,
	applyHidden: (models: unknown[]) => models,
	saveConfig: async () => undefined,
}));

vi.mock("../lib/registry.ts", () => ({
	getGlobalFreeOnly: () => true,
	getGlobalFreeOnlyForced: () => false,
	isFreeModel: (model: { cost?: { input?: number; output?: number } }) =>
		(model.cost?.input ?? 0) === 0 && (model.cost?.output ?? 0) === 0,
	registerWithGlobalToggle: vi.fn(),
}));

vi.mock("../lib/logger.ts", () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	}),
}));

vi.mock("../lib/model-metadata.ts", () => ({
	safeEnrichModelsWithModelsDev: async <T>(models: T[]) => models,
}));

vi.mock("../lib/provider-compat.ts", () => ({
	isLikelyReasoningModel: () => false,
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

vi.mock("../lib/lazy-compat.ts", () => ({
	lazyAnthropicMessagesApi: () => ({
		stream: vi.fn(),
		streamSimple: vi.fn(),
	}),
}));

import openmodelProvider from "../providers/openmodel/openmodel.ts";

function webPage(items: unknown[]) {
	return {
		success: true,
		meta: {
			pagination: { page: 1, pageSize: 20, total: items.length, totalPages: 1 },
		},
		data: items,
	};
}

function catalogItem(key: string, multiplier: number) {
	return {
		key,
		provider_key: "prov",
		provider_name: "Prov",
		prices: {
			input_cost_per_token: 1e-6,
			output_cost_per_token: 2e-6,
		},
		max: { max_input_tokens: 128_000, max_output_tokens: 8_192 },
		supports: { supports_vision: false },
		price_multiplier: multiplier,
	};
}

function makePi(): {
	pi: ExtensionAPI;
	registered: Provider[];
} {
	const registered: Provider[] = [];
	const pi = {
		registerProvider: (provider: Provider) => {
			registered.push(provider);
		},
		registerCommand: vi.fn(),
		on: vi.fn(),
	} as unknown as ExtensionAPI;
	return { pi, registered };
}

function makeStore(): { store: ProviderModelsStore } {
	let entry: ModelsStoreEntry | undefined;
	return {
		store: {
			read: async () => entry,
			write: async (next: ModelsStoreEntry) => {
				entry = next;
			},
			delete: async () => {
				entry = undefined;
			},
		},
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mockGetOpenmodelApiKey.mockReturnValue(undefined);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("OpenModel anonymous refresh (#421)", () => {
	it("populates models from the public /web/ catalog without a token", async () => {
		const urls: string[] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: unknown) => {
				const url = String(input);
				urls.push(url);
				if (url.includes("/web/v1/models")) {
					return {
						ok: true,
						status: 200,
						statusText: "OK",
						json: async () =>
							webPage([
								catalogItem("free-promo-model", 0),
								catalogItem("paid-model", 1),
							]),
					};
				}
				return {
					ok: false,
					status: 401,
					statusText: "Unauthorized",
					json: async () => ({}),
				};
			}),
		);

		const { pi, registered } = makePi();
		await openmodelProvider(pi);
		const provider = registered[0];
		expect(provider.id).toBe("openmodel");

		const { store } = makeStore();
		await provider.refreshModels?.({
			store,
			allowNetwork: true,
			signal: new AbortController().signal,
		} as unknown as RefreshModelsContext);

		// Only the public catalog was fetched — never the authenticated
		// /v1/models protocol endpoint.
		expect(urls.length).toBeGreaterThan(0);
		for (const url of urls) {
			expect(url).toContain("/web/v1/models");
		}

		const models = provider.getModels();
		expect(models.map((m) => m.id).sort()).toEqual([
			"free-promo-model",
			"paid-model",
		]);
		// Free view reflects the multiplier-0 promo model.
		expect(provider.filterModels!(models, undefined).map((m) => m.id)).toEqual([
			"free-promo-model",
		]);
	});

	it("resolves keyless auth so Pi's refresh runs without a configured key", async () => {
		const { pi, registered } = makePi();
		await openmodelProvider(pi);
		const provider = registered[0];

		expect(
			await provider.auth.apiKey?.resolve({
				ctx: {} as never,
				credential: undefined,
				signal: new AbortController().signal,
			} as never),
		).toEqual({ auth: {}, source: "public catalog (no account)" });
	});
});
