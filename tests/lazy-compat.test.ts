/**
 * Tests for the lazy pi-ai compat bridge (lib/lazy-compat.ts) — the riskiest
 * runtime path introduced for issue #423: it wraps every model call of the
 * providers that stream through compat, so event piping, failure surfacing,
 * abort semantics, and single-flight loading are all covered here.
 *
 * Uses the `__setCompatLoaderForTests` seam (the compat module itself is an
 * externalized node_modules dependency that vi.mock cannot intercept).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AssistantMessageEventStream } from "@earendil-works/pi-ai/compat";
import {
	__setCompatLoaderForTests,
	lazyAnthropicMessagesApi,
	lazyOpenAICompletionsApi,
} from "../lib/lazy-compat.ts";

const MODEL = {
	id: "test-model",
	name: "Test Model",
	provider: "test",
	api: "openai-completions",
	baseUrl: "https://example.test/v1",
} as never;

const CONTEXT = { systemPrompt: "", messages: [] } as never;

type FakeCompatOptions = {
	streamImpl?: (...args: unknown[]) => unknown;
	streamSimpleImpl?: (...args: unknown[]) => unknown;
	anthropicStreamImpl?: (...args: unknown[]) => unknown;
};

function makeFakeCompat(options: FakeCompatOptions) {
	const asStream = (value: unknown) => value as AssistantMessageEventStream;
	return {
		openAICompletionsApi: () => ({
			stream: (...args: unknown[]) => asStream(options.streamImpl?.(...args)),
			streamSimple: (...args: unknown[]) =>
				asStream(options.streamSimpleImpl?.(...args)),
		}),
		anthropicMessagesApi: () => ({
			stream: (...args: unknown[]) =>
				asStream(options.anthropicStreamImpl?.(...args)),
			streamSimple: (...args: unknown[]) =>
				asStream(options.anthropicStreamImpl?.(...args)),
		}),
	};
}

/** Minimal fake of pi-ai's EventStream contract (async iterable + result). */
function makeFakeStream(events: unknown[], finalResult: unknown) {
	return {
		async *[Symbol.asyncIterator]() {
			for (const event of events) {
				yield event;
				// Yield control so observers see asynchronous piping, not a
				// synchronous dump.
				await new Promise((resolve) => setTimeout(resolve, 0));
			}
		},
		result: () => Promise.resolve(finalResult),
	};
}

async function collect(
	stream: AsyncIterable<unknown> & { result(): Promise<unknown> },
): Promise<{ events: unknown[]; result: unknown }> {
	const events: unknown[] = [];
	for await (const event of stream) events.push(event);
	return { events, result: await stream.result() };
}

