import { describe, expect, it } from "vitest";
import {
	DEEPSEEK_PROXY_COMPAT,
	getProxyModelCompat,
	isDeepSeekModel,
	isLikelyReasoningModel,
} from "../lib/provider-compat.ts";

describe("provider-compat", () => {
	describe("isDeepSeekModel", () => {
		it("detects DeepSeek in model id", () => {
			expect(isDeepSeekModel({ id: "deepseek/deepseek-v3.2" })).toBe(true);
			expect(isDeepSeekModel({ id: "vendor/DeepSeek-R1" })).toBe(true);
		});

		it("detects DeepSeek in model name", () => {
			expect(
				isDeepSeekModel({ id: "vendor/model-1", name: "DeepSeek V4 Pro" }),
			).toBe(true);
		});

		it("returns false for non-DeepSeek models", () => {
			expect(isDeepSeekModel({ id: "openai/gpt-4.1" })).toBe(false);
			expect(
				isDeepSeekModel({ id: "anthropic/claude-sonnet", name: "Claude" }),
			).toBe(false);
		});
	});

	describe("isLikelyReasoningModel", () => {
		it("detects common reasoning markers", () => {
			expect(isLikelyReasoningModel({ id: "qwen/qwq-32b" })).toBe(true);
			expect(isLikelyReasoningModel({ id: "foo/reasoner" })).toBe(true);
			expect(
				isLikelyReasoningModel({ id: "foo/bar", name: "Thinking Model" }),
			).toBe(true);
			expect(
				isLikelyReasoningModel({ id: "foo/bar", name: "Reasoning Max" }),
			).toBe(true);
			expect(isLikelyReasoningModel({ id: "deepseek/deepseek-v3.2" })).toBe(
				true,
			);
			expect(isLikelyReasoningModel({ id: "xiaomi/mimo-v2.5" })).toBe(true);
			expect(
				isLikelyReasoningModel({ id: "vendor/model", name: "Xiaomi MiMo" }),
			).toBe(true);
		});

		it("returns false for normal non-reasoning models", () => {
			expect(isLikelyReasoningModel({ id: "openai/gpt-4.1-mini" })).toBe(false);
			expect(
				isLikelyReasoningModel({ id: "meta/llama-3.3-70b-instruct" }),
			).toBe(false);
		});
	});

	describe("getProxyModelCompat", () => {
		it("returns shared DeepSeek compat for proxied DeepSeek models", () => {
			expect(getProxyModelCompat({ id: "deepseek/deepseek-r1" })).toEqual(
				DEEPSEEK_PROXY_COMPAT,
			);
			expect(
				getProxyModelCompat({ id: "vendor/model", name: "DeepSeek V4 Flash" }),
			).toEqual(DEEPSEEK_PROXY_COMPAT);
		});

		it("returns OpenAI-compatible reasoning compat for proxied MiMo/Xiaomi models", () => {
			expect(getProxyModelCompat({ id: "xiaomi/mimo-v2.5" })).toEqual({
				supportsStore: false,
				supportsDeveloperRole: false,
				supportsReasoningEffort: true,
				requiresReasoningContentOnAssistantMessages: true,
			});
			expect(
				getProxyModelCompat({ id: "vendor/model", name: "Xiaomi MiMo" }),
			).toEqual({
				supportsStore: false,
				supportsDeveloperRole: false,
				supportsReasoningEffort: true,
				requiresReasoningContentOnAssistantMessages: true,
			});
		});

		it("returns undefined for non-DeepSeek models", () => {
			expect(getProxyModelCompat({ id: "openai/gpt-4.1" })).toBeUndefined();
			expect(
				getProxyModelCompat({ id: "anthropic/claude-sonnet", name: "Claude" }),
			).toBeUndefined();
		});
	});
});
