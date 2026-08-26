/**
 * B.AI provider model-mapper tests.
 *
 * B.AI's /v1/models endpoint exposes no pricing (minimal OpenAI-shim
 * `{id, object, created, owned_by}` entries), so classification falls to
 * Route B name-based detection. B.AI's official pricing page documents a
 * trio of models as currently free on the API; those ids must be stamped
 * authoritatively free (`_freeKnown`/`_isFree`) so they classify free via
 * `isFreeModel`, while every other catalog id stays paid.
 */

import { describe, expect, it } from "vitest";

import { isFreeModel } from "../lib/registry.ts";

import {
	BAI_DOCUMENTED_FREE_MODEL_IDS,
	mapBaiModel,
} from "../providers/bai/bai.ts";

const DOCUMENTED_FREE_IDS = [
	"deepseek-v4-flash",
	"deepseek-v4-flash-vision-exp",
	"mimo-v2.5",
] as const;

describe("BAI_DOCUMENTED_FREE_MODEL_IDS", () => {
	it("contains exactly the documented-free trio", () => {
		expect([...BAI_DOCUMENTED_FREE_MODEL_IDS].sort()).toEqual(
			[...DOCUMENTED_FREE_IDS].sort(),
		);
	});
});

describe("mapBaiModel free stamping", () => {
	it("stamps the documented-free ids as authoritatively free", () => {
		for (const id of DOCUMENTED_FREE_IDS) {
			const mapped = mapBaiModel({ id });
			expect(mapped._freeKnown).toBe(true);
			expect(mapped._isFree).toBe(true);
			expect(isFreeModel(mapped)).toBe(true);
		}
	});

	it("keeps the :free-suffix promotion detection working", () => {
		const mapped = mapBaiModel({ id: "some-model:free" });
		expect(mapped._freeKnown).toBe(true);
		expect(mapped._isFree).toBe(true);
		expect(isFreeModel(mapped)).toBe(true);
	});

	it("leaves other models unstamped and paid under Route B", () => {
		for (const id of [
			"claude-opus-4.8",
			"gpt-5.2",
			"deepseek-v4-chat",
			"mimo-v2.0",
		]) {
			const mapped = mapBaiModel({ id });
			expect(mapped._freeKnown).toBe(false);
			expect(mapped._isFree).toBe(false);
			expect(mapped._pricingKnown).toBe(false);
			// Route B: no pricing data, name has no "free" → paid.
			expect(isFreeModel(mapped)).toBe(false);
		}
	});

	it("does not let a paid name collide with a documented-free id prefix", () => {
		// "deepseek-v4-flash-exp-foo" is not in the set even though it shares
		// a prefix with a documented-free id.
		const mapped = mapBaiModel({ id: "deepseek-v4-flash-exp-foo" });
		expect(mapped._freeKnown).toBe(false);
		expect(isFreeModel(mapped)).toBe(false);
	});
});
