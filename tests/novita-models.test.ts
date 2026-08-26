/**
 * Novita catalog classification tests.
 *
 * Novita exposes internal smoke-test models (`ai_infer_test_1..3`) as
 * zero-priced `chat`-typed entries with status 1. Observed live alongside
 * legitimate free chat models (qwen/qwen3.5-plus etc.), so only the test ids
 * must be dropped.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/model-metadata.ts", () => ({
	safeEnrichModelsWithModelsDev: async <T>(models: T) => models,
}));

import { fetchNovitaModels } from "../providers/novita/novita.ts";

function entry(overrides: Record<string, unknown> = {}) {
	return {
		id: "qwen/qwen3.5-plus",
		display_name: "Qwen 3.5 Plus",
		model_type: "chat",
		status: 1,
		input_token_price_per_m: 0,
		output_token_price_per_m: 0,
		context_size: 262_144,
		...overrides,
	};
}

function stubModels(data: unknown[]) {
	vi.stubGlobal(
		"fetch",
		vi.fn(
			async (..._args: unknown[]) =>
				new Response(JSON.stringify({ data }), {
					status: 200,
					statusText: "OK",
				}),
		),
	);
}

describe("fetchNovitaModels — internal test model filtering", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("rejects all internal ai_infer_test_* models", async () => {
		stubModels([
			entry({ id: "ai_infer_test_1", display_name: undefined }),
			entry({ id: "ai_infer_test_2", display_name: undefined }),
			entry({ id: "ai_infer_test_3", display_name: undefined }),
		]);

		const models = await fetchNovitaModels("sk-test");
		expect(models).toHaveLength(0);
	});

	it("keeps legitimate zero-priced chat models", async () => {
		stubModels([entry(), entry({ id: "dev/glm46" })]);

		const models = await fetchNovitaModels("sk-test");
		expect(models.map((m) => m.id)).toEqual([
			"qwen/qwen3.5-plus",
			"dev/glm46",
		]);
		expect(models[0]?.cost.input).toBe(0);
		expect(models[0]?.cost.output).toBe(0);
	});

	it("filters test models out of a mixed live-shaped catalog", async () => {
		stubModels([
			entry(),
			entry({
				id: "ai_infer_test_2",
				display_name: undefined,
			}),
			entry({ id: "minimax/m2-her" }),
			entry({
				id: "some/model",
				status: 0, // not deployed yet
			}),
		]);

		const models = await fetchNovitaModels("sk-test");
		expect(models.map((m) => m.id)).toEqual([
			"qwen/qwen3.5-plus",
			"minimax/m2-her",
		]);
	});
});
