import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/model-metadata.ts", () => ({
	safeEnrichModelsWithModelsDev: async <T>(models: T) => models,
}));

import { fetchOpenRouterCompatibleModels } from "../providers/model-fetcher.ts";

describe("fetchOpenRouterCompatibleModels", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	function stubModels(data: unknown[]) {
		const fetchMock = vi.fn(
			async (..._args: unknown[]) =>
				new Response(JSON.stringify({ data }), {
					status: 200,
					statusText: "OK",
				}),
		);
		vi.stubGlobal("fetch", fetchMock);
		return fetchMock;
	}

	it("filters models that cannot produce text output", async () => {
		stubModels([
			{
				id: "text-only",
				name: "Text Only",
				context_length: 128000,
				architecture: { output_modalities: ["text"] },
			},
			{
				id: "image-only",
				name: "Image Only",
				context_length: 128000,
				architecture: { output_modalities: ["image"] },
			},
			{
				id: "text-and-image",
				name: "Text And Image",
				context_length: 128000,
				architecture: { output_modalities: ["text", "image"] },
			},
			{
				id: "unknown-output",
				name: "Unknown Output",
				context_length: 128000,
			},
		]);

		const models = await fetchOpenRouterCompatibleModels({
			baseUrl: "https://example.test/api/gateway",
		});

		expect(models.map((m) => m.id)).toEqual([
			"text-only",
			"text-and-image",
			"unknown-output",
		]);
	});

	it("keeps text+image hybrids unless excludeOutputModalities is set", async () => {
		const data = [
			{
				id: "text-only",
				name: "Text Only",
				context_length: 128000,
				architecture: { output_modalities: ["text"] },
			},
			{
				id: "image-hybrid",
				name: "Image Hybrid",
				context_length: 128000,
				architecture: { output_modalities: ["image", "text"] },
			},
			{
				id: "audio-gen",
				name: "Audio Gen",
				context_length: 128000,
				architecture: { output_modalities: ["audio"] },
			},
		];

		// Default: hybrids stay (existing behavior for kilo/built-in openrouter).
		stubModels(data);
		const permissive = await fetchOpenRouterCompatibleModels({
			baseUrl: "https://example.test/api/gateway",
		});
		expect(permissive.map((m) => m.id)).toEqual(["text-only", "image-hybrid"]);

		// Strict: any listed output modality drops the model, even with text.
		stubModels(data);
		const strict = await fetchOpenRouterCompatibleModels({
			baseUrl: "https://example.test/api/gateway",
			excludeOutputModalities: ["image", "audio", "video", "speech"],
		});
		expect(strict.map((m) => m.id)).toEqual(["text-only"]);
	});

	it("omits the Authorization header for anonymous catalog fetches (#421)", async () => {
		const fetchMock = stubModels([
			{
				id: "public-model",
				name: "Public Model",
				context_length: 128000,
				architecture: { output_modalities: ["text"] },
			},
		]);

		await fetchOpenRouterCompatibleModels({
			baseUrl: "https://example.test/api/gateway",
			apiKey: undefined,
		});
		await fetchOpenRouterCompatibleModels({
			baseUrl: "https://example.test/api/gateway",
			apiKey: "",
		});

		for (const call of fetchMock.mock.calls) {
			const headers = (call[1] as unknown as { headers: Record<string, string> })
				.headers;
			expect(headers).not.toHaveProperty("Authorization");
		}
	});

	it("sends the Authorization header when a key is configured", async () => {
		const fetchMock = stubModels([]);

		await fetchOpenRouterCompatibleModels({
			baseUrl: "https://example.test/api/gateway",
			apiKey: "sk-test",
		});

		const headers = (
			fetchMock.mock.calls[0][1] as unknown as {
				headers: Record<string, string>;
			}
		).headers;
		expect(headers.Authorization).toBe("Bearer sk-test");
	});

	it("maps Kilo/OpenRouter model metadata from provider catalogs", async () => {
		stubModels([
			{
				id: "reasoning-model",
				name: "Provider : Reasoning Model",
				top_provider: {
					context_length: 256000,
					max_completion_tokens: 32768,
				},
				pricing: {
					prompt: "0.000001",
					completion: "0.000002",
					input_cache_read: "0.0000001",
					input_cache_write: "0.0000003",
				},
				supported_parameters: ["tools", "reasoning"],
			},
		]);

		const [model] = await fetchOpenRouterCompatibleModels({
			baseUrl: "https://example.test/api/gateway",
		});

		expect(model).toMatchObject({
			id: "reasoning-model",
			name: "Reasoning Model",
			reasoning: true,
			thinkingLevelMap: { off: "none" },
			cost: {
				input: 0.000001,
				output: 0.000002,
				cacheRead: 0.0000001,
				cacheWrite: 0.0000003,
			},
			contextWindow: 256000,
			maxTokens: 32768,
		});
	});
});
