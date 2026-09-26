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
let recordNativeRefreshOk: (typeof import("../lib/startup-timing.ts"))["recordNativeRefreshOk"];

beforeEach(async () => {
	vi.clearAllMocks();
	vi.resetModules();
	vi.useFakeTimers();
	({ registerNativeProviderRefresh } =
		await import("../lib/native-provider.ts"));
	// Same fresh module instance the nudge reads its completion stamps from
	// (a static import would bind the pre-reset copy and be invisible).
	({ recordNativeRefreshOk } = await import("../lib/startup-timing.ts"));
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

	it("opts in every provider on a shared runner, with one handler (#551)", async () => {
		// Recurrence this prevents: the once-per-runner guard returned before
		// adding the provider id, so only the first registrant (kilo) ever
		// entered the nudge scope and later catalogs (e.g. zenmux) stayed on
		// their pre-fix stale store — non-chat entries survived the #551
		// filter because the refresh that would have dropped them never ran.
		const pi = mockPi();
		registerNativeProviderRefresh(pi as never, "kilo");
		registerNativeProviderRefresh(pi as never, "zenmux");
		registerNativeProviderRefresh(pi as never, "cline");
		mockRefresh.mockResolvedValue({ aborted: false, errors: new Map() });

		await fireSessionStart(pi, mockCtx());

		expect(mockRefresh).toHaveBeenCalledTimes(1);
		expect(mockRefresh).toHaveBeenCalledWith({
			allowNetwork: true,
			providers: ["kilo", "zenmux", "cline"],
		});
		// One session_start handler per runner — no re-registration storm.
		expect(pi.on).toHaveBeenCalledTimes(1);
	});

	it("ignores other providers' errors (e.g. missing OPENCODE_API_KEY)", async () => {
		const pi = mockPi();
		registerNativeProviderRefresh(pi as never, "kilo");
		mockRefresh.mockImplementation(async () => {
			// Own provider completed (refresh-ok stamp); foreign errors are noise.
			recordNativeRefreshOk("kilo", 62);
			return {
				aborted: false,
				errors: new Map([
					["opencode-free", new Error("Failed to resolve API key")],
					["opencode-go", new Error("Failed to resolve API key")],
				]),
			};
		});

		await fireSessionStart(pi, mockCtx());
		await vi.advanceTimersByTimeAsync(10_000);

		// No failure, no retry: foreign errors are noise and kilo completed.
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

	it("retries an aborted refresh with backoff, then stops", async () => {
		// TLC RefreshB: 1 initial + 3 retries against the storm budget;
		// afterwards the catalogs stay as-is until the next refresh.
		const pi = mockPi();
		registerNativeProviderRefresh(pi as never, "kilo");
		mockRefresh.mockResolvedValue({ aborted: true, errors: new Map() });

		await fireSessionStart(pi, mockCtx());
		expect(mockRefresh).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(5000);
		expect(mockRefresh).toHaveBeenCalledTimes(2);

		await vi.advanceTimersByTimeAsync(15_000);
		expect(mockRefresh).toHaveBeenCalledTimes(3);

		await vi.advanceTimersByTimeAsync(30_000);
		expect(mockRefresh).toHaveBeenCalledTimes(4);

		// Attempts exhausted: no fifth attempt even with more time.
		await vi.advanceTimersByTimeAsync(60_000);
		expect(mockRefresh).toHaveBeenCalledTimes(4);
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

describe("nudge completion check (TLC RefreshB)", () => {
	it("retries a clean refresh when scoped providers recorded no completion", async () => {
		// Recurrence this prevents: Pi swallows per-provider aborts, so
		// refresh() returns clean with 0 models published (the infron
		// 2-aborts signature, 2026-09-26). A clean result with no completion
		// stamp must retry, never log clean.
		const pi = mockPi();
		registerNativeProviderRefresh(pi as never, "nudge-incomplete");
		// Clean result, but no provider recorded refresh-ok or empty-retain.
		mockRefresh.mockResolvedValue({ aborted: false, errors: new Map() });

		await fireSessionStart(pi, mockCtx());
		expect(mockRefresh).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(5000);
		expect(mockRefresh).toHaveBeenCalledTimes(2);
	});

	it("does not retry a clean refresh when providers completed", async () => {
		// Guard: a healthy refresh must not burn backoff attempts. Passes on
		// the pre-fix code too (which never retried on clean); it pins the
		// no-over-retry direction of the completion check.
		const pi = mockPi();
		registerNativeProviderRefresh(pi as never, "nudge-complete");
		mockRefresh.mockImplementation(async () => {
			recordNativeRefreshOk("nudge-complete", 7);
			return { aborted: false, errors: new Map() };
		});

		await fireSessionStart(pi, mockCtx());
		await vi.advanceTimersByTimeAsync(60_000);
		expect(mockRefresh).toHaveBeenCalledTimes(1);
	});

	it("drops an obsolete retry when a newer session started", async () => {
		// Recurrence this prevents: a reload creates a new runner while the
		// old retry timer is still in flight (same process, ctx still
		// valid); both scoped refreshes then abort each other. The older
		// epoch must stand down.
		const pi = mockPi();
		registerNativeProviderRefresh(pi as never, "nudge-epoch");
		mockRefresh.mockResolvedValue({ aborted: true, errors: new Map() });

		await fireSessionStart(pi, mockCtx()); // epoch 1, refresh #1
		await fireSessionStart(pi, mockCtx()); // epoch 2, refresh #2
		expect(mockRefresh).toHaveBeenCalledTimes(2);

		await vi.advanceTimersByTimeAsync(5000);
		// Only epoch 2's retry fires; epoch 1's is obsolete.
		expect(mockRefresh).toHaveBeenCalledTimes(3);
	});
});

describe("registration forwarding (re-publish contract)", () => {
	it("always republishes, even for the same provider object", async () => {
		// Pi's registerNativeProvider wrapper does more than setProvider:
		// it syncs the /model snapshot from live getModels() and runs an
		// offline refresh. Skipping identical references was investigated
		// and reverted — re-publish is load-bearing (see the kilo/cline/llm7
		// reRegister wiring tests). The abort storm it contributes is
		// absorbed by the nudge's bounded backoff instead (TLC RefreshB).
		const { registerNativeProvider } =
			await import("../lib/native-provider.ts");
		const pi = { registerProvider: vi.fn() };
		const provider = { id: "nudge-same", getModels: () => [] };
		registerNativeProvider(pi as never, provider as never);
		registerNativeProvider(pi as never, provider as never);
		expect(pi.registerProvider).toHaveBeenCalledTimes(2);
	});

	it("still registers a rebuilt provider object for the same id", async () => {
		// Guard: the skip is reference-identity only. A rebuilt object may
		// carry new models and must always reach Pi.
		const { registerNativeProvider } =
			await import("../lib/native-provider.ts");
		const pi = { registerProvider: vi.fn() };
		registerNativeProvider(
			pi as never,
			{
				id: "nudge-rebuilt",
				getModels: () => [],
			} as never,
		);
		registerNativeProvider(
			pi as never,
			{
				id: "nudge-rebuilt",
				getModels: () => [],
			} as never,
		);
		expect(pi.registerProvider).toHaveBeenCalledTimes(2);
	});
});
