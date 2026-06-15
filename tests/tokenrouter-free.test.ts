import type { AssistantMessage, Model } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isFreeModel } from "../lib/registry.ts";
import {
	__test__,
	finalizeTokenRouterModel,
	mapTokenRouterModel,
	normalizeAssistantMessage,
	patchTokenRouterMinimaxThinkingPayload,
	streamSimpleTokenRouter,
} from "../providers/tokenrouter/tokenrouter.ts";

function tokenRouterTestModel(): Model<string> {
	return {
		id: "MiniMax-M3",
		name: "MiniMax-M3",
		provider: "tokenrouter",
		api: "tokenrouter-openai-completions",
	} as Model<string>;
}

function assistantMessage(
	stopReason: AssistantMessage["stopReason"],
	errorMessage?: string,
	content: AssistantMessage["content"] = [],
): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "tokenrouter-openai-completions",
		provider: "tokenrouter",
		model: "MiniMax-M3",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason,
		errorMessage,
		timestamp: Date.now(),
	};
}

function errorAttempt(message: string) {
	const stream = createAssistantMessageEventStream();
	queueMicrotask(() => {
		const error = assistantMessage("error", message);
		stream.push({ type: "start", partial: error });
		stream.push({ type: "error", reason: "error", error });
	});
	return stream;
}

function textAttempt(text: string) {
	const stream = createAssistantMessageEventStream();
	queueMicrotask(() => {
		const message = assistantMessage("stop", undefined, [{ type: "text", text }]);
		stream.push({ type: "start", partial: { ...message, content: [] } });
		stream.push({ type: "text_start", contentIndex: 0, partial: message });
		stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial: message });
		stream.push({ type: "text_end", contentIndex: 0, content: text, partial: message });
		stream.push({ type: "done", reason: "stop", message });
	});
	return stream;
}

afterEach(() => {
	vi.useRealTimers();
});

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

	it("patches nested MiniMax-M3 thinking payloads used by compaction", () => {
		expect(
			patchTokenRouterMinimaxThinkingPayload({
				model: "MiniMax-M3",
				extra_body: {
					thinking: { type: "enabled", budget_tokens: 1024 },
				},
				provider_options: {
					tokenrouter: {
						thinking: { type: "enabled" },
					},
				},
			}),
		).toEqual({
			model: "MiniMax-M3",
			extra_body: {
				thinking: { type: "adaptive", budget_tokens: 1024 },
			},
			provider_options: {
				tokenrouter: {
					thinking: { type: "adaptive" },
				},
			},
		});
	});

	it("patches compaction payloads without a model field when forced", () => {
		expect(
			patchTokenRouterMinimaxThinkingPayload(
				{
					messages: [{ role: "user", content: "summarize" }],
					thinking: { type: "enabled" },
				},
				true,
			),
		).toEqual({
			messages: [{ role: "user", content: "summarize" }],
			thinking: { type: "adaptive" },
		});
	});

	it("patches stringified compaction payloads when forced", () => {
		const payload = JSON.stringify({ thinking: { type: "enabled" } });
		expect(patchTokenRouterMinimaxThinkingPayload(payload, true)).toBe(
			JSON.stringify({ thinking: { type: "adaptive" } }),
		);
	});

	it("patches the actual OpenAI-completions payload before TokenRouter sends it", async () => {
		let capturedPayload: unknown;
		const stream = streamSimpleTokenRouter(
			{
				id: "MiniMax-M3",
				name: "MiniMax-M3",
				provider: "tokenrouter",
				api: "tokenrouter-openai-completions",
				baseUrl: "http://127.0.0.1:9/v1",
				reasoning: true,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128_000,
				maxTokens: 16_384,
				compat: {
					thinkingFormat: "deepseek",
					supportsReasoningEffort: true,
					supportsStore: false,
					supportsDeveloperRole: false,
					requiresReasoningContentOnAssistantMessages: true,
				},
			},
			{
				systemPrompt: "",
				messages: [
					{
						role: "user",
						content: [{ type: "text", text: "summarize" }],
						timestamp: Date.now(),
					},
				],
				tools: [],
			},
			{
				apiKey: "test-tokenrouter-key",
				reasoning: "high",
				maxRetries: 0,
				timeoutMs: 1,
				onPayload: (payload) => {
					capturedPayload = payload;
					throw new Error("stop after payload capture");
				},
			},
		);

		await stream.result();
		expect(capturedPayload).toMatchObject({
			model: "MiniMax-M3",
			thinking: { type: "adaptive" },
			reasoning_effort: "high",
		});
		expect(JSON.stringify(capturedPayload)).not.toContain('"enabled"');
	});

	it("retries TokenRouter high-load 2064 errors once after 30 seconds", async () => {
		vi.useFakeTimers();
		let attempts = 0;
		const stream = __test__.streamWithTokenRouterHighLoadRetry(
			tokenRouterTestModel(),
			() => {
				attempts += 1;
				return attempts === 1
					? errorAttempt(
							"The server cluster is currently under high load. Please retry after a short wait and thank you for your patience. (2064)",
						)
					: textAttempt("retried successfully");
			},
			{},
		);

		const resultPromise = stream.result();
		await vi.advanceTimersByTimeAsync(
			__test__.TOKENROUTER_HIGH_LOAD_RETRY_DELAY_MS - 1,
		);
		expect(attempts).toBe(1);
		await vi.advanceTimersByTimeAsync(1);

		const result = await resultPromise;
		expect(attempts).toBe(2);
		expect(result.stopReason).toBe("stop");
		expect(result.content).toEqual([
			{ type: "text", text: "retried successfully" },
		]);
	});

	it("does not retry TokenRouter high-load errors after output started", async () => {
		let attempts = 0;
		const stream = __test__.streamWithTokenRouterHighLoadRetry(
			tokenRouterTestModel(),
			() => {
				attempts += 1;
				const attempt = createAssistantMessageEventStream();
				queueMicrotask(() => {
					const partial = assistantMessage("error", undefined, [
						{ type: "text", text: "partial" },
					]);
					attempt.push({ type: "start", partial: { ...partial, content: [] } });
					attempt.push({ type: "text_start", contentIndex: 0, partial });
					attempt.push({
						type: "text_delta",
						contentIndex: 0,
						delta: "partial",
						partial,
					});
					attempt.push({
						type: "error",
						reason: "error",
						error: assistantMessage("error", "high load (2064)", [
							{ type: "text", text: "partial" },
						]),
					});
				});
				return attempt;
			},
			{},
		);

		const result = await stream.result();
		expect(attempts).toBe(1);
		expect(result.stopReason).toBe("error");
		expect(result.errorMessage).toBe("high load (2064)");
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

		expect(normalized.content).toEqual([
			{ type: "text", text: "Just plain text." },
		]);
	});
});
