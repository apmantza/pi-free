import { describe, expect, it } from "vitest";
import { isXkiroFreeModel, mapXkiroModel } from "../providers/xkiro/xkiro.ts";

describe("Xkiro free model detection", () => {
	it("treats the catalog access_tier as authoritative", () => {
		expect(
			isXkiroFreeModel({
				id: "qwen/qwen3.5-397b-a17b:free",
				access_tier: "free",
			}),
		).toBe(true);
		expect(
			isXkiroFreeModel({
				id: "openai/gpt-6-sol",
				access_tier: "paid",
				pricing: { input: 2, output: 10 },
			}),
		).toBe(false);
		expect(
			isXkiroFreeModel({
				id: "openai/gpt-5.6-sol",
				access_tier: "premium",
			}),
		).toBe(false);
	});

	it("recognizes free labels when the tier is absent", () => {
		expect(
			isXkiroFreeModel({
				id: "deepseek/deepseek-v4.1-flash:free",
				display_name: "DeepSeek V4.1 Flash (Free)",
			}),
		).toBe(true);
	});

	it("uses zero per-million pricing as a fallback", () => {
		expect(
			isXkiroFreeModel({
				id: "cohere/command-r-plus-08-2024",
				pricing: { currency: "USD", unit: "per_1m_tokens", input: 0, output: 0 },
			}),
		).toBe(true);
	});

	it("does not treat missing pricing as free without a tier or label", () => {
		expect(isXkiroFreeModel({ id: "provider/model" })).toBe(false);
	});

	it("maps catalog fields onto the pi model record", () => {
		const model = mapXkiroModel({
			id: "qwen/qwen3.5-397b-a17b:free",
			display_name: "Qwen3.5 397B A17B (Free)",
			modality: "chat",
			access_tier: "free",
			pricing: { currency: "USD", unit: "per_1m_tokens", input: 0, output: 0 },
			capabilities: { vision: true, tools: true, reasoning: true },
			context_length: 262144,
			max_output_tokens: 65536,
		});

		expect(model).toMatchObject({
			id: "qwen/qwen3.5-397b-a17b:free",
			contextWindow: 262144,
			maxTokens: 65536,
			reasoning: true,
			input: ["text", "image"],
			_freeKnown: true,
			_isFree: true,
			_pricingKnown: true,
		});
		expect(model.cost).toMatchObject({
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
		});
	});

	it("converts per-million pricing to per-token costs", () => {
		const model = mapXkiroModel({
			id: "openai/gpt-6-sol",
			access_tier: "paid",
			pricing: {
				currency: "USD",
				unit: "per_1m_tokens",
				input: 2,
				output: 10,
				cache_read: 0.2,
				cache_write: 2.5,
			},
			context_length: 1050000,
			max_output_tokens: 65536,
		});

		expect(model.cost).toMatchObject({
			input: 2 / 1_000_000,
			output: 10 / 1_000_000,
			cacheRead: 0.2 / 1_000_000,
			cacheWrite: 2.5 / 1_000_000,
		});
		expect(model).toMatchObject({ _freeKnown: true, _isFree: false });
	});
});
