import { describe, expect, it } from "vitest";
import { isFreeModel } from "../lib/registry.ts";
import {
	isAnyApiFreeModel,
	mapAnyApiModel,
} from "../providers/anyapi/anyapi.ts";
import {
	refreshNativeCatalog,
	useCatalogHttp,
} from "./helpers/native-catalog.ts";

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

describe("AnyAPI free view through the real refresh", () => {
	// Rows follow the OpenRouter-style shape this mapper reads; the AnyAPI
	// catalog needs a key, so whether it publishes "" or cache-only prices
	// is unverified (HYPOTHESIS). The shared mapper's rule is the contract.
	const CATALOG = {
		data: [
			{
				id: "vendor/paid",
				name: "Paid",
				pricing: { prompt: "0.000001", completion: "0.000002" },
				tags: ["chat_completions:text"],
			},
			{
				id: "vendor/blank-price",
				name: "Blank Price",
				pricing: { prompt: "", completion: "" },
				tags: ["chat_completions:text"],
			},
			{
				id: "vendor/cache-only",
				name: "Cache Only",
				pricing: { input_cache_read: "0" },
				tags: ["chat_completions:text"],
			},
			{
				id: "vendor/zero",
				name: "Zero",
				pricing: { prompt: "0", completion: "0" },
				tags: ["chat_completions:text"],
			},
		],
	};
	useCatalogHttp("api.anyapi.ai", () => CATALOG, ["ANYAPI_API_KEY"]);

	// Recurrence (#690, defect shape 15): `_pricingKnown` and the zero-price
	// free check read "any price field present", so "" prices
	// (Number("") === 0) and a cache-only row read as a known $0 and joined
	// the free view beside priced siblings. Only numeric prompt and
	// completion prices are known prices, as in the shared mapper.
	it("keeps blank and cache-only prices out of the free view", async () => {
		const { anyapiProviderOptions } =
			await import("../providers/anyapi/anyapi.ts");
		const { all, free } = await refreshNativeCatalog(anyapiProviderOptions);
		expect(all.map((m) => m.id).sort()).toEqual([
			"vendor/blank-price",
			"vendor/cache-only",
			"vendor/paid",
			"vendor/zero",
		]);
		expect(free.map((m) => m.id)).toEqual(["vendor/zero"]);
	});
});
