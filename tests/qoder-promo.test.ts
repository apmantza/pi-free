import { describe, expect, it } from "vitest";
import {
	isPromoFreeModel,
	isQoderFreeModel,
	type QoderPromoFree,
} from "../providers/qoder/models.ts";

// Named recurrence: Qoder's Qwen3.8-Flash 0.0x promo (Sep 18-30 2026,
// docs.qoder.com/events/flashoffer) shipped no catalog entry because the
// static list had no time-bound promo slot — free promos were invisible
// until a developer hand-edited the basic/premium split.
describe("Qoder time-bound promo free models", () => {
	const promos: QoderPromoFree[] = [
		{
			id: "q38fmodel",
			promo: "Qwen3.8-Flash 0.0x Sep 2026",
			freeUntil: "2026-10-01T00:00:00+08:00",
		},
	];

	it("is free inside the promo window", () => {
		const during = Date.parse("2026-09-25T12:00:00+08:00");
		expect(isPromoFreeModel("q38fmodel", during, promos)).toBe(true);
		expect(
			isQoderFreeModel(
				{ id: "q38fmodel", name: "Qwen3.8 Flash (Qoder)" } as never,
				during,
				promos,
			),
		).toBe(true);
	});

	it("lapses automatically after expiry with no code change", () => {
		const after = Date.parse("2026-10-02T00:00:00+08:00");
		expect(isPromoFreeModel("q38fmodel", after, promos)).toBe(false);
		expect(
			isQoderFreeModel(
				{ id: "q38fmodel", name: "Qwen3.8 Flash (Qoder)" } as never,
				after,
				promos,
			),
		).toBe(false);
	});

	it("fails closed on unparseable expiry dates", () => {
		const bad: QoderPromoFree[] = [
			{ id: "q38fmodel", promo: "typo", freeUntil: "not-a-date" },
		];
		expect(isPromoFreeModel("q38fmodel", Date.now(), bad)).toBe(false);
	});

	it("leaves non-promo ids and the basic tier untouched", () => {
		const during = Date.parse("2026-09-25T12:00:00+08:00");
		expect(isPromoFreeModel("dmodel", during, promos)).toBe(false);
		expect(
			isQoderFreeModel({ id: "lite", name: "Qoder Lite" } as never, during),
		).toBe(true);
		expect(
			isQoderFreeModel(
				{ id: "dmodel", name: "DeepSeek V4 Pro (Qoder)" } as never,
				during,
			),
		).toBe(false);
	});
});
