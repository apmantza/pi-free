import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchOpenAICompatibleModels } from "../lib/util.ts";

/**
 * Tests for the extended field parsing added to fetchOpenAICompatibleModels.
 * Verifies that per-model context_length, max_completion_tokens, pricing,
 * reasoning, input_modalities, and alternate field names are read from
 * API responses when available.
 */

function mockFetchOk(body: unknown) {
	globalThis.fetch = vi.fn().mockResolvedValue({
		ok: true,
		status: 200,
		json: async () => body,
	} as unknown as Response);
}

describe("fetchOpenAICompatibleModels — extended fields", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	// ── Standard OpenAI format (no extended fields) ────────────
	it("uses defaults when API returns minimal fields", async () => {
		mockFetchOk({
			data: [{ id: "meta/llama-3-70b", object: "model" }],
		});

		const models = await fetchOpenAICompatibleModels(
			"test",
			"https://api.example.com/v1",
			"sk-test",
			{ contextWindow: 64_000, maxTokens: 8_192 },
		);

		expect(models).toHaveLength(1);
		expect(models[0].id).toBe("meta/llama-3-70b");
		expect(models[0].contextWindow).toBe(64_000); // from defaults
		expect(models[0].maxTokens).toBe(8_192); // from defaults
		expect(models[0].cost.input).toBe(0); // default when no pricing
		expect(models[0].input).toEqual(["text"]);
	});

	// ── Per-model context_length ───────────────────────────────
	it("reads per-model context_length from API", async () => {
		mockFetchOk({
			data: [
				{
					id: "deepseek-v3",
					object: "model",
					context_length: 1_000_000,
				},
			],
		});

		const models = await fetchOpenAICompatibleModels(
			"test",
			"https://api.example.com/v1",
			"sk-test",
		);

		expect(models[0].contextWindow).toBe(1_000_000);
	});

	// ── Alternate field name: max_context_length ───────────────
	it("reads max_context_length as fallback field name", async () => {
		mockFetchOk({
			data: [
				{
					id: "test-model",
					max_context_length: 200_000,
				},
			],
		});

		const models = await fetchOpenAICompatibleModels(
			"test",
			"https://api.example.com/v1",
			"sk-test",
		);

		expect(models[0].contextWindow).toBe(200_000);
	});

	// ── Alternate field name: context_window (snake_case) ──────
	it("reads context_window as fallback field name", async () => {
		mockFetchOk({
			data: [
				{
					id: "test-model",
					context_window: 131_072,
				},
			],
		});

		const models = await fetchOpenAICompatibleModels(
			"test",
			"https://api.example.com/v1",
			"sk-test",
		);

		expect(models[0].contextWindow).toBe(131_072);
	});

	// ── Priority: context_length > max_context_length > context_window > default
	it("context_length takes priority over alternates", async () => {
		mockFetchOk({
			data: [
				{
					id: "test-model",
					context_length: 100_000,
					max_context_length: 200_000,
					context_window: 300_000,
				},
			],
		});

		const models = await fetchOpenAICompatibleModels(
			"test",
			"https://api.example.com/v1",
			"sk-test",
			{ contextWindow: 99_999 },
		);

		expect(models[0].contextWindow).toBe(100_000);
	});

	// ── Per-model max_completion_tokens ────────────────────────
	it("reads per-model max_completion_tokens from API", async () => {
		mockFetchOk({
			data: [
				{
					id: "test-model",
					max_completion_tokens: 131_072,
				},
			],
		});

		const models = await fetchOpenAICompatibleModels(
			"test",
			"https://api.example.com/v1",
			"sk-test",
		);

		expect(models[0].maxTokens).toBe(131_072);
	});

	// ── Alternate field name: max_tokens ───────────────────────
	it("reads max_tokens as fallback for max tokens", async () => {
		mockFetchOk({
			data: [
				{
					id: "test-model",
					max_tokens: 65_536,
				},
			],
		});

		const models = await fetchOpenAICompatibleModels(
			"test",
			"https://api.example.com/v1",
			"sk-test",
		);

		expect(models[0].maxTokens).toBe(65_536);
	});

	// ── Per-model pricing ──────────────────────────────────────
	it("reads per-model pricing from API (number)", async () => {
		mockFetchOk({
			data: [
				{
					id: "test-model",
					pricing: { prompt: 0.000003, completion: 0.000015 },
				},
			],
		});

		const models = await fetchOpenAICompatibleModels(
			"test",
			"https://api.example.com/v1",
			"sk-test",
		);

		expect(models[0].cost.input).toBe(0.000003);
		expect(models[0].cost.output).toBe(0.000015);
	});

	it("reads per-model pricing from API (string)", async () => {
		mockFetchOk({
			data: [
				{
					id: "test-model",
					pricing: { prompt: "0.00000450", completion: "0.00000900" },
				},
			],
		});

		const models = await fetchOpenAICompatibleModels(
			"test",
			"https://api.example.com/v1",
			"sk-test",
		);

		expect(models[0].cost.input).toBe(0.0000045);
		expect(models[0].cost.output).toBe(0.000009);
	});

	it("per-model pricing overrides defaults", async () => {
		mockFetchOk({
			data: [
				{
					id: "test-model",
					pricing: { prompt: 1.5, completion: 4.0 },
				},
			],
		});

		const models = await fetchOpenAICompatibleModels(
			"test",
			"https://api.example.com/v1",
			"sk-test",
			{ cost: { input: 0.1, output: 0.2 } },
		);

		expect(models[0].cost.input).toBe(1.5); // API wins over defaults
		expect(models[0].cost.output).toBe(4);
	});

	// ── Per-model reasoning ────────────────────────────────────
	it("reads per-model reasoning flag from API when true", async () => {
		mockFetchOk({
			data: [
				{
					id: "test-model",
					reasoning: true,
				},
			],
		});

		const models = await fetchOpenAICompatibleModels(
			"test",
			"https://api.example.com/v1",
			"sk-test",
		);

		expect(models[0].reasoning).toBe(true);
	});

	it("falls back to name heuristic when reasoning not in API", async () => {
		mockFetchOk({
			data: [{ id: "deepseek-r1" }],
		});

		const models = await fetchOpenAICompatibleModels(
			"test",
			"https://api.example.com/v1",
			"sk-test",
		);

		expect(models[0].reasoning).toBe(true); // "r1" in name
	});

	// ── Per-model input_modalities ─────────────────────────────
	it("detects vision from input_modalities in API", async () => {
		mockFetchOk({
			data: [
				{
					id: "vision-model",
					input_modalities: ["text", "image"],
				},
			],
		});

		const models = await fetchOpenAICompatibleModels(
			"test",
			"https://api.example.com/v1",
			"sk-test",
		);

		expect(models[0].input).toEqual(["text", "image"]);
	});

	it("defaults to text-only when no input_modalities", async () => {
		mockFetchOk({
			data: [{ id: "text-model" }],
		});

		const models = await fetchOpenAICompatibleModels(
			"test",
			"https://api.example.com/v1",
			"sk-test",
		);

		expect(models[0].input).toEqual(["text"]);
	});

	it("respects explicit defaults.input even without vision", async () => {
		mockFetchOk({
			data: [{ id: "text-model" }],
		});

		const models = await fetchOpenAICompatibleModels(
			"test",
			"https://api.example.com/v1",
			"sk-test",
			{ input: ["text", "image"] },
		);

		// Explicit default.input takes priority over no-vision fallback
		expect(models[0].input).toEqual(["text", "image"]);
	});

	// ── Plain array response (Together AI format) ──────────────
	it("handles plain array response (not { data: [...] })", async () => {
		mockFetchOk([{ id: "together/model-1" }, { id: "together/model-2" }]);

		const models = await fetchOpenAICompatibleModels(
			"test",
			"https://api.example.com/v1",
			"sk-test",
		);

		expect(models).toHaveLength(2);
		expect(models[0].id).toBe("together/model-1");
	});

	// ── Empty responses ────────────────────────────────────────
	it("returns empty array when API returns no models", async () => {
		mockFetchOk({ data: [] });

		const models = await fetchOpenAICompatibleModels(
			"test",
			"https://api.example.com/v1",
			"sk-test",
		);

		expect(models).toHaveLength(0);
	});

	// ── Filters out models without IDs ─────────────────────────
	it("filters out entries without an id", async () => {
		mockFetchOk({
			data: [
				{ id: "valid-model" },
				{ object: "model" }, // no id
				{ id: "" }, // empty id
				{ id: "another-valid" },
			],
		});

		const models = await fetchOpenAICompatibleModels(
			"test",
			"https://api.example.com/v1",
			"sk-test",
		);

		expect(models).toHaveLength(2);
	});
});
