/**
 * Regression: Qoder must read the system prompt and tools from the normalized
 * TranscriptContext (Pi 0.86+), not the removed top-level `context.systemPrompt`
 * / `context.tools`.
 *
 * Pre-fix failure: Qoder sent no system prompt and no tools.
 * Recurrence: Pi 0.86 moved the prompt/tools into the transcript's system
 * messages; the old fields are silently `undefined`.
 */
import { normalizeContext } from "@earendil-works/pi-ai";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface MockStreamShape {
	events: unknown[];
	ended: boolean;
	push(event: unknown): void;
	end(): void;
	result(): Promise<unknown>;
}

const mockLogger = vi.hoisted(() => ({
	info: vi.fn(),
	error: vi.fn(),
	warn: vi.fn(),
	debug: vi.fn(),
}));

const mockGetCachedModelConfig = vi.hoisted(() => vi.fn());

vi.mock("../lib/assistant-message-event-stream.ts", () => {
	class MockStream implements MockStreamShape {
		events: unknown[] = [];
		ended = false;
		push(event: unknown): void {
			this.events.push(event);
		}
		end(): void {
			this.ended = true;
		}
		result(): Promise<unknown> {
			return Promise.resolve({});
		}
	}
	return { AssistantMessageEventStream: MockStream };
});

vi.mock("../constants.ts", () => ({
	BASE_URL_QODER: "https://api2-v2.qoder.sh",
}));
vi.mock("../lib/logger.ts", () => ({ createLogger: () => mockLogger }));
vi.mock("../providers/qoder/models.ts", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../providers/qoder/models.ts")>();
	return {
		...actual,
		getCachedModelConfig: (...args: unknown[]) =>
			mockGetCachedModelConfig(...args),
	};
});

import { streamQoder } from "../providers/qoder/stream.ts";

const tool = {
	name: "read",
	description: "Read a file",
	parameters: { type: "object", properties: { path: { type: "string" } } },
};

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

function modelStub() {
	return {
		id: "lite",
		api: "qoder-api",
		provider: "qoder",
		input: ["text"],
	} as never;
}

describe("Qoder TranscriptContext request shape", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetCachedModelConfig.mockReturnValue(null);
		globalThis.fetch = vi.fn();
	});

	it("forwards the transcript system prompt and tool declarations", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			body: createReadableStream(["data: [DONE]\n\n"]),
		});
		globalThis.fetch = fetchMock as never;

		const context = normalizeContext({
			systemPrompt: "SYS-PROMPT",
			tools: [tool],
			messages: [{ role: "user", content: "read /etc/hostname", timestamp: 1 }],
		} as never);

		streamQoder(modelStub(), context as never, { apiKey: "sk-test" } as never);

		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled(), {
			timeout: 5000,
		});
		const init = fetchMock.mock.calls[0]?.[1] as { body: unknown };
		const body = JSON.parse(String(init.body)) as {
			messages: Array<{ role: string; content: string }>;
			tools?: Array<{ function: { name: string } }>;
		};

		expect(body.tools, "Qoder dropped the tool declarations").toHaveLength(1);
		expect(body.tools?.[0]?.function.name).toBe("read");
		expect(body.messages[0]).toEqual({
			role: "system",
			content: "SYS-PROMPT",
		});
	});
});
