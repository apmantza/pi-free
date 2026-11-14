/**
 * GMI provider model-catalog tests, through the real fetcher +
 * createNativeOpenAIProvider refresh. Only HTTP is stubbed.
 *
 * GMI publishes a promotional model twice in `/v1/models`: the priced SKU and
 * a duplicate id with zeroed pricing and `is_free: true`. The rows below
 * follow that shape (the catalog needs a key, so they are not a live
 * capture). Free weeks need no hardcoded window: the promotion ends when GMI
 * stops publishing the `is_free` row.
 */

import { describe, expect, it } from "vitest";
import {
	refreshNativeCatalog,
	useCatalogHttp,
} from "./helpers/native-catalog.ts";

function asGmiEntry(overrides: Record<string, unknown> = {}) {
	return {
		id: "some/model",
		object: "model",
		owned_by: "GMI Cloud",
		context_length: 128_000,
		pricing: {
			prompt: "0.000000300",
			completion: "0.000001200",
			request: "0",
			image: "0",
			input_cache_read: "0",
			input_cache_write: "0",
		},
		discount_to_user: 0,
		...overrides,
	};
}

const PROMO_FREE_ROW = asGmiEntry({
	id: "MiniMaxAI/MiniMax-M3",
	pricing: {
		prompt: "0",
		completion: "0",
		request: "0",
		image: "0",
		input_cache_read: "0",
		input_cache_write: "0",
	},
	is_free: true,
});

let catalog: unknown = { data: [] };
useCatalogHttp("api.gmi-serving.com", () => catalog, ["GMI_API_KEY"]);

async function refreshed() {
	const { gmiProviderOptions } = await import("../providers/gmi/gmi.ts");
	return refreshNativeCatalog(gmiProviderOptions);
}

describe("GMI promotional free SKUs", () => {
	// Recurrence (#690): the priced row and the `is_free` row share one id;
	// both were published, so Pi got two models under one key and the free
	// view (which selects by id) showed the priced copy beside the free one.
	it("publishes one model per id, free when an is_free row exists", async () => {
		catalog = {
			object: "list",
			data: [
				asGmiEntry({ id: "MiniMaxAI/MiniMax-M3" }),
				PROMO_FREE_ROW,
				asGmiEntry({ id: "vendor/paid" }),
			],
		};
		const { all, free, freeView } = await refreshed();
		expect(all.map((m) => m.id).sort()).toEqual([
			"MiniMaxAI/MiniMax-M3",
			"vendor/paid",
		]);
		expect(free.map((m) => m.id)).toEqual(["MiniMaxAI/MiniMax-M3"]);
		expect(freeView).toHaveLength(1);
		expect(freeView[0]).toMatchObject({
			id: "MiniMaxAI/MiniMax-M3",
			cost: { input: 0, output: 0 },
		});
	});

	// The verdict follows the free row wherever GMI lists it.
	it("takes the free row when it is listed first", async () => {
		catalog = {
			data: [PROMO_FREE_ROW, asGmiEntry({ id: "MiniMaxAI/MiniMax-M3" })],
		};
		const { all, free } = await refreshed();
		expect(all).toHaveLength(1);
		expect(free.map((m) => m.id)).toEqual(["MiniMaxAI/MiniMax-M3"]);
	});

	it("keeps the priced model paid once the promotion row is gone", async () => {
		catalog = { data: [asGmiEntry({ id: "MiniMaxAI/MiniMax-M3" })] };
		const { all, free } = await refreshed();
		expect(all.map((m) => m.id)).toEqual(["MiniMaxAI/MiniMax-M3"]);
		expect(free).toEqual([]);
	});

	it("returns an empty catalog when the API fails", async () => {
		catalog = undefined;
		const { fetchGmiModels } = await import("../providers/gmi/gmi-models.ts");
		const original = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response("{}", { status: 500 })) as typeof fetch;
		try {
			expect(await fetchGmiModels("sk-test")).toEqual([]);
		} finally {
			globalThis.fetch = original;
		}
	});
});
