import type { AssistantMessage, Model } from "@earendil-works/pi-ai/compat";
import { describe, expect, it } from "vitest";
import { isFreeModel } from "../lib/registry.ts";
import {
	isTokenRouterMinimaxModel,
	mapTokenRouterModel,
	normalizeAssistantMessage,
	normalizeTokenRouterRequestPayload,
	stripEnrichedTokenRouterCompat,
	withoutReasoningEffort,
} from "../providers/tokenrouter/tokenrouter.ts";

describe("TokenRouter free model detection", () => {
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

	const allModels = [freeSuffixModel, paidModel];

	it("detects :free suffix models as free through the real mapping (name-based Route B)", () => {
		const mapped = mapTokenRouterModel({
			id: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
			object: "model",
			created: 0,
			owned_by: "nvidia",
			supported_endpoint_types: ["openai"],
			tags: "text",
		});
		expect(mapped._isFree).toBe(true);
		expect(isFreeModel({ ...mapped, provider: "tokenrouter" }, allModels)).toBe(
			true,
		);
	});

	it("does not treat MiniMax-M3 as free (no known-free list survives)", () => {
		const mapped = mapTokenRouterModel({
			id: "MiniMax-M3",
			object: "model",
			created: 0,
			owned_by: "minimax",
			supported_endpoint_types: ["openai"],
			tags: "text",
		});
		expect(mapped._isFree).toBe(false);
		expect(isFreeModel({ ...mapped, provider: "tokenrouter" }, allModels)).toBe(
			false,
		);
	});

	it("detects regular models as not free", () => {
		expect(
			isFreeModel({ ...paidModel, provider: "tokenrouter" }, allModels),
		).toBe(false);
	});
});

describe("TokenRouter compat", () => {
	it("uses the shared getProxyModelCompat with only supportsReasoningEffort disabled", () => {
		const model = mapTokenRouterModel({
			id: "deepseek-r1",
			object: "model",
			created: 0,
			owned_by: "deepseek",
			supported_endpoint_types: ["openai"],
			tags: "text",
		});

		expect(model.reasoning).toBe(true);
		const compat = model.compat as
			| {
					supportsReasoningEffort?: boolean;
					thinkingFormat?: string;
					requiresReasoningContentOnAssistantMessages?: boolean;
			  }
			| undefined;
		// Multi-turn reasoning keeps its chain-of-thought replay…
		expect(compat?.requiresReasoningContentOnAssistantMessages).toBe(true);
		// …and deepseek-style thinking format stays…
		expect(compat?.thinkingFormat).toBe("deepseek");
		// …but TokenRouter's chat completions route rejects `reasoning_effort`,
		// so the effort flag must never be advertised.
		expect(compat?.supportsReasoningEffort).toBe(false);
	});

	it("withoutReasoningEffort strips only the effort flag", () => {
		const compat = {
			supportsStore: false,
			supportsReasoningEffort: true,
			requiresReasoningContentOnAssistantMessages: true,
			thinkingFormat: "deepseek" as const,
		};
		const stripped = withoutReasoningEffort(compat);
		expect(stripped).toEqual({
			supportsStore: false,
			supportsReasoningEffort: false,
			requiresReasoningContentOnAssistantMessages: true,
			thinkingFormat: "deepseek",
		});
		// Original object untouched (the shared DEEPSEEK_PROXY_COMPAT must not
		// be mutated by a provider-specific strip).
		expect(compat.supportsReasoningEffort).toBe(true);
	});

	it("re-strips a models.dev-derived effort flag after enrichment", () => {
		const enriched = stripEnrichedTokenRouterCompat([
			{
				id: "deepseek-r1",
				name: "DeepSeek R1",
				reasoning: true,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128_000,
				maxTokens: 16_384,
				// Simulates enrichment re-deriving the proxy compat on a model
				// that originally carried no base compat.
				compat: {
					supportsReasoningEffort: true,
					requiresReasoningContentOnAssistantMessages: true,
				},
			},
		]);
		expect(enriched[0].compat).toEqual({
			supportsReasoningEffort: false,
			requiresReasoningContentOnAssistantMessages: true,
		});
	});

	it("leaves models without the effort flag untouched", () => {
		const model = {
			id: "openai/gpt-5.4-nano",
			name: "GPT 5.4 Nano",
			reasoning: false,
			input: ["text"] as ("image" | "text")[],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128_000,
			maxTokens: 16_384,
			compat: undefined,
		};
		expect(stripEnrichedTokenRouterCompat([model])[0]).toBe(model);
	});
});

