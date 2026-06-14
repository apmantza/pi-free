import { describe, expect, it } from "vitest";
import { isFreeModel } from "../lib/registry.ts";
import {
	finalizeTokenRouterModel,
	mapTokenRouterModel,
	normalizeAssistantMessage,
	patchTokenRouterMinimaxThinkingPayload,
} from "../providers/tokenrouter/tokenrouter.ts";

describe("TokenRouter free model detection", () => {
	const freeModel = {
		id: "MiniMax-M3",
		name: "MiniMax-M3",
		reasoning: false,
		input: ["text" as const],
		contextWindow: 128_000,
		maxTokens: 16_384,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		_freeKnown: true as const,
		_isFree: true as const,
		_pricingKnown: false,
	};
	const freeSuffixModel = {
		id: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
		name: "Nemotron :free",
		reasoning: false,
		input: ["text" as const],
		contextWindow: 128_000,
		maxTokens: 16_384,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		_pricingKnown: false,
	};
	const paidModel = {
		id: "openai/gpt-5.4-nano",
		name: "GPT 5.4 Nano",
		reasoning: false,
		input: ["text" as const],
		contextWindow: 128_000,
		maxTokens: 16_384,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		_pricingKnown: false,
	};

	const allModels = [freeModel, freeSuffixModel, paidModel];

	it("detects MiniMax-M3 as free (known-free list)", () => {
		expect(
			isFreeModel({ ...freeModel, provider: "tokenrouter" }, allModels),
		).toBe(true);
	});

	it("uses adaptive-thinking compat for MiniMax-M3", () => {
		const model = mapTokenRouterModel({
			id: "MiniMax-M3",
			object: "model",
			created: 0,
			owned_by: "minimax",
			supported_endpoint_types: ["openai"],
			tags: "text",
		});

		expect(model.reasoning).toBe(true);
		expect(
			(model.compat as { thinkingFormat?: string } | undefined)?.thinkingFormat,
		).toBe("deepseek");
	});

	it("keeps MiniMax-M3 adaptive-thinking compat after metadata enrichment", () => {
		const model = finalizeTokenRouterModel({
			...freeModel,
			reasoning: true,
			thinkingLevelMap: { high: "high" },
			compat: {
				thinkingFormat: "deepseek",
				supportsReasoningEffort: true,
				requiresReasoningContentOnAssistantMessages: true,
				supportsDeveloperRole: false,
			},
		});

		expect(model.reasoning).toBe(true);
		expect(model.thinkingLevelMap).toEqual({ high: "high" });
		expect(model.compat).toEqual({
			supportsStore: false,
			supportsDeveloperRole: false,
			supportsReasoningEffort: true,
			requiresReasoningContentOnAssistantMessages: true,
			thinkingFormat: "deepseek",
		});
	});

	it("patches MiniMax-M3 thinking payloads from enabled to adaptive", () => {
		expect(
			patchTokenRouterMinimaxThinkingPayload({
				model: "MiniMax-M3",
				thinking: { type: "enabled" },
				reasoning_effort: "high",
			}),
		).toEqual({
			model: "MiniMax-M3",
			thinking: { type: "adaptive" },
			reasoning_effort: "high",
		});
	});

	it("leaves non-MiniMax and disabled thinking payloads unchanged", () => {
		const disabled = {
			model: "MiniMax-M3",
			thinking: { type: "disabled" },
		};
		const other = {
			model: "deepseek-r1",
			thinking: { type: "enabled" },
		};

		expect(patchTokenRouterMinimaxThinkingPayload(disabled)).toBe(disabled);
		expect(patchTokenRouterMinimaxThinkingPayload(other)).toBe(other);
	});

	it("detects :free suffix models as free (name-based Route B)", () => {
		expect(
			isFreeModel({ ...freeSuffixModel, provider: "tokenrouter" }, allModels),
		).toBe(true);
	});

	it("detects regular models as not free", () => {
		expect(
			isFreeModel({ ...paidModel, provider: "tokenrouter" }, allModels),
		).toBe(false);
	});
});

describe("TokenRouter MiniMax reasoning cleanup", () => {
	function assistantMessage(text: string): {
		role: "assistant";
		content: { type: "text"; text: string }[];
	} {
		return {
			role: "assistant",
			content: [{ type: "text", text }],
		};
	}

	it("extracts inline think blocks into ThinkingContent", () => {
		const message = assistantMessage(
			"Before\n\n<think>Let me explore the freebuff-npm directory.</think>\n\nAfter",
		);
		const normalized = normalizeAssistantMessage(message as any);

		expect(normalized.content).toHaveLength(2);
		const textBlock = normalized.content[0];
		expect(textBlock).toMatchObject({ type: "text" });
		expect((textBlock as { text: string }).text).not.toContain("<think>");
		expect((textBlock as { text: string }).text).toContain("Before");
		expect((textBlock as { text: string }).text).toContain("After");
		expect(normalized.content[1]).toMatchObject({
			type: "thinking",
			thinking: "Let me explore the freebuff-npm directory.",
		});
	});

	it("handles multiple think blocks", () => {
		const message = assistantMessage(
			"<think>first</think> text <think>second</think>",
		);
		const normalized = normalizeAssistantMessage(message as any);

		expect(normalized.content[0]).toEqual({ type: "text", text: "text" });
		expect(normalized.content[1]).toMatchObject({
			type: "thinking",
			thinking: "first\n\nsecond",
		});
	});

	it("treats unclosed think tag as thinking", () => {
		const message = assistantMessage("<think>dangling reasoning");
		const normalized = normalizeAssistantMessage(message as any);

		expect(normalized.content).toHaveLength(1);
		expect(normalized.content[0]).toMatchObject({
			type: "thinking",
			thinking: "dangling reasoning",
		});
	});

	it("leaves text without think tags unchanged", () => {
		const message = assistantMessage("Just plain text.");
		const normalized = normalizeAssistantMessage(message as any);

		expect(normalized.content).toEqual([{ type: "text", text: "Just plain text." }]);
	});
});
