/**
 * Qoder stream through the real seam: real stream.ts, real event stream, real
 * logger writing to a sandboxed free.log. Only `fetch` (the network boundary)
 * is stubbed.
 *
 * Recurrences (#689 review findings):
 * - usage: the OpenAI `usage` chunk was never read, so every Qoder turn
 *   reported 0 tokens.
 * - finish_reason: the raw OpenAI value was cast to StopReason, so
 *   `content_filter` reached Pi as a stop reason it does not define and the
 *   turn ended "done" with a filtered (possibly empty) answer.
 * - error body: a non-OK response body (which can echo prompt content) and a
 *   partial bearer token were written to free.log.
 * - abort: a user cancel was logged at error level as a stream failure.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	AssistantMessage,
	AssistantMessageEvent,
} from "@earendil-works/pi-ai/compat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let home: string;
const realFetch = globalThis.fetch;

beforeEach(async () => {
	home = await mkdtemp(join(tmpdir(), "pi-free-qoder-wire-"));
	vi.stubEnv("HOME", home);
	vi.stubEnv("USERPROFILE", home);
	vi.stubEnv("PI_CODING_AGENT_DIR", join(home, "agent"));
	vi.stubEnv("PI_FREE_FILE_LOG", "true");
	vi.stubEnv("PI_FREE_LOG_LEVEL", "debug");
	vi.stubEnv("PI_FREE_LOG_PATH", "free.log");
	vi.resetModules();
});

afterEach(async () => {
	globalThis.fetch = realFetch;
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
	await rm(home, { recursive: true, force: true, maxRetries: 3 });
});

function sse(chunks: unknown[]): string {
	return `${chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("")}data: [DONE]\n\n`;
}

function stubFetch(response: () => Response | Promise<Response>) {
	const fetchMock = vi.fn(async () => response());
	globalThis.fetch = fetchMock as unknown as typeof fetch;
	return fetchMock;
}

async function runTurn(options: Record<string, unknown> = {}) {
	const { streamQoder } = await import("../providers/qoder/stream.ts");
	const stream = streamQoder(
		{
			id: "lite",
			api: "qoder-api",
			provider: "qoder",
			input: ["text"],
		} as never,
		{ messages: [{ role: "user", content: "hi", timestamp: 0 }] } as never,
		{ apiKey: "dt-SECRETTOKENVALUE-Mee", ...options } as never,
	);
	const events: AssistantMessageEvent[] = [];
	for await (const event of stream as AsyncIterable<AssistantMessageEvent>) {
		events.push(event);
	}
	const last = events.at(-1) as AssistantMessageEvent;
	const message = (
		last.type === "done"
			? last.message
			: (last as { error: AssistantMessage }).error
	) as AssistantMessage;
	return { events, last, message };
}

async function readLog(): Promise<string> {
	const { flushLogsSync } = await import("../lib/logger.ts");
	flushLogsSync();
	try {
		return await readFile(join(home, ".pi", "free.log"), "utf8");
	} catch {
		return "";
	}
}

describe("Qoder stream wire handling", () => {
	it("reports token usage from the OpenAI usage chunk", async () => {
		stubFetch(
			() =>
				new Response(
					sse([
						{ choices: [{ index: 0, delta: { content: "Hello" } }] },
						{ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
						{
							choices: [],
							usage: {
								prompt_tokens: 120,
								completion_tokens: 7,
								total_tokens: 127,
								prompt_tokens_details: { cached_tokens: 20 },
							},
						},
					]),
					{ status: 200 },
				),
		);
		const { last, message } = await runTurn();
		expect(last.type).toBe("done");
		expect(message.usage).toMatchObject({
			input: 100,
			output: 7,
			cacheRead: 20,
			totalTokens: 127,
		});
	});

	it("maps content_filter to an error turn instead of passing it through", async () => {
		stubFetch(
			() =>
				new Response(
					sse([
						{ choices: [{ index: 0, delta: { content: "partial" } }] },
						{
							choices: [
								{ index: 0, delta: {}, finish_reason: "content_filter" },
							],
						},
					]),
					{ status: 200 },
				),
		);
		const { last, message } = await runTurn();
		expect(last.type).toBe("error");
		expect(message.stopReason).toBe("error");
		expect(message.errorMessage).toContain("content_filter");
	});

	it("keeps length as a Pi stop reason (boundary of the finish_reason map)", async () => {
		stubFetch(
			() =>
				new Response(
					sse([
						{ choices: [{ index: 0, delta: { content: "cut" } }] },
						{ choices: [{ index: 0, delta: {}, finish_reason: "length" }] },
					]),
					{ status: 200 },
				),
		);
		const length = await runTurn();
		expect(length.last.type).toBe("done");
		expect(length.message.stopReason).toBe("length");
	});

	it("keeps the error response body and token out of free.log", async () => {
		stubFetch(
			() =>
				new Response("echo of the user prompt: PROMPT-CONTENT-MARKER", {
					status: 400,
					statusText: "Bad Request",
				}),
		);
		const { last, message } = await runTurn();
		expect(last.type).toBe("error");
		expect(message.errorMessage).toContain("400");
		const log = await readLog();
		expect(log).toContain("API request failed");
		expect(log).not.toContain("PROMPT-CONTENT-MARKER");
		expect(log).not.toContain("Mee");
		expect(log).not.toContain("SECRET");
	});

	it("treats an abort as cancellation without an error-level log", async () => {
		const controller = new AbortController();
		stubFetch(() => {
			controller.abort();
			throw new DOMException("This operation was aborted", "AbortError");
		});
		const { last, message } = await runTurn({ signal: controller.signal });
		expect(last.type).toBe("error");
		expect(message.stopReason).toBe("aborted");
		const log = await readLog();
		expect(log).not.toMatch(/\[ERROR\][^\n]*\[qoder\]/);
	});
});
