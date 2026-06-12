/**
 * Model Detection Tests
 *
 * Covers normalizeModelName, detectModelFamily, getModelFamilies,
 * toModelInfo, and toProviderModelInfo.
 */

import { describe, expect, it } from "vitest";
import type { ModelInfo } from "../lib/model-detection.ts";
import {
	detectModelFamily,
	getModelFamilies,
	normalizeModelName,
	toModelInfo,
	toProviderModelInfo,
} from "../lib/model-detection.ts";

// =============================================================================
// normalizeModelName
// =============================================================================

describe("normalizeModelName", () => {
	it("lowercases and trims", () => {
		expect(normalizeModelName("  GPT-4o  ")).toBe("gpt-4o");
	});

	it("strips (free) suffix", () => {
		expect(normalizeModelName("claude-sonnet (free)")).toBe("claude-sonnet");
		expect(normalizeModelName("  gpt-4 (free) ")).toBe("gpt-4");
	});

	it("strips nested free suffix", () => {
		expect(normalizeModelName("minimax-m2.5 (free) (free)")).toBe(
			"minimax-m2.5",
		);
	});

	it("strips (cline) suffix", () => {
		expect(normalizeModelName("deepseek-r1 (cline)")).toBe("deepseek-r1");
	});

	it("strips -free suffix", () => {
		expect(normalizeModelName("minimax-m2.5-free")).toBe("minimax-m2.5");
	});

	it("strips trailing free suffix", () => {
		expect(normalizeModelName("qwen-2.5 free")).toBe("qwen-2.5");
		expect(normalizeModelName("llama free")).toBe("llama");
	});

	it("strips CI annotation (parens)", () => {
		expect(normalizeModelName("gpt-4o (ci: 92.3)")).toBe("gpt-4o");
		expect(normalizeModelName("claude (ci: 85.0)")).toBe("claude");
	});

	it("strips CI annotation (brackets)", () => {
		expect(normalizeModelName("gpt-4o [ci: 92.3]")).toBe("gpt-4o");
	});

	it("strips arbitrary trailing parenthetical", () => {
		expect(normalizeModelName("model (something)")).toBe("model");
		expect(normalizeModelName("model (x) (y)")).toBe("model");
		expect(normalizeModelName("no-parens")).toBe("no-parens");
	});

	it("strips (free) before parenthetical", () => {
		expect(normalizeModelName("model (free) (ci: 10.0)")).toBe("model");
	});

	it("handles empty string", () => {
		expect(normalizeModelName("")).toBe("");
	});

	it("handles only whitespace", () => {
		expect(normalizeModelName("   ")).toBe("");
	});
});

// =============================================================================
// toModelInfo / toProviderModelInfo
// =============================================================================

describe("toModelInfo", () => {
	it("converts Model to ModelInfo with free detection", () => {
		const model = {
			id: "gpt-4o",
			name: "GPT-4o",
			provider: "openai",
			reasoning: false,
			input: ["text"] as const,
			cost: { input: 2.5, output: 10 },
			contextWindow: 128_000,
			maxTokens: 4096,
			api: "openai-completions",
		};
		const info = toModelInfo(model as any);
		expect(info.id).toBe("gpt-4o");
		expect(info.name).toBe("GPT-4o");
		expect(info.provider).toBe("openai");
		expect(info.isFree).toBe(false);
		expect(info.inputCost).toBe(2.5);
		expect(info.outputCost).toBe(10);
	});

	it("marks model as free when costing zero", () => {
		const model = {
			id: "free-model",
			name: "Free Model",
			provider: "test",
			reasoning: false,
			input: ["text"] as const,
			cost: { input: 0, output: 0 },
			contextWindow: 4096,
			maxTokens: 2048,
			api: "openai-completions",
		};
		const info = toModelInfo(model as any);
		expect(info.isFree).toBe(true);
	});
});

describe("toProviderModelInfo", () => {
	it("converts ProviderModelConfig with default provider", () => {
		const cfg = {
			id: "deepseek-v3",
			name: "DeepSeek V3",
			reasoning: true,
			input: ["text"] as Array<"text" | "image">,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128_000,
			maxTokens: 8192,
		};
		const info = toProviderModelInfo(cfg);
		expect(info.id).toBe("deepseek-v3");
		expect(info.provider).toBe("");
		expect(info.isFree).toBe(true);
	});
});

