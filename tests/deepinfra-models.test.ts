/**
 * DeepInfra catalog classification tests.
 *
 * DeepInfra's zero-priced media models (image-gen, video-gen, tts, stt) carry
 * structured capability tags in `metadata.tags`. Observed live: ~60 zero-priced
 * entries are exclusively media models (Seedream, Veo, FLUX, Whisper, TTS...),
 * so tag-based filtering keeps the free view chat-only while substring
 * matching alone let them through.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/model-metadata.ts", () => ({
	safeEnrichModelsWithModelsDev: async <T>(models: T) => models,
}));

import { fetchDeepinfraModels } from "../providers/deepinfra/deepinfra.ts";

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

describe("fetchDeepinfraModels — non-chat filtering", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("drops tagged media models even when they are zero-priced", async () => {
		stubModels([
			{
				id: "ByteDance/Seedream-4",
				metadata: {
					tags: ["image-gen"],
					pricing: { input_tokens: 0, output_tokens: 0 },
				},
			},
			{
				id: "google/veo-3.1",
				metadata: {
					tags: ["video-gen"],
					pricing: { input_tokens: 0, output_tokens: 0 },
				},
			},
			{
				id: "bosonai/HiggsAudioV2.5",
				metadata: {
					tags: ["tts"],
					pricing: { input_tokens: 0, output_tokens: 0 },
				},
			},
			{
				id: "openai/whisper-large-v3",
				metadata: {
					tags: ["stt"],
					pricing: { input_tokens: 0, output_tokens: 0 },
				},
			},
		]);

		const models = await fetchDeepinfraModels("sk-test");
		expect(models).toHaveLength(0);
	});

	it("keeps real chat models", async () => {
		stubModels([
			{
				id: "Qwen/Qwen3.5-9B",
				metadata: {
					context_length: 262_144,
					tags: ["chat", "vlm", "vision", "reasoning_effort"],
					pricing: { input_tokens: 0.1, output_tokens: 0.15 },
				},
			},
		]);

		const models = await fetchDeepinfraModels("sk-test");
		expect(models.map((m) => m.id)).toEqual(["Qwen/Qwen3.5-9B"]);
		expect(models[0]?.cost.input).toBeCloseTo(1e-7);
	});

	it("keeps a zero-priced chat-tagged model (legitimate free chat)", async () => {
		stubModels([
			{
				id: "some/free-chat-model",
				metadata: {
					tags: ["chat"],
					pricing: { input_tokens: 0, output_tokens: 0 },
				},
			},
		]);

		const models = await fetchDeepinfraModels("sk-test");
		expect(models.map((m) => m.id)).toEqual(["some/free-chat-model"]);
		expect(models[0]?.cost.input).toBe(0);
	});

	it("still drops untagged entries via the substring fallback", async () => {
		stubModels([
			{ id: "BAAI/bge-reranker-base" }, // rerank, no metadata
			{
				id: "Qwen/Qwen3.5-9B",
				metadata: {
					tags: ["chat"],
					pricing: { input_tokens: 0.1, output_tokens: 0.15 },
				},
			},
		]);

		const models = await fetchDeepinfraModels("sk-test");
		expect(models.map((m) => m.id)).toEqual(["Qwen/Qwen3.5-9B"]);
	});
});
