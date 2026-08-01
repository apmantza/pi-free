/**
 * Qoder stream parsing tests.
 */

import type {
	AssistantMessage,
	AssistantMessageEvent,
} from "@earendil-works/pi-ai/compat";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface MockStreamShape {
	events: AssistantMessageEvent[];
	ended: boolean;
	push(event: AssistantMessageEvent): void;
	end(): void;
	result(): Promise<AssistantMessage>;
}

const mockLogger = vi.hoisted(() => ({
	info: vi.fn(),
	error: vi.fn(),
	warn: vi.fn(),
	debug: vi.fn(),
}));

const mockGetCachedModelConfig = vi.hoisted(() => vi.fn());

vi.mock("../lib/assistant-message-event-stream.ts", async () => {
	class MockStream implements MockStreamShape {
		events: AssistantMessageEvent[] = [];
		ended = false;

		push(event: AssistantMessageEvent): void {
			this.events.push(event);
		}

		end(): void {
			this.ended = true;
		}

		result(): Promise<AssistantMessage> {
			return Promise.resolve({} as AssistantMessage);
		}
	}

	return {
		AssistantMessageEventStream: MockStream,
	};
});

vi.mock("../constants.ts", () => ({
	BASE_URL_QODER: "https://api2-v2.qoder.sh",
}));

vi.mock("../lib/logger.ts", () => ({
	createLogger: () => mockLogger,
}));

vi.mock("../providers/qoder/models.ts", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../providers/qoder/models.ts")>();
	return {
		...actual,
		getCachedModelConfig: (...args: unknown[]) =>
			mockGetCachedModelConfig(...args),
	};
});

vi.mock("../providers/qoder/transform.ts", () => ({
	transformMessagesForQoder: (messages: unknown[]) => messages,
	transformTools: (tools: unknown[]) => tools,
}));

import { streamQoder } from "../providers/qoder/stream.ts";

function createReadableStream(lines: string[]): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	let index = 0;
	return new ReadableStream({
		pull(controller) {
			if (index >= lines.length) {
				controller.close();
				return;
			}
			controller.enqueue(encoder.encode(lines[index]));
			index++;
		},
	});
}

function modelStub(id: string) {
	return {
		id,
		api: "qoder-api",
		provider: "qoder",
		input: ["text"],
	} as any;
}

function contextStub(messages: unknown[] = []) {
	return {
		messages,
		systemPrompt: "",
		tools: [],
	} as any;
}

function getMockStream(stream: unknown): MockStreamShape {
	return stream as unknown as MockStreamShape;
}

describe("Qoder stream setup", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetCachedModelConfig.mockReturnValue(null);
		globalThis.fetch = vi.fn();
	});

	it("throws when no apiKey is provided", async () => {
		const stream = streamQoder(
			modelStub("lite"),
			contextStub([{ role: "user", content: "Hi" }]),
			{} as any,
		);

		const mockStream = getMockStream(stream);
		await vi.waitFor(() => expect(mockStream.ended).toBe(true));

		const errorEvent = mockStream.events.find((e: any) => e.type === "error");
		expect(errorEvent).toBeDefined();
		const err = errorEvent as any;
		expect(err.error.errorMessage).toContain("credentials not set");
	});

	it("emits an error event when the network request rejects", async () => {
		vi.mocked(globalThis.fetch).mockRejectedValue(new Error("Network down"));

		const stream = streamQoder(
			modelStub("lite"),
			contextStub([{ role: "user", content: "Hi" }]),
			{ apiKey: "sk-test" } as any,
		);

		const mockStream = getMockStream(stream);
		await vi.waitFor(() => expect(mockStream.ended).toBe(true));

		const errorEvent = mockStream.events.find((e: any) => e.type === "error");
		expect(errorEvent).toBeDefined();
		const err = errorEvent as any;
		expect(err.error.errorMessage).toContain("Network down");
	});
});

