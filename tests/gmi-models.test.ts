/**
 * GMI provider model-catalog tests.
 *
 * Covers the catalog's pass-through behavior. GMI publishes priced +
 * promotional SKUs side-by-side; both are expected to survive `fetchGmiModels`
 * (no dedupe), and the promotional `is_free: true` row must surface as a
 * distinct free entry. Previously, GMI's free weeks required a hardcoded
 * PROMOTIONS window and a by-id dedupe; both were removed when
 * `fetchOpenAICompatibleModels` grew native `is_free` handling.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";

import { fetchGmiModels } from "../providers/gmi/gmi-models.ts";

function mockFetchOk(body: unknown) {
	globalThis.fetch = vi.fn().mockResolvedValue({
		ok: true,
		status: 200,
		json: async () => body,
	} as unknown as Response);
}

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

describe("fetchGmiModels — promotional free SKUs", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("keeps both the priced and the promotional is_free rows (no dedupe)", async () => {
		mockFetchOk({
			object: "list",
			data: [
				asGmiEntry({ id: "MiniMaxAI/MiniMax-M3" }),
				asGmiEntry({
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
				}),
			],
		});

		const models = (await fetchGmiModels("sk-test")) as Array<
			ProviderModelConfig & { _freeKnown?: boolean; _isFree?: boolean }
		>;

		expect(models).toHaveLength(2);

		const priced = models.find((m) => (m.cost?.input ?? 0) > 0);
		const promo = models.find((m) => (m.cost?.input ?? 0) === 0);

		expect(priced).toBeDefined();
		expect(priced?._freeKnown).toBeUndefined();

		expect(promo).toBeDefined();
		expect(promo?._freeKnown).toBe(true);
		expect(promo?._isFree).toBe(true);
	});

	it("returns an empty catalog when the API fails", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 500,
			json: async () => ({}),
		} as unknown as Response);

		const models = await fetchGmiModels("sk-test");
		expect(models).toEqual([]);
	});
});
