/**
 * Unit tests for the session-start native refresh nudge
 * (registerNativeProviderRefresh in lib/native-provider.ts).
 *
 * The nudge refreshes exactly the opted-in provider ids (never the whole
 * registry), ignores other providers' errors, and retries once when
 * superseded — the race that left fresh installs with an empty catalog.
 * Mocks stop at honest seams (ExtensionAPI surface, modelRegistry.refresh);
 * Pi's refresh orchestration itself is covered by the RPC session check.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockRefresh = vi.fn();

function mockCtx() {
	return {
		modelRegistry: {
			refresh: (...args: unknown[]) => mockRefresh(...args),
		},
	};
}

function mockPi() {
	const handlers: Record<string, Function> = {};
	return {
		handlers,
		on: vi.fn((event: string, handler: Function) => {
			handlers[event] = handler;
		}),
	};
}

let registerNativeProviderRefresh: (typeof import("../lib/native-provider.ts"))["registerNativeProviderRefresh"];

beforeEach(async () => {
	vi.clearAllMocks();
	vi.resetModules();
	vi.useFakeTimers();
	({ registerNativeProviderRefresh } =
		await import("../lib/native-provider.ts"));
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

async function fireSessionStart(pi: ReturnType<typeof mockPi>, ctx: unknown) {
	await pi.handlers["session_start"]!({}, ctx);
	// Flush the detached chain (refresh await + result handling).
	await vi.advanceTimersByTimeAsync(0);
}

describe("native refresh nudge", () => {
	it("refreshes only the opted-in provider ids", async () => {
		const pi = mockPi();
		registerNativeProviderRefresh(pi as never, "kilo");
		registerNativeProviderRefresh(pi as never, "kilo");
		mockRefresh.mockResolvedValue({ aborted: false, errors: new Map() });

		await fireSessionStart(pi, mockCtx());

		expect(mockRefresh).toHaveBeenCalledTimes(1);
		expect(mockRefresh).toHaveBeenCalledWith({
			allowNetwork: true,
			providers: ["kilo"],
		});
	});

	it("ignores other providers' errors (e.g. missing OPENCODE_API_KEY)", async () => {
		const pi = mockPi();
		registerNativeProviderRefresh(pi as never, "kilo");
		mockRefresh.mockResolvedValue({
			aborted: false,
			errors: new Map([
				["opencode-free", new Error("Failed to resolve API key")],
				["opencode-go", new Error("Failed to resolve API key")],
			]),
		});

		await fireSessionStart(pi, mockCtx());
		await vi.advanceTimersByTimeAsync(10_000);

		// No failure, no retry: foreign errors are noise.
		expect(mockRefresh).toHaveBeenCalledTimes(1);
	});

	it("fails loudly on its own providers' errors", async () => {
		const pi = mockPi();
		registerNativeProviderRefresh(pi as never, "kilo");
		mockRefresh.mockResolvedValue({
			aborted: false,
			errors: new Map([["kilo", new Error("boom")]]),
		});

		await fireSessionStart(pi, mockCtx());
		await vi.advanceTimersByTimeAsync(10_000);

		// Rejected task, and no retry for real errors (only aborts retry).
		expect(mockRefresh).toHaveBeenCalledTimes(1);
	});

	it("retries once when superseded, then stops", async () => {
		const pi = mockPi();
		registerNativeProviderRefresh(pi as never, "kilo");
		mockRefresh.mockResolvedValueOnce({ aborted: true, errors: new Map() });
		mockRefresh.mockResolvedValueOnce({ aborted: true, errors: new Map() });

		await fireSessionStart(pi, mockCtx());
		expect(mockRefresh).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(5000);
		expect(mockRefresh).toHaveBeenCalledTimes(2);

		// Retry exhausted: no third attempt even with more time.
		await vi.advanceTimersByTimeAsync(30_000);
		expect(mockRefresh).toHaveBeenCalledTimes(2);
	});

	it("drops a stale retry ctx quietly instead of warning", async () => {
		const pi = mockPi();
		registerNativeProviderRefresh(pi as never, "kilo");
		mockRefresh.mockResolvedValue({ aborted: true, errors: new Map() });

		let accesses = 0;
		const staleCtx = {
			get modelRegistry(): unknown {
				accesses++;
				if (accesses > 1) {
					throw new Error(
						"This extension ctx is stale after session replacement or reload.",
					);
				}
				return { refresh: (...args: unknown[]) => mockRefresh(...args) };
			},
		};
		await fireSessionStart(pi, staleCtx);
		await vi.advanceTimersByTimeAsync(10_000);

		expect(mockRefresh).toHaveBeenCalledTimes(1);
	});
});
