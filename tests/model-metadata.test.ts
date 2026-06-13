import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	clearModelsDevMetaCache,
	enrichModelsWithModelsDev,
	fetchModelsDevMeta,
} from "../lib/model-metadata.ts";

const baseModel: ProviderModelConfig = {
	id: "opaque/model-id",
	name: "Opaque Model",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 128_000,
	maxTokens: 16_384,
};

function mockModelsDev(catalog: unknown) {
	vi.spyOn(globalThis, "fetch").mockResolvedValue({
		ok: true,
		json: async () => catalog,
	} as Response);
}

describe("models.dev metadata enrichment", () => {
	afterEach(() => {
		clearModelsDevMetaCache();
		vi.restoreAllMocks();
	});

	it("enriches fallback limits, modalities, reasoning, thinking map, compat, and CI hints", async () => {
		mockModelsDev({
			deepinfra: {
				id: "deepinfra",
				models: {
					"opaque/model-id": {
						id: "moonshotai/Kimi-K2.6",
						name: "Kimi K2.6",
						family: "kimi-k2",
						provider: "moonshotai",
						reasoning: true,
						reasoning_options: [
							{ type: "effort", values: ["low", "medium", "high"] },
						],
						modalities: { input: ["text", "image"], output: ["text"] },
						limit: { context: 262_144, output: 32_768 },
						cost: { input: 1, output: 3, cache_read: 0.2, cache_write: 1 },
					},
				},
			},
		});

		const [model] = await enrichModelsWithModelsDev([baseModel], {
			providerId: "deepinfra",
		});

		expect(model.contextWindow).toBe(262_144);
		expect(model.maxTokens).toBe(32_768);
		expect(model.input).toEqual(["text", "image"]);
		expect(model.reasoning).toBe(true);
		expect(model.thinkingLevelMap).toEqual({
			off: null,
			minimal: null,
			low: "low",
			medium: "medium",
			high: "high",
			xhigh: null,
		});
		expect(model.compat).toEqual({
			supportsStore: false,
			supportsDeveloperRole: false,
			supportsReasoningEffort: true,
			requiresReasoningContentOnAssistantMessages: true,
		});
		expect(model.modelsDev).toEqual({
			id: "moonshotai/Kimi-K2.6",
			name: "Kimi K2.6",
			family: "kimi-k2",
			provider: "moonshotai",
		});
		// Cost is intentionally not trusted by default for gateway providers.
		expect(model.cost).toEqual(baseModel.cost);
	});

	it("preserves explicit provider values and compat keys", async () => {
		mockModelsDev({
			openrouter: {
				id: "openrouter",
				models: {
					"opaque/model-id": {
						id: "deepseek/deepseek-v3.2",
						name: "DeepSeek V3.2",
						family: "deepseek-v3",
						reasoning: true,
						modalities: { input: ["text", "image"], output: ["text"] },
						limit: { context: 262_144, output: 32_768 },
					},
				},
			},
		});
		const explicit: ProviderModelConfig = {
			...baseModel,
			input: ["text", "image"],
			contextWindow: 131_072,
			maxTokens: 8_192,
			compat: { supportsDeveloperRole: true },
		};

		const [model] = await enrichModelsWithModelsDev([explicit], {
			providerId: "openrouter",
		});

		expect(model.contextWindow).toBe(131_072);
		expect(model.maxTokens).toBe(8_192);
		expect(model.input).toEqual(["text", "image"]);
		expect(model.compat).toEqual({
			supportsStore: false,
			supportsDeveloperRole: true,
			supportsReasoningEffort: true,
			requiresReasoningContentOnAssistantMessages: true,
			thinkingFormat: "deepseek",
		});
	});

	it("can enrich fallback costs when explicitly enabled", async () => {
		mockModelsDev({
			openrouter: {
				id: "openrouter",
				models: {
					"opaque/model-id": {
						id: "opaque/model-id",
						name: "Opaque Model",
						reasoning: false,
						limit: { context: 128_000, output: 16_384 },
						cost: { input: 2, output: 8, cache_read: 0.5, cache_write: 1 },
					},
				},
			},
		});

		const [model] = await enrichModelsWithModelsDev([baseModel], {
			providerId: "openrouter",
			enrichCost: "fallback-only",
		});

		expect(model.cost).toEqual({
			input: 0.000002,
			output: 0.000008,
			cacheRead: 0.0000005,
			cacheWrite: 0.000001,
		});
	});

	it("uses provider aliases, provider id fields, and falls back to the full catalog", async () => {
		mockModelsDev({
			"non-canonical-key": {
				id: "togetherai",
				models: {
					"Qwen/Qwen3.6-Plus": {
						id: "Qwen/Qwen3.6-Plus",
						name: "Qwen3.6 Plus",
						reasoning: true,
						limit: { context: 131_072, output: 16_384 },
					},
				},
			},
		});

		expect(
			(await fetchModelsDevMeta("together"))["Qwen/Qwen3.6-Plus"],
		).toBeDefined();
		const [model] = await enrichModelsWithModelsDev(
			[{ ...baseModel, id: "Qwen/Qwen3.6-Plus" }],
			{ providerId: "gateway-not-in-catalog" },
		);
		expect(model.contextWindow).toBe(131_072);
	});

	it("reuses one models.dev catalog fetch across provider lookups", async () => {
		mockModelsDev({
			togetherai: {
				id: "togetherai",
				models: {
					"Qwen/Qwen3.6-Plus": {
						id: "Qwen/Qwen3.6-Plus",
						name: "Qwen3.6 Plus",
						reasoning: true,
						limit: { context: 131_072, output: 16_384 },
					},
				},
			},
			novita: {
				id: "novita-ai",
				models: {
					"moonshotai/Kimi-K2.6": {
						id: "moonshotai/Kimi-K2.6",
						name: "Kimi K2.6",
						reasoning: true,
						limit: { context: 131_072, output: 16_384 },
					},
				},
			},
		});

		expect(
			(await fetchModelsDevMeta("together"))["Qwen/Qwen3.6-Plus"],
		).toBeDefined();
		expect(
			(await fetchModelsDevMeta("novita"))["moonshotai/Kimi-K2.6"],
		).toBeDefined();
		expect(globalThis.fetch).toHaveBeenCalledTimes(1);
	});

	it("fails open when metadata cannot be fetched", async () => {
		vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));

		await expect(enrichModelsWithModelsDev([baseModel])).resolves.toEqual([
			baseModel,
		]);
	});
});