describe("TokenRouter MiniMax handling", () => {
	it("identifies minimax models", () => {
		expect(isTokenRouterMinimaxModel("MiniMax-M3")).toBe(true);
		expect(isTokenRouterMinimaxModel("deepseek-v4")).toBe(false);
	});

	it("marks MiniMax-M3 as a reasoning model", () => {
		const model = mapTokenRouterModel({
			id: "MiniMax-M3",
			object: "model",
			created: 0,
			owned_by: "minimax",
			supported_endpoint_types: ["openai"],
			tags: "text",
		});

		expect(model.reasoning).toBe(true);
	});

	it("extracts inline think blocks into ThinkingContent", () => {
		const message = {
			role: "assistant",
			content: [
				{
					type: "text",
					text: "Before\n\n thinkingLet me explore. response\n\nAfter",
				},
			],
		} as unknown as AssistantMessage;
		const normalized = normalizeAssistantMessage(message);

		expect(normalized.content).toHaveLength(2);
		const textBlock = normalized.content[0];
		expect(textBlock).toMatchObject({ type: "text" });
		expect((textBlock as { text: string }).text).not.toContain(" thinking");
		expect((textBlock as { text: string }).text).toContain("Before");
		expect((textBlock as { text: string }).text).toContain("After");
		expect(normalized.content[1]).toMatchObject({
			type: "thinking",
			thinking: "Let me explore.",
		});
	});

	it("leaves text without think tags unchanged", () => {
		const message = {
			role: "assistant",
			content: [{ type: "text", text: "Just plain text." }],
		} as unknown as AssistantMessage;
		const normalized = normalizeAssistantMessage(message);

		expect(normalized.content).toEqual([
			{ type: "text", text: "Just plain text." },
		]);
	});

	it("patches MiniMax-M3 thinking payloads from enabled to adaptive", () => {
		expect(
			normalizeTokenRouterRequestPayload({
				model: "MiniMax-M3",
				thinking: { type: "enabled" },
			}),
		).toEqual({
			model: "MiniMax-M3",
			thinking: { type: "adaptive" },
			reasoning_split: true,
		});
	});

	it("adds reasoning_split without touching non-MiniMax thinking", () => {
		const other = {
			model: "deepseek-r1",
			thinking: { type: "enabled" },
		};
		const result = normalizeTokenRouterRequestPayload(other);
		expect(result).not.toBe(other);
		expect(result).toEqual({
			model: "deepseek-r1",
			thinking: { type: "enabled" },
			reasoning_split: true,
		});
	});

	it("force-patches even when the payload has no model field", () => {
		expect(
			normalizeTokenRouterRequestPayload(
				{ thinking: { type: "enabled" } },
				true,
			),
		).toEqual({ thinking: { type: "adaptive" }, reasoning_split: true });
	});

	it("leaves an already-normalized payload untouched", () => {
		const payload = {
			model: "gpt-5",
			reasoning_effort: "xhigh",
			reasoning_split: true,
		};
		expect(normalizeTokenRouterRequestPayload(payload)).toBe(payload);
	});

	describe("reasoning_effort clamping", () => {
		it("keeps values the gateway accepts", () => {
			for (const effort of ["low", "medium", "xhigh"]) {
				expect(
					normalizeTokenRouterRequestPayload({ reasoning_effort: effort }),
				).toEqual({ reasoning_effort: effort, reasoning_split: true });
			}
		});

		it("maps near-misses onto the accepted set", () => {
			expect(
				normalizeTokenRouterRequestPayload({ reasoning_effort: "minimal" }),
			).toEqual({ reasoning_effort: "low", reasoning_split: true });
			expect(
				normalizeTokenRouterRequestPayload({ reasoning_effort: "high" }),
			).toEqual({ reasoning_effort: "xhigh", reasoning_split: true });
		});

		it("drops values the gateway rejects with a 400", () => {
			// pi-ai derives "none" from models.dev thinkingLevelMaps; sending it
			// hard-fails the request.
			expect(normalizeTokenRouterRequestPayload({ reasoning_effort: "none" })).toEqual({
				reasoning_split: true,
			});
			expect(
				normalizeTokenRouterRequestPayload({ reasoning_effort: null }),
			).toEqual({ reasoning_split: true });
		});
	});
});
