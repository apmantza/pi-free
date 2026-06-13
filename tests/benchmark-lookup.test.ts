import { describe, expect, it } from "vitest";
import {
	enhanceModelNameWithCodingIndex,
	findHardcodedBenchmark,
	getHardcodedScore,
} from "../provider-failover/benchmark-lookup.ts";

describe("Benchmark Lookup", () => {
	describe("enhanceModelNameWithCodingIndex", () => {
		it("should not throw for models with NVIDIA prefixes", () => {
			expect(() =>
				enhanceModelNameWithCodingIndex(
					"Meta Llama 3 70B",
					"meta/llama-3-70b",
					"nvidia",
				),
			).not.toThrow();
		});

		it("should not throw for models with Cloudflare @cf prefix", () => {
			expect(() =>
				enhanceModelNameWithCodingIndex(
					"Llama 3 8B",
					"@cf/meta/llama-3-8b",
					"cloudflare",
				),
			).not.toThrow();
		});

		it("should not throw for OpenRouter :free suffix", () => {
			expect(() =>
				enhanceModelNameWithCodingIndex(
					"GPT-4o",
					"openai/gpt-4o:free",
					"openrouter",
				),
			).not.toThrow();
		});

		it("should not throw for Ollama colon format", () => {
			expect(() =>
				enhanceModelNameWithCodingIndex("Llama 3", "llama3:latest", "ollama"),
			).not.toThrow();
		});

		it("should not throw for Groq numeric suffix", () => {
			expect(() =>
				enhanceModelNameWithCodingIndex(
					"Mixtral 8x7B",
					"mixtral-8x7b-32768",
					"groq",
				),
			).not.toThrow();
		});

		it("should not throw for Groq -versatile suffix", () => {
			expect(() =>
				enhanceModelNameWithCodingIndex(
					"Llama 3.1 70B",
					"llama-3.1-70b-versatile",
					"groq",
				),
			).not.toThrow();
		});

		it("should not throw for Cerebras llama format", () => {
			expect(() =>
				enhanceModelNameWithCodingIndex(
					"Llama 3.1 8B",
					"llama3.1-8b",
					"cerebras",
				),
			).not.toThrow();
		});

		it("should not throw for Mistral -latest suffix", () => {
			expect(() =>
				enhanceModelNameWithCodingIndex(
					"Mistral Large",
					"mistral-large-latest",
					"mistral",
				),
			).not.toThrow();
		});

		it("should not throw for models with date suffixes", () => {
			expect(() =>
				enhanceModelNameWithCodingIndex("GPT-4o", "gpt-4o-20250514", "openai"),
			).not.toThrow();
		});

		it("should not throw for models with version suffixes", () => {
			expect(() =>
				enhanceModelNameWithCodingIndex(
					"Claude 3.5",
					"claude-3-5-sonnet-v1.1",
					"anthropic",
				),
			).not.toThrow();
		});

		it("should not throw for models with fp/bf suffixes", () => {
			expect(() =>
				enhanceModelNameWithCodingIndex(
					"Llama 3 70B",
					"llama-3-70b-fp16",
					"nvidia",
				),
			).not.toThrow();
			expect(() =>
				enhanceModelNameWithCodingIndex(
					"Llama 3 70B",
					"llama-3-70b-bf16",
					"nvidia",
				),
			).not.toThrow();
		});

		it("should not throw for models with -it suffix", () => {
			expect(() =>
				enhanceModelNameWithCodingIndex(
					"Gemma 2 9B",
					"gemma-2-9b-it",
					"google",
				),
			).not.toThrow();
		});

		it("should return enhanced name with CI score when matched", () => {
			const result = enhanceModelNameWithCodingIndex(
				"GPT-4o",
				"gpt-4o",
				"openai",
			);
			expect(result).toContain("[CI:");
		});

		it("should return original name when no match", () => {
			const result = enhanceModelNameWithCodingIndex(
				"Some Unknown Model",
				"unknown-model-xyz",
				"test",
			);
			expect(result).toBe("Some Unknown Model");
		});
	});

	describe("findHardcodedBenchmark", () => {
		it("should find benchmark for exact model name", () => {
			const result = findHardcodedBenchmark("GPT-4o", "gpt-4o", "openai");
			expect(result).not.toBeNull();
			expect(result?.codingIndex).toBeDefined();
		});

		it("should find benchmark via variant alias", () => {
			const result = findHardcodedBenchmark(
				"Claude 3.5 Sonnet",
				"claude-3-5-sonnet",
				"anthropic",
			);
			expect(result).not.toBeNull();
		});

		it("should return null for unknown models", () => {
			const result = findHardcodedBenchmark(
				"Unknown Model",
				"unknown-model",
				"test",
			);
			expect(result).toBeNull();
		});

		it("should use models.dev hints for opaque gateway IDs", () => {
			expect(
				findHardcodedBenchmark("Opaque Gateway Model", "opaque-id", "gateway"),
			).toBeNull();

			const result = findHardcodedBenchmark(
				"Opaque Gateway Model",
				"opaque-id",
				"gateway",
				{
					id: "moonshotai/Kimi-K2.6",
					name: "Kimi K2.6",
					family: "kimi-k2",
					provider: "moonshotai",
				},
			);

			expect(result?.codingIndex).toBeCloseTo(47.1);
			expect(result?.originalModel).toBe("Kimi K2.6");
		});

		it("should ignore non-matching family-only hints in prefix fallback", () => {
			const result = findHardcodedBenchmark(
				"Opaque Gateway Model",
				"opaque-id",
				"gateway",
				{ family: "this-fam-does-not-exist-12345" },
			);

			expect(result).toBeNull();
		});
	});

	describe("getHardcodedScore", () => {
		it("should return a score for known models", () => {
			const score = getHardcodedScore("GPT-4o", "gpt-4o", "openai");
			expect(score).not.toBeNull();
			expect(typeof score).toBe("number");
		});

		it("should return null for unknown models", () => {
			const score = getHardcodedScore("Unknown", "unknown", "test");
			expect(score).toBeNull();
		});

		it("should return a score from models.dev hints", () => {
			const score = getHardcodedScore(
				"Opaque Gateway Model",
				"opaque-id",
				"gateway",
				{ id: "moonshotai/Kimi-K2.6" },
			);
			expect(score).toBeCloseTo(47.1);
		});
	});

	describe("models.dev match hints", () => {
		it("should enhance names using models.dev hints", () => {
			const name = enhanceModelNameWithCodingIndex(
				"Opaque Gateway Model",
				"opaque-id",
				"gateway",
				{ id: "moonshotai/Kimi-K2.6" },
			);
			expect(name).toBe("Opaque Gateway Model [CI: 47.1]");
		});

		it("should enhance names using models.dev name-only hints", () => {
			const name = enhanceModelNameWithCodingIndex(
				"Opaque Gateway Model",
				"opaque-id",
				"gateway",
				{ name: "Kimi K2.6" },
			);
			expect(name).toBe("Opaque Gateway Model [CI: 47.1]");
		});

		it("should leave names unchanged when hints do not match", () => {
			const name = enhanceModelNameWithCodingIndex(
				"Opaque Gateway Model",
				"opaque-id",
				"gateway",
				{ id: "unknown-canonical-model" },
			);
			expect(name).toBe("Opaque Gateway Model");
		});
	});

	describe("replaceAll regex global flag", () => {
		it("should not use replaceAll with non-global RegExp in benchmark-lookup.ts", () => {
			// This test prevents regression of the TypeError:
			// "String.prototype.replaceAll called with a non-global RegExp argument"
			const fs = require("node:fs");
			const path = require("node:path");
			const filePath = path.join(
				__dirname,
				"..",
				"provider-failover",
				"benchmark-lookup.ts",
			);
			const content = fs.readFileSync(filePath, "utf-8");

			// Find all replaceAll calls with regex literals
			const replaceAllRegex = /\.replaceAll\(\/[^/]+\/[^g,]*,/g;
			const matches = content.match(replaceAllRegex) || [];

			// Filter out false positives where 'g' might be present but not captured
			const nonGlobalMatches = matches.filter(
				(m: string) => !m.includes("/g,"),
			);

			if (nonGlobalMatches.length > 0) {
				throw new Error(
					`Found replaceAll calls with non-global RegExp in benchmark-lookup.ts:\n${nonGlobalMatches.join("\n")}`,
				);
			}

			expect(nonGlobalMatches).toHaveLength(0);
		});
	});
});