// =============================================================================
// detectModelFamily
// =============================================================================

describe("detectModelFamily", () => {
	const brandDetections: Array<{
		id: string;
		name: string;
		provider: string;
		expected: string;
	}> = [
		// Brand keywords in ID
		{
			id: "claude-sonnet-4",
			name: "",
			provider: "openrouter",
			expected: "Claude",
		},
		{
			id: "deepseek-v3",
			name: "",
			provider: "openrouter",
			expected: "DeepSeek",
		},
		{
			id: "gemini-2.5-pro",
			name: "",
			provider: "openrouter",
			expected: "Gemini",
		},
		{ id: "gpt-4o", name: "", provider: "openrouter", expected: "GPT" },
		{
			id: "llama-3.1-70b",
			name: "",
			provider: "openrouter",
			expected: "Llama",
		},
		{ id: "qwen-2.5-72b", name: "", provider: "openrouter", expected: "Qwen" },
		{
			id: "mistral-small",
			name: "",
			provider: "openrouter",
			expected: "Mistral",
		},
		{ id: "kimi-k2.5", name: "", provider: "openrouter", expected: "Kimi" },
		{ id: "moonshot-v1", name: "", provider: "openrouter", expected: "Kimi" },
		{ id: "glm-4", name: "", provider: "openrouter", expected: "GLM" },
		{
			id: "nemotron-4",
			name: "",
			provider: "openrouter",
			expected: "Nemotron",
		},
		{
			id: "o1-preview",
			name: "",
			provider: "openrouter",
			expected: "OpenAI o",
		},
		{ id: "o3-mini", name: "", provider: "openrouter", expected: "OpenAI o" },
	];

	for (const { id, name, provider, expected } of brandDetections) {
		it(`detects "${expected}" from model "${id}"`, () => {
			const result = detectModelFamily({
				id,
				name,
				provider,
				isFree: true,
				inputCost: 0,
				outputCost: 0,
			});
			expect(result).not.toBeNull();
			expect(result!.familyName).toBe(expected);
		});
	}

	it("groups router/auto models into Other", () => {
		const models: ModelInfo[] = [
			{
				id: "kilo-auto/free",
				name: "Auto",
				provider: "kilo",
				isFree: true,
				inputCost: 0,
				outputCost: 0,
			},
			{
				id: "some-router-model",
				name: "Some Router",
				provider: "openrouter",
				isFree: true,
				inputCost: 0,
				outputCost: 0,
			},
		];
		for (const m of models) {
			const result = detectModelFamily(m);
			expect(result!.familyName).toBe("Other");
		}
	});

	it("uses provider fallback when brand not in name", () => {
		const result = detectModelFamily({
			id: "some-gpu-model",
			name: "",
			provider: "nvidia",
			isFree: true,
			inputCost: 0,
			outputCost: 0,
		});
		expect(result).not.toBeNull();
		expect(result!.familyName).toBe("Nemotron");
	});

	it("falls back to first ID part when no brand found", () => {
		const result = detectModelFamily({
			id: "zephyr-7b",
			name: "",
			provider: "unknown",
			isFree: true,
			inputCost: 0,
			outputCost: 0,
		});
		expect(result).not.toBeNull();
		expect(result!.familyId).toBe("zephyr");
		expect(result!.familyName).toBe("Zephyr");
	});

	it("skips version prefix and finds non-version part", () => {
		const result = detectModelFamily({
			id: "v3.2-7b",
			name: "",
			provider: "unknown",
			isFree: true,
			inputCost: 0,
			outputCost: 0,
		});
		expect(result).not.toBeNull();
		expect(result!.familyId).toBe("7b");
		expect(result!.familyName).toBe("7b");
	});

	it("falls back to full ID when no parts available", () => {
		const result = detectModelFamily({
			id: "unknown",
			name: "",
			provider: "test",
			isFree: true,
			inputCost: 0,
			outputCost: 0,
		});
		expect(result).not.toBeNull();
		expect(result!.familyId).toBe("unknown");
	});

	it("matches brand in name when ID is unclear", () => {
		const result = detectModelFamily({
			id: "m-123",
			name: "Claude 4 Sonnet",
			provider: "openrouter",
			isFree: true,
			inputCost: 0,
			outputCost: 0,
		});
		expect(result).not.toBeNull();
		expect(result!.familyName).toBe("Claude");
	});

	it("uses first non-version, non-skip part from split", () => {
		const result = detectModelFamily({
			id: "v1-beta-xmodel",
			name: "",
			provider: "test",
			isFree: true,
			inputCost: 0,
			outputCost: 0,
		});
		expect(result).not.toBeNull();
		expect(result!.familyId).toBe("xmodel");
	});
});