describe("Qoder stream parsing", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetCachedModelConfig.mockReturnValue(null);
		globalThis.fetch = vi.fn();
	});

	it("streams a simple text response", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValue({
			ok: true,
			status: 200,
			body: createReadableStream([
				'data: {"choices":[{"delta":{"role":"assistant","content":""}}]}\n\n',
				'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
				'data: {"choices":[{"delta":{"content":"!"}}]}\n\n',
				"data: [DONE]\n\n",
			]),
		} as unknown as Response);

		const stream = streamQoder(
			modelStub("lite"),
			contextStub([{ role: "user", content: "Hi" }]),
			{ apiKey: "sk-test" } as any,
		);

		const mockStream = getMockStream(stream);
		await vi.waitFor(() => expect(mockStream.ended).toBe(true));

		const textDeltas = mockStream.events
			.filter((e: any) => e.type === "text_delta")
			.map((e: any) => e.delta)
			.join("");
		expect(textDeltas).toBe("Hello!");
	});

	it("streams reasoning_content as thinking blocks", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValue({
			ok: true,
			status: 200,
			body: createReadableStream([
				'data: {"choices":[{"delta":{"role":"assistant","content":""}}]}\n\n',
				'data: {"choices":[{"delta":{"reasoning_content":"Let me think"}}]}\n\n',
				'data: {"choices":[{"delta":{"reasoning_content":" about this"}}]}\n\n',
				'data: {"choices":[{"delta":{"content":"Answer"}}]}\n\n',
				"data: [DONE]\n\n",
			]),
		} as unknown as Response);

		const stream = streamQoder(
			modelStub("dmodel"),
			contextStub([{ role: "user", content: "Hi" }]),
			{ apiKey: "sk-test" } as any,
		);

		const mockStream = getMockStream(stream);
		await vi.waitFor(() => expect(mockStream.ended).toBe(true));

		const thinkingDeltas = mockStream.events
			.filter((e: any) => e.type === "thinking_delta")
			.map((e: any) => e.delta)
			.join("");
		expect(thinkingDeltas).toBe("Let me think about this");

		const textDeltas = mockStream.events
			.filter((e: any) => e.type === "text_delta")
			.map((e: any) => e.delta)
			.join("");
		expect(textDeltas).toBe("Answer");
	});

	it("streams tool calls", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValue({
			ok: true,
			status: 200,
			body: createReadableStream([
				'data: {"choices":[{"delta":{"role":"assistant","content":""}}]}\n\n',
				'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"getWeather"}}]}}]}\n\n',
				'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"location\\":\\"At"}}]}}]}\n\n',
				'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"hens\\"}"}}]}}]}\n\n',
				"data: [DONE]\n\n",
			]),
		} as unknown as Response);

		const stream = streamQoder(
			modelStub("auto"),
			contextStub([{ role: "user", content: "Weather?" }]),
			{ apiKey: "sk-test" } as any,
		);

		const mockStream = getMockStream(stream);
		await vi.waitFor(() => expect(mockStream.ended).toBe(true));

		const toolcallEnds = mockStream.events.filter(
			(e: any) => e.type === "toolcall_end",
		);
		expect(toolcallEnds).toHaveLength(1);
		const endEvent = toolcallEnds[0] as any;
		expect(endEvent.toolCall).toMatchObject({
			id: "call_1",
			name: "getWeather",
			arguments: { location: "Athens" },
		});
	});

	it("emits an error event when the API returns a non-OK response", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValue({
			ok: false,
			status: 401,
			statusText: "Unauthorized",
			text: async () => '{"error":"unauthorized"}',
			body: null,
		} as unknown as Response);

		const stream = streamQoder(
			modelStub("lite"),
			contextStub([{ role: "user", content: "Hi" }]),
			{ apiKey: "sk-test" } as any,
		);

		const mockStream = getMockStream(stream);
		await vi.waitFor(() => expect(mockStream.ended).toBe(true));

		const errorEvent = mockStream.events.find((e: any) => e.type === "error");
		expect(errorEvent).toBeDefined();
		const err = errorEvent as any;
		expect(err.error.errorMessage).toContain("401");
		expect(err.error.errorMessage).not.toContain("sk-test");
	});

	it("emits an error event when an SSE error is streamed", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValue({
			ok: true,
			status: 200,
			body: createReadableStream([
				'data: {"error":{"message":"quota exceeded"}}\n\n',
			]),
		} as unknown as Response);

		const stream = streamQoder(
			modelStub("auto"),
			contextStub([{ role: "user", content: "Hi" }]),
			{ apiKey: "sk-test" } as any,
		);

		const mockStream = getMockStream(stream);
		await vi.waitFor(() => expect(mockStream.ended).toBe(true));

		const errorEvent = mockStream.events.find((e: any) => e.type === "error");
		expect(errorEvent).toBeDefined();
		const err = errorEvent as any;
		expect(err.error.errorMessage).toContain("quota exceeded");
	});

	it("sends max_tokens when it equals the 32768 boundary", async () => {
		mockGetCachedModelConfig.mockReturnValue({
			key: "lite",
			is_reasoning: false,
			max_output_tokens: 32768,
		});

		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			body: createReadableStream(["data: [DONE]\n\n"]),
		} as unknown as Response);
		globalThis.fetch = fetchMock;

		streamQoder(
			modelStub("lite"),
			contextStub([{ role: "user", content: "Hi" }]),
			{ apiKey: "sk-test", maxTokens: 32768 } as any,
		);

		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());

		const bodyRaw = fetchMock.mock.calls[0][1].body;
		let body: Record<string, unknown>;
		try {
			body = JSON.parse(bodyRaw.toString());
		} catch {
			throw new Error("Request body was not valid JSON");
		}
		expect(body.max_tokens).toBe(32768);
	});

	it("does not leak the access token in error logs", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValue({
			ok: false,
			status: 500,
			statusText: "Internal Server Error",
			text: async () => '{"error":"boom"}',
			body: null,
		} as unknown as Response);

		streamQoder(
			modelStub("lite"),
			contextStub([{ role: "user", content: "Hi" }]),
			{ apiKey: "super-secret-token" } as any,
		);

		await vi.waitFor(() => expect(mockLogger.error).toHaveBeenCalled());

		const logCall = JSON.stringify(mockLogger.error.mock.calls);
		expect(logCall).not.toContain("super-secret-token");
	});
});
