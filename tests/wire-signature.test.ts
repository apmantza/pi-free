import { beforeEach, describe, expect, it, vi } from "vitest";

const mockDebug = vi.hoisted(() => vi.fn());

vi.mock("../lib/logger.ts", () => ({
	createLogger: () => ({
		debug: mockDebug,
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	}),
}));

import { logWireSignature } from "../lib/wire-signature.ts";

beforeEach(() => {
	mockDebug.mockReset();
});

describe("wire-signature logging (M3, #437)", () => {
	it("logs the request contract with header NAMES only — never values (redaction)", () => {
		logWireSignature({
			id: "nvidia/nemotron-3.5-lightning:free",
			provider: "cline",
			api: "openai-completions",
			baseUrl: "https://api.cline.bot/api/v1",
			headers: {
				"X-Task-ID": "super-secret-task-id",
				Authorization: "Bearer workos:very-secret-token",
			},
		});

		expect(mockDebug).toHaveBeenCalledTimes(1);
		const [message, data] = mockDebug.mock.calls[0];
		expect(message).toContain("agent request contract");
		expect(data.provider).toBe("cline");
		expect(data.model).toBe("nvidia/nemotron-3.5-lightning:free");
		expect(data.api).toBe("openai-completions");
		expect(data.baseUrl).toBe("https://api.cline.bot/api/v1");
		expect(data.headerNames).toEqual(
			expect.arrayContaining(["X-Task-ID", "Authorization"]),
		);

		// The log line must never contain header VALUES (secrets stay out of
		// the shared ~/.pi/free.log).
		const serialized = JSON.stringify(data);
		expect(serialized).not.toContain("super-secret-task-id");
		expect(serialized).not.toContain("workos:very-secret-token");
		expect(serialized).not.toContain("Bearer");
	});

	it("merges provider-level header names via the registry lookup", () => {
		logWireSignature(
			{
				id: "m-1",
				provider: "kilo",
				api: "openai-completions",
				baseUrl: "https://gateway.kilo.chat/v1",
				headers: { "X-Task-ID": "rotating" },
			},
			() => ({ headers: { "User-Agent": "pi-free-providers" } }),
		);

		const data = mockDebug.mock.calls[0][1];
		expect(data.headerNames).toEqual(
			expect.arrayContaining(["User-Agent", "X-Task-ID"]),
		);
		// The provider lookup result's VALUES are never logged either.
		expect(JSON.stringify(data)).not.toContain("pi-free-providers");
	});

	it("is a no-op for models with no headers and never throws", () => {
		expect(() =>
			logWireSignature({
				id: "m",
				provider: "prov",
				api: "openai-completions",
				baseUrl: "https://example.test",
			}),
		).not.toThrow();
		expect(mockDebug).toHaveBeenCalledTimes(1);
		expect(mockDebug.mock.calls[0][1].headerNames).toEqual([]);
	});
});
