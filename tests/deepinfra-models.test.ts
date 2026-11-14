/**
 * DeepInfra catalog classification tests.
 *
 * DeepInfra tags every chat-completions model `chat` in `metadata.tags`;
 * media (image-gen, video-gen, tts, stt) and embedding (`embed`) models carry
 * their own tags. The mapper admits only the chat tag, so zero-priced media
 * models and embeddings with no "embed" in their id stay out of the picker.
 */

import { readFileSync } from "node:fs";
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

	it("drops untagged entries (no chat tag, no admission)", async () => {
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

/**
 * Live rows captured from the public /v1/openai/models endpoint on
 * 2026-11-14 (#676). Recurrence: the media-tag exclusion list had no `embed`
 * entry, so 20 embedding models whose ids lack "embed" (BAAI/bge-m3,
 * intfloat/e5-*, sentence-transformers/*, thenlper/gte-*) reached the chat
 * picker. Only rows tagged `chat` are admitted now.
 */
describe("fetchDeepinfraModels — live catalog rows (#676)", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	const fixture = JSON.parse(
		readFileSync(
			new URL("./fixtures/catalogs/deepinfra-2026-11-14.json", import.meta.url),
			"utf8",
		),
	) as { data: Array<{ id: string; metadata: { tags: string[] } }> };

	it("admits only chat-tagged rows: embeddings and media models are dropped", async () => {
		stubModels(fixture.data);
		const ids = (await fetchDeepinfraModels("")).map((m) => m.id);
		expect(ids).toEqual(["moonshotai/Kimi-K3", "inclusionAI/Ling-3.0-flash"]);
	});

	it("drops embedding rows whose ids do not contain 'embed'", async () => {
		const embeds = fixture.data.filter(
			(m) => m.metadata.tags.includes("embed") && !/embed/i.test(m.id),
		);
		expect(embeds.length).toBeGreaterThan(0);
		stubModels(embeds);
		expect(await fetchDeepinfraModels("")).toEqual([]);
	});
});
