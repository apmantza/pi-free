import { describe, expect, it } from "vitest";
import { isFreeModel } from "../lib/registry.ts";
import {
	isAnyApiFreeModel,
	mapAnyApiModel,
} from "../providers/anyapi/anyapi.ts";

describe("AnyAPI free model detection", () => {
	it("recognizes the provider's explicit free flag", () => {
		expect(isAnyApiFreeModel({ id: "provider/model", isFree: true })).toBe(
			true,
		);
		expect(isAnyApiFreeModel({ id: "provider/model", isFree: false })).toBe(
			false,
		);
	});

	it("recognizes free labels in model ids or names", () => {
		expect(
			isAnyApiFreeModel({ id: "provider/model-free", name: "Model" }),
		).toBe(true);
		expect(
			isAnyApiFreeModel({ id: "provider/model", name: "Model (free)" }),
		).toBe(true);
	});

	it("uses zero pricing when the API exposes it", () => {
		expect(
			isAnyApiFreeModel({
				id: "provider/model",
				pricing: { prompt: "0", completion: "0" },
			}),
		).toBe(true);
	});

	it("does not treat missing pricing as free", () => {
		expect(isAnyApiFreeModel({ id: "provider/model" })).toBe(false);
	});

	it("marks mapped free models as authoritative", () => {
		const model = mapAnyApiModel({
			id: "provider/model-free",
			name: "Model (free)",
			context_length: 32_000,
			max_completion_tokens: 4_096,
			tags: ["chat_completions:reasoning", "chat_completions:vision"],
		});

		expect(model).toMatchObject({
			id: "provider/model-free",
			contextWindow: 32_000,
			maxTokens: 4_096,
			_freeKnown: true,
			_isFree: true,
			_pricingKnown: false,
			reasoning: true,
			input: ["text", "image"],
		});
	});

	// Recurrence (#685): routers list prompt/completion "-1" (billed at the
	// routed model's rate). Pre-fix the shared mapper published cost -1; once
	// it zeroes router prices, this mapper's own pricing stamp would turn the
	// row into a known $0 and leak it into the free view.
	it("keeps a router '-1' row paid and pricing-unknown, never negative or $0-known", () => {
		const router = mapAnyApiModel({
			id: "vendor/router",
			name: "Router",
			pricing: { prompt: "-1", completion: "-1" },
		});
		const paid = mapAnyApiModel({
			id: "vendor/paid",
			name: "Paid",
			pricing: { prompt: "0.000001", completion: "0.000002" },
		});

		expect(router.cost).toMatchObject({ input: 0, output: 0 });
		expect(router._pricingKnown).toBe(false);
		expect(isFreeModel({ ...router, provider: "anyapi" }, [router, paid])).toBe(
			false,
		);
	});
});
