/**
 * Requesty provider tests.
 *
 * Covers the catalog mapper (schema-specific flat pricing, capability flags,
 * non-chat filtering) and the public-catalog fetch path with an optional key.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { mapRequestyModel } from "../providers/requesty/requesty-models.ts";
import { isFreeModel } from "../lib/registry.ts";

function catalogEntry(overrides: Record<string, unknown> = {}) {
	return {
		id: "nvidia/nemotron-3-super-120b-a12b",
		api: "chat",
		input_price: 0,
		output_price: 0,
		cached_price: 0,
		caching_price: 0,
		context_window: 131072,
		max_output_tokens: 65536,
		supports_reasoning: true,
		supports_tool_calling: true,
		supports_vision: false,
		...overrides,
	};
}

describe("mapRequestyModel", () => {
	it("maps a free chat model with inline zero pricing", () => {
		const model = mapRequestyModel(catalogEntry());
		expect(model).toBeDefined();
		expect(model?.id).toBe("nvidia/nemotron-3-super-120b-a12b");
		expect(model?.cost.input).toBe(0);
		expect(model?.cost.output).toBe(0);
		expect(model?.reasoning).toBe(true);
		expect(model?.contextWindow).toBe(131072);
		expect(model?.maxTokens).toBe(65536);
	});

	it("maps paid pricing and vision support", () => {
		const model = mapRequestyModel(
			catalogEntry({
				id: "google/gemini-3.1-flash-image",
				input_price: 4.5e-7,
				output_price: 1.8e-6,
				cached_price: 1e-8,
				caching_price: 2e-8,
				supports_vision: true,
				supports_reasoning: false,
			}),
		);
		expect(model?.cost).toEqual({
			input: 0.45,
			output: 1.8,
			cacheRead: 0.01,
			cacheWrite: 0.02,
		});
		expect(model?.input).toEqual(["text", "image"]);
		expect(model?.reasoning).toBe(false);
	});

	it("falls back when context_window is missing", () => {
		const model = mapRequestyModel(catalogEntry({ context_window: undefined }));
		expect(model?.contextWindow).toBeGreaterThan(0);
	});

	it("filters out non-chat api entries", () => {
		expect(mapRequestyModel(catalogEntry({ api: "image" }))).toBeUndefined();
	});

	it("filters out NVIDIA content-safety classifiers", () => {
		expect(
			mapRequestyModel(
				catalogEntry({ id: "nvidia/nemotron-3.5-content-safety" }),
			),
		).toBeUndefined();
	});

	it("filters out entries without an id", () => {
		expect(mapRequestyModel(catalogEntry({ id: undefined }))).toBeUndefined();
	});

	it("stamps _pricingKnown only when both standard prices parse (#610)", () => {
		expect(
			(mapRequestyModel(catalogEntry()) as { _pricingKnown?: boolean })
				._pricingKnown,
		).toBe(true);
		expect(
			(
				mapRequestyModel(catalogEntry({ input_price: undefined })) as {
					_pricingKnown?: boolean;
				}
			)._pricingKnown,
		).toBe(false);
		expect(
			(
				mapRequestyModel(
					catalogEntry({ input_price: "0", output_price: null }),
				) as { _pricingKnown?: boolean }
			)._pricingKnown,
		).toBe(false);
	});

	it("a priceless paid-named entry is not free beside priced siblings (#610)", () => {
		const priced = mapRequestyModel(
			catalogEntry({ id: "paid-workhorse", input_price: 2, output_price: 3 }),
		)!;
		const priceless = mapRequestyModel(
			catalogEntry({
				id: "mystery-model",
				input_price: undefined,
				output_price: undefined,
			}),
		)!;
		const all = [priced, priceless] as Parameters<typeof isFreeModel>[0][];
		// Pre-fix the priceless entry defaulted to cost 0/0 with no marker
		// and Route A classified it free: paid models leaked into the free
		// view whenever any sibling exposed pricing.
		expect(isFreeModel({ ...priceless, provider: "requesty" }, all)).toBe(
			false,
		);
		expect(isFreeModel({ ...priced, provider: "requesty" }, all)).toBe(false);
	});

	it("a priceless free-named entry stays free via name-only fallback", () => {
		const priced = mapRequestyModel(
			catalogEntry({ id: "paid-workhorse", input_price: 2, output_price: 3 }),
		)!;
		const pricelessFree = mapRequestyModel(
			catalogEntry({
				id: "mystery-free",
				input_price: undefined,
				output_price: undefined,
			}),
		)!;
		const all = [priced, pricelessFree] as Parameters<typeof isFreeModel>[0][];
		expect(isFreeModel({ ...pricelessFree, provider: "requesty" }, all)).toBe(
			true,
		);
	});

	it("drops image-generation models despite the chat api (#608)", () => {
		// Live shape (router.requesty.ai, 2026-10-15): 23 image models are
		// served with api "chat", so the api filter alone keeps them.
		const model = mapRequestyModel(
			catalogEntry({
				id: "google/gemini-3.1-flash-image",
				supports_image_generation: true,
			}),
		);
		// Pre-fix this maps to a chat model and registers as an agent model.
		expect(model).toBeUndefined();
	});

	it("keeps vision-understanding chat models without the generation flag", () => {
		const model = mapRequestyModel(
			catalogEntry({
				id: "meta-llama/Llama-3.2-90B-Vision-Instruct",
				supports_image_generation: false,
			}),
		);
		expect(model?.id).toBe("meta-llama/Llama-3.2-90B-Vision-Instruct");
	});
});

describe("fetchRequestyModels", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("fetches the public catalog without a key and maps chat models", async () => {
		const { fetchRequestyModels } =
			await import("../providers/requesty/requesty-models.ts");
		const fetchMock = vi.fn(async () => ({
			ok: true,
			json: async () => ({
				data: [
					catalogEntry(),
					catalogEntry({ api: "image", id: "x/image" }),
					catalogEntry({ id: "nvidia/nemotron-3.5-content-safety" }),
				],
			}),
		}));
		vi.stubGlobal("fetch", fetchMock);

		const models = await fetchRequestyModels("");
		expect(models).toHaveLength(1);
		expect(models[0]!.id).toBe("nvidia/nemotron-3-super-120b-a12b");
		const [url, init] = fetchMock.mock.calls[0] as unknown as [
			string,
			RequestInit,
		];
		expect(url).toBe("https://router.requesty.ai/v1/models");
		expect(
			(init.headers as Record<string, string>).Authorization,
		).toBeUndefined();
	});

	it("sends the bearer header when a key is configured", async () => {
		const { fetchRequestyModels } =
			await import("../providers/requesty/requesty-models.ts");
		const fetchMock = vi.fn(async () => ({
			ok: true,
			json: async () => ({ data: [] }),
		}));
		vi.stubGlobal("fetch", fetchMock);

		await fetchRequestyModels("test-key");
		const [, init] = fetchMock.mock.calls[0] as unknown as [
			string,
			RequestInit,
		];
		expect((init.headers as Record<string, string>).Authorization).toBe(
			"Bearer test-key",
		);
	});
});
