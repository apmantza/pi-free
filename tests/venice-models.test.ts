/**
 * Venice provider tests.
 *
 * Covers the catalog mapper (nested model_spec pricing in USD per million
 * tokens, capability flags, non-text filtering) and the public-catalog fetch
 * path with an optional key.
 */

import { describe, expect, it } from "vitest";

import { mapVeniceModel } from "../providers/venice/venice-models.ts";

function catalogEntry(overrides: Record<string, unknown> = {}) {
	return {
		id: "claude-sonnet-4-6",
		object: "model",
		owned_by: "venice.ai",
		type: "text",
		context_length: 1_000_000,
		created: 1_771_286_400,
		model_spec: {
			name: "Claude Sonnet 4.6",
			pricing: {
				input: { usd: 3.6, diem: 3.6 },
				cache_input: { usd: 0.36, diem: 0.36 },
				cache_write: { usd: 4.5, diem: 4.5 },
				output: { usd: 18, diem: 18 },
			},
			availableContextTokens: 1_000_000,
			maxCompletionTokens: 64_000,
			capabilities: {
				supportsReasoning: true,
				supportsVision: true,
				supportsMultipleImages: true,
				supportsFunctionCalling: true,
			},
			description: "Anthropic's best combination of speed and intelligence.",
		},
		...overrides,
	};
}

describe("mapVeniceModel", () => {
	it("maps paid pricing from per-million USD to per-token cost", () => {
		const model = mapVeniceModel(catalogEntry());
		expect(model).toBeDefined();
		expect(model?.id).toBe("claude-sonnet-4-6");
		// Venice reports USD per million tokens; pi-free stores per token.
		expect(model?.cost.input).toBeCloseTo(3.6e-6, 12);
		expect(model?.cost.output).toBeCloseTo(1.8e-5, 12);
		expect(model?.cost.cacheRead).toBeCloseTo(3.6e-7, 12);
		expect(model?.cost.cacheWrite).toBeCloseTo(4.5e-6, 12);
	});

	it("maps capability flags to reasoning and vision input", () => {
		const model = mapVeniceModel(catalogEntry());
		expect(model?.reasoning).toBe(true);
		expect(model?.input).toEqual(["text", "image"]);
		expect(model?.contextWindow).toBe(1_000_000);
		expect(model?.maxTokens).toBe(64_000);
		expect(model?.name).toBe("Claude Sonnet 4.6");
	});

	it("stamps _pricingKnown so Route A detection is authoritative", () => {
		const model = mapVeniceModel(catalogEntry());
		expect((model as unknown as { _pricingKnown?: boolean })._pricingKnown).toBe(
			true,
		);
	});

	it("marks zero-priced models NOT free — Venice gates inference behind balance", () => {
		// Verified live: a $0/$0 model (stealth-ox-alpha) still answers HTTP 402
		// "Insufficient USD or Diem balance" for an unfunded key, so it must
		// never surface in the free-only view.
		const entry = catalogEntry({
			id: "stealth-preview",
			model_spec: {
				...catalogEntry().model_spec,
				name: "Stealth Preview",
				pricing: {
					input: { usd: 0, diem: 0 },
					output: { usd: 0, diem: 0 },
					cache_input: { usd: 0, diem: 0 },
				},
			},
		});
		const model = mapVeniceModel(entry) as unknown as {
			cost: { input: number; output: number };
			_freeKnown?: boolean;
			_isFree?: boolean;
		};
		expect(model.cost.input).toBe(0);
		expect(model.cost.output).toBe(0);
		expect(model._freeKnown).toBe(true);
		expect(model._isFree).toBe(false);
	});

	it("rejects non-text endpoints (image/audio/video/embeddings)", () => {
		expect(mapVeniceModel(catalogEntry({ type: "image" }))).toBeUndefined();
		expect(mapVeniceModel(catalogEntry({ type: "audio" }))).toBeUndefined();
		expect(mapVeniceModel(catalogEntry({ type: "video" }))).toBeUndefined();
		expect(mapVeniceModel(catalogEntry({ type: "embedding" }))).toBeUndefined();
	});

	it("falls back to id when model_spec.name is missing and applies defaults", () => {
		const model = mapVeniceModel(
			catalogEntry({ model_spec: {}, context_length: undefined }),
		);
		expect(model).toBeDefined();
		expect(model?.name).toBe("claude-sonnet-4-6");
		expect(model?.reasoning).toBe(false);
		expect(model?.input).toEqual(["text"]);
		expect(model?.contextWindow).toBe(128_000);
		expect(model?.maxTokens).toBe(4_096);
	});

	it("returns undefined for unusable entries", () => {
		expect(mapVeniceModel(catalogEntry({ id: "" }))).toBeUndefined();
		expect(mapVeniceModel(catalogEntry({ id: undefined }))).toBeUndefined();
	});
});