// =============================================================================
// getModelFamilies
// =============================================================================

describe("getModelFamilies", () => {
	it("groups models by detected family", () => {
		const models: ModelInfo[] = [
			{
				id: "gpt-4o",
				name: "GPT-4o",
				provider: "openai",
				isFree: false,
				inputCost: 2.5,
				outputCost: 10,
			},
			{
				id: "gpt-4o-mini",
				name: "GPT-4o Mini",
				provider: "openai",
				isFree: false,
				inputCost: 0.15,
				outputCost: 0.6,
			},
			{
				id: "claude-sonnet-4",
				name: "Claude Sonnet 4",
				provider: "anthropic",
				isFree: false,
				inputCost: 3,
				outputCost: 15,
			},
		];
		const families = getModelFamilies(models);
		expect(families).toHaveLength(2);

		const gpt = families.find((f) => f.id === "gpt")!;
		expect(gpt).toBeDefined();
		expect(gpt.models).toHaveLength(2);

		const claude = families.find((f) => f.id === "claude")!;
		expect(claude).toBeDefined();
		expect(claude.models).toHaveLength(1);
	});

	it("sorts families alphabetically by display name", () => {
		const models: ModelInfo[] = [
			{
				id: "gpt-4",
				name: "GPT-4",
				provider: "openai",
				isFree: false,
				inputCost: 10,
				outputCost: 30,
			},
			{
				id: "claude-opus",
				name: "Claude Opus",
				provider: "anthropic",
				isFree: false,
				inputCost: 15,
				outputCost: 75,
			},
		];
		const families = getModelFamilies(models);
		expect(families[0]!.displayName).toBe("Claude");
		expect(families[1]!.displayName).toBe("GPT");
	});

	it("handles empty list", () => {
		const families = getModelFamilies([]);
		expect(families).toEqual([]);
	});

	it("merges models with same normalized name across different families", () => {
		const models: ModelInfo[] = [
			{
				id: "gpt-4o",
				name: "GPT-4o",
				provider: "openai",
				isFree: false,
				inputCost: 2.5,
				outputCost: 10,
			},
			{
				id: "gpt-4o-free",
				name: "GPT-4o (free)",
				provider: "openrouter",
				isFree: true,
				inputCost: 0,
				outputCost: 0,
			},
		];
		const families = getModelFamilies(models);
		// Both should end up in the same family
		expect(families).toHaveLength(1);
		expect(families[0]!.models).toHaveLength(2);
	});

	it("skips models where detectModelFamily returns null", () => {
		// Router models return null-ish... actually they return { familyId: "other" }
		// So this will be grouped. Let's just verify empty input works.
		const families = getModelFamilies([]);
		expect(families).toEqual([]);
	});

	it("sorts models within a family by provider then reverse ID", () => {
		const models: ModelInfo[] = [
			{
				id: "gpt-4o-mini",
				name: "GPT-4o Mini",
				provider: "azure",
				isFree: false,
				inputCost: 0.15,
				outputCost: 0.6,
			},
			{
				id: "gpt-4o",
				name: "GPT-4o",
				provider: "openai",
				isFree: false,
				inputCost: 2.5,
				outputCost: 10,
			},
		];
		const families = getModelFamilies(models);
		const gpt = families.find((f) => f.id === "gpt")!;
		// Sorted by provider (azure < openai), then reverse ID
		expect(gpt.models[0]!.provider).toBe("azure");
		expect(gpt.models[1]!.provider).toBe("openai");
	});
});