describe("lazy-compat bridge", () => {
	beforeEach(() => {
		__setCompatLoaderForTests(undefined);
	});

	afterEach(() => {
		__setCompatLoaderForTests(undefined);
	});

	it("returns a shell synchronously and pipes inner events in order", async () => {
		const textEvent = { type: "text", text: "hello" };
		const doneMessage = { role: "assistant", content: [] };
		const doneEvent = { type: "done", message: doneMessage };
		__setCompatLoaderForTests(async () =>
			makeFakeCompat({
				streamImpl: () => makeFakeStream([textEvent, doneEvent], doneMessage),
			}),
		);

		const streams = lazyOpenAICompletionsApi();

		// Synchronous return (the Provider contract) even though compat has
		// not loaded yet.
		const outer = streams.stream(MODEL, CONTEXT);
		expect(typeof outer.result).toBe("function");

		const { events, result } = await collect(outer as never);
		expect(events).toEqual([textEvent, doneEvent]);
		expect(result).toBe(doneMessage);
	});

	it("loads compat single-flight across concurrent streams", async () => {
		let loads = 0;
		const doneMessage = { role: "assistant", content: [] };
		__setCompatLoaderForTests(async () => {
			loads += 1;
			return makeFakeCompat({
				streamImpl: () =>
					makeFakeStream([{ type: "done", message: doneMessage }], doneMessage),
				streamSimpleImpl: () =>
					makeFakeStream([{ type: "done", message: doneMessage }], doneMessage),
			});
		});
		const streams = lazyOpenAICompletionsApi();

		const a = streams.stream(MODEL, CONTEXT);
		const b = streams.streamSimple(MODEL, CONTEXT);
		await Promise.all([collect(a as never), collect(b as never)]);

		expect(loads).toBe(1);
	});

	it("surfaces a load failure as a stream error event, not a rejection", async () => {
		__setCompatLoaderForTests(async () => {
			throw new Error("compat load failed");
		});
		const outer = lazyOpenAICompletionsApi().stream(MODEL, CONTEXT);

		const { events, result } = await collect(outer as never);
		expect(events).toHaveLength(1);
		const errorEvent = events[0] as {
			type: string;
			reason: string;
			error: { errorMessage?: string; stopReason?: string };
		};
		expect(errorEvent.type).toBe("error");
		expect(errorEvent.reason).toBe("error");
		expect(errorEvent.error.errorMessage).toBe("compat load failed");
		expect(errorEvent.error.stopReason).toBe("error");
		expect(result).toBe(errorEvent.error);
	});

	it("does not cache load failures — a later stream retries", async () => {
		let fail = true;
		const doneMessage = { role: "assistant", content: [] };
		__setCompatLoaderForTests(async () => {
			if (fail) throw new Error("compat load failed");
			return makeFakeCompat({
				streamImpl: () =>
					makeFakeStream([{ type: "done", message: doneMessage }], doneMessage),
			});
		});
		const streams = lazyOpenAICompletionsApi();

		const failed = await collect(streams.stream(MODEL, CONTEXT) as never);
		expect((failed.events[0] as { type: string }).type).toBe("error");

		fail = false;
		const retry = await collect(streams.stream(MODEL, CONTEXT) as never);
		expect(retry.result).toBe(doneMessage);
	});

	it("marks the error event aborted when the signal is already aborted", async () => {
		const controller = new AbortController();
		controller.abort();
		__setCompatLoaderForTests(async () =>
			makeFakeCompat({
				streamImpl: () => {
					throw new Error("This operation was aborted");
				},
			}),
		);

		const outer = lazyOpenAICompletionsApi().stream(MODEL, CONTEXT, {
			signal: controller.signal,
		});

		const { events } = await collect(outer as never);
		const errorEvent = events[0] as {
			type: string;
			reason: string;
			error: { stopReason?: string };
		};
		expect(errorEvent.type).toBe("error");
		expect(errorEvent.reason).toBe("aborted");
		expect(errorEvent.error.stopReason).toBe("aborted");
	});

	it("surfaces an inner-stream construction error as an error event", async () => {
		__setCompatLoaderForTests(async () =>
			makeFakeCompat({
				streamSimpleImpl: () => {
					throw new Error("boom");
				},
			}),
		);
		const outer = lazyOpenAICompletionsApi().streamSimple(MODEL, CONTEXT);

		const { events } = await collect(outer as never);
		expect(events).toHaveLength(1);
		expect((events[0] as { type: string }).type).toBe("error");
		expect(
			(events[0] as { error: { errorMessage?: string } }).error.errorMessage,
		).toBe("boom");
	});

	it("routes the anthropic selector to anthropicMessagesApi", async () => {
		const doneMessage = { role: "assistant", content: [] };
		__setCompatLoaderForTests(async () =>
			makeFakeCompat({
				anthropicStreamImpl: () =>
					makeFakeStream([{ type: "done", message: doneMessage }], doneMessage),
			}),
		);

		const outer = lazyAnthropicMessagesApi().stream(MODEL, CONTEXT);
		const { result } = await collect(outer as never);
		expect(result).toBe(doneMessage);
	});
});
