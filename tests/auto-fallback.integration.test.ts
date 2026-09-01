/**
 * Integration test for lib/auto-fallback/index.ts
 *
 * Mocks the ExtensionAPI surface and emits events in the order Pi would,
 * then asserts that auto-fallback:
 *   - registers three commands (Q17 = B)
 *   - records the failure in the blacklist (Q9)
 *   - switches model via setModel at agent_settled when the run failed
 *     with a classified, recoverable error (Pi retries internally BEFORE
 *     settle — agent_settled means no further automatic retry will run)
 *   - early-returns when free-only is off (Q2)
 *
 * Mocks the registry + config so we don't touch the user's ~/.pi/free.json.
 */

// Mock config + registry so the test can run without disk I/O.
type MockFallbackConfig = {
	enabled: boolean;
	scope: "provider" | "global" | "whitelist";
	whitelistProviders: string[];
	blacklistTtlMs: number;
	blacklistMaxStrikes: number;
	notifyLevel: "silent" | "toast" | "status_bar" | "both";
	restoreMode: "manual" | "auto_next_turn" | "auto_session_end";
	autoContinue: boolean;
	autoContinueMax: number;
};
const mockGetAutoFallbackConfig = vi.fn<() => MockFallbackConfig>(() => ({
	enabled: true,
	scope: "provider" as const,
	whitelistProviders: [] as string[],
	blacklistTtlMs: 60_000,
	blacklistMaxStrikes: 3,
	notifyLevel: "silent" as const, // avoid ctx.ui in unit test
	restoreMode: "manual" as const,
	autoContinue: true,
	autoContinueMax: 3,
}));
const mockSaveConfig = vi.fn();
const mockProviderRegistry = new Map<
	string,
	{
		stored: {
			free: Array<{ id: string; name: string }>;
			all: Array<{ id: string; name: string }>;
		};
		reRegister: ReturnType<typeof vi.fn>;
	}
>();

vi.mock("../lib/auto-fallback/config.ts", () => ({
	getAutoFallbackConfig: () => mockGetAutoFallbackConfig(),
}));
vi.mock("../config.ts", () => ({
	saveConfig: (...args: unknown[]) => mockSaveConfig(...args),
}));
vi.mock("../lib/registry.ts", () => ({
	getProviderRegistry: () => mockProviderRegistry,
	isFreeModel: vi.fn(),
}));

import { afterEach, describe, it, expect, vi, beforeEach } from "vitest";
import { createAutoFallback } from "../lib/auto-fallback/index.ts";

type EventHandler = (event: unknown, ctx: unknown) => void | Promise<void>;

interface MockPi {
	on: ReturnType<typeof vi.fn>;
	setModel: ReturnType<typeof vi.fn>;
	sendUserMessage: ReturnType<typeof vi.fn>;
	registerCommand: ReturnType<typeof vi.fn>;
	commands: Record<string, { description: string; handler: Function }>;
	handlers: Record<string, EventHandler[]>;
}

function buildMockPi(_initialModel: { provider: string; id: string }): MockPi {
	// _initialModel is unused — the active model comes from buildMockCtx per event.
	const handlers: Record<string, EventHandler[]> = {};
	const commands: Record<string, { description: string; handler: Function }> =
		{};
	const pi: MockPi = {
		handlers,
		commands,
		on: vi.fn((event: string, handler: EventHandler) => {
			(handlers[event] ||= []).push(handler);
		}),
		setModel: vi.fn(async () => true),
		// Pi's top-level sendUserMessage (ExtensionAPI) — used by auto-
		// fallback's auto-continue to replay the last prompt after a switch.
		sendUserMessage: vi.fn(async () => {}),
		registerCommand: vi.fn(
			(name: string, config: { description: string; handler: Function }) => {
				commands[name] = config;
			},
		),
	};

	// Pre-register a session_start so lastSeenCtx + session_start cleanup run.
	// This is also how the real extension wires it up.
	return pi;
}

function buildMockCtx(
	currentModel: { provider: string; id: string },
	noAuthProviders: string[] = [],
) {
	// Build a flat list across all providers, stamping the provider id on
	// each model (the real Model object exposes provider via Model.provider).
	const all: Array<{ provider: string; id: string; name: string }> = [];
	for (const [providerId, entry] of mockProviderRegistry) {
		for (const m of entry.stored.all) {
			all.push({ provider: providerId, id: m.id, name: m.name });
		}
	}
	const noAuth = new Set(noAuthProviders);
	return {
		model: currentModel,
		modelRegistry: {
			getAll: () => all,
			getAvailable: () => all,
			// Mirrors pi's setModel gate: a provider with no configured auth
			// resolves to undefined and must be skipped as a fallback target.
			getProviderAuth: (provider: string) =>
				noAuth.has(provider) ? undefined : { auth: {} },
		},
		ui: {
			notify: vi.fn(),
			setStatus: vi.fn(),
		},
	};
}

async function emit(
	pi: MockPi,
	event: string,
	payload: unknown,
	ctx: unknown,
): Promise<void> {
	for (const handler of pi.handlers[event] ?? []) {
		await handler(payload, ctx);
	}
}

beforeEach(() => {
	mockProviderRegistry.clear();
	mockSaveConfig.mockClear();
	mockGetAutoFallbackConfig.mockReset();
	mockGetAutoFallbackConfig.mockReturnValue({
		enabled: true,
		scope: "provider" as const,
		whitelistProviders: [] as string[],
		blacklistTtlMs: 60_000,
		blacklistMaxStrikes: 3,
		notifyLevel: "silent" as const,
		restoreMode: "manual" as const,
		autoContinue: true,
		autoContinueMax: 3,
	});
	// Two providers with two free models each.
	const kiloFree = [
		{ id: "gpt-4o", name: "gpt-4o" },
		{ id: "claude-sonnet", name: "claude-sonnet" },
	];
	const sambanovaFree = [
		{ id: "llama-3.1-8b", name: "llama-3.1-8b" },
		{ id: "llama-3.3-70b", name: "llama-3.3-70b" },
	];
	mockProviderRegistry.set("kilo", {
		stored: { free: kiloFree, all: kiloFree },
		reRegister: vi.fn(),
	});
	mockProviderRegistry.set("sambanova", {
		stored: { free: sambanovaFree, all: sambanovaFree },
		reRegister: vi.fn(),
	});
});

afterEach(() => {
	vi.clearAllMocks();
});

describe("auto-fallback integration", () => {
	it("registers the three slash commands (Q17 = B)", () => {
		const pi = buildMockPi({ provider: "kilo", id: "gpt-4o" });
		createAutoFallback().register(
			pi as unknown as Parameters<
				ReturnType<typeof createAutoFallback>["register"]
			>[0],
		);
		expect(pi.registerCommand).toHaveBeenCalledWith(
			"toggle-auto-fallback",
			expect.objectContaining({ handler: expect.any(Function) }),
		);
		expect(pi.registerCommand).toHaveBeenCalledWith(
			"free-fallback-history",
			expect.objectContaining({ handler: expect.any(Function) }),
		);
		expect(pi.registerCommand).toHaveBeenCalledWith(
			"reset-fallback-blacklist",
			expect.objectContaining({ handler: expect.any(Function) }),
		);
	});

	it("switches model when the run settles with a classified error", async () => {
		const pi = buildMockPi({ provider: "kilo", id: "gpt-4o" });
		const handle = createAutoFallback();
		handle.register(
			pi as unknown as Parameters<
				ReturnType<typeof createAutoFallback>["register"]
			>[0],
		);

		await emit(
			pi,
			"session_start",
			{},
			buildMockCtx({ provider: "kilo", id: "gpt-4o" }),
		);
		await emit(
			pi,
			"after_provider_response",
			{ status: 429, headers: {} },
			buildMockCtx({ provider: "kilo", id: "gpt-4o" }),
		);
		await emit(
			pi,
			"message_end",
			{
				message: {
					role: "assistant",
					provider: "kilo",
					model: "gpt-4o",
					stopReason: "error",
					errorMessage: "rate limit exceeded",
				},
			},
			buildMockCtx({ provider: "kilo", id: "gpt-4o" }),
		);
		await emit(
			pi,
			"agent_settled",
			{},
			buildMockCtx({ provider: "kilo", id: "gpt-4o" }),
		);

		expect(pi.setModel).toHaveBeenCalledTimes(1);
		const status = handle.getStatus();
		expect(status.switchCount).toBe(1);
		expect(status.lastSwitchReason).toBe("error");
		expect(status.blacklistSize).toBeGreaterThanOrEqual(1);
	});

	it("does NOT switch on unrecoverable errors (Q15)", async () => {
		const pi = buildMockPi({ provider: "kilo", id: "gpt-4o" });
		const handle = createAutoFallback();
		handle.register(
			pi as unknown as Parameters<
				ReturnType<typeof createAutoFallback>["register"]
			>[0],
		);

		await emit(
			pi,
			"session_start",
			{},
			buildMockCtx({ provider: "kilo", id: "gpt-4o" }),
		);
		await emit(
			pi,
			"message_end",
			{
				message: {
					role: "assistant",
					provider: "kilo",
					model: "gpt-4o",
					stopReason: "error",
					errorMessage: "Invalid API key",
				},
			},
			buildMockCtx({ provider: "kilo", id: "gpt-4o" }),
		);
		await emit(
			pi,
			"agent_settled",
			{},
			buildMockCtx({ provider: "kilo", id: "gpt-4o" }),
		);

		expect(pi.setModel).not.toHaveBeenCalled();
	});

	it("early-returns when auto-fallback is disabled", async () => {
		mockGetAutoFallbackConfig.mockReturnValueOnce({
			enabled: false,
			scope: "provider" as const,
			whitelistProviders: [] as string[],
			blacklistTtlMs: 60_000,
			blacklistMaxStrikes: 3,
			notifyLevel: "silent" as const,
			restoreMode: "manual" as const,
			autoContinue: true,
			autoContinueMax: 3,
		});
		const pi = buildMockPi({ provider: "kilo", id: "gpt-4o" });
		const handle = createAutoFallback();
		handle.register(
			pi as unknown as Parameters<
				ReturnType<typeof createAutoFallback>["register"]
			>[0],
		);

		await emit(
			pi,
			"session_start",
			{},
			buildMockCtx({ provider: "kilo", id: "gpt-4o" }),
		);
		await emit(
			pi,
			"agent_settled",
			{},
			buildMockCtx({ provider: "kilo", id: "gpt-4o" }),
		);

		expect(pi.setModel).not.toHaveBeenCalled();
	});

	it("/toggle-auto-fallback persists the new state (Q6)", async () => {
		const pi = buildMockPi({ provider: "kilo", id: "gpt-4o" });
		createAutoFallback().register(
			pi as unknown as Parameters<
				ReturnType<typeof createAutoFallback>["register"]
			>[0],
		);

		const ctx = buildMockCtx({ provider: "kilo", id: "gpt-4o" });
		await pi.commands["toggle-auto-fallback"].handler([], ctx);
		expect(mockSaveConfig).toHaveBeenCalledWith({ auto_fallback: false });
	});

	it("/reset-fallback-blacklist clears every entry (Q10 = A escape hatch)", async () => {
		const pi = buildMockPi({ provider: "kilo", id: "gpt-4o" });
		const handle = createAutoFallback();
		handle.register(
			pi as unknown as Parameters<
				ReturnType<typeof createAutoFallback>["register"]
			>[0],
		);

		await emit(
			pi,
			"session_start",
			{},
			buildMockCtx({ provider: "kilo", id: "gpt-4o" }),
		);
		await emit(
			pi,
			"message_end",
			{
				message: {
					role: "assistant",
					provider: "kilo",
					model: "gpt-4o",
					stopReason: "error",
					errorMessage: "rate limit exceeded",
				},
			},
			buildMockCtx({ provider: "kilo", id: "gpt-4o" }),
		);
		await emit(
			pi,
			"agent_settled",
			{},
			buildMockCtx({ provider: "kilo", id: "gpt-4o" }),
		);
		const statusBefore = handle.getStatus();
		expect(statusBefore.blacklistSize).toBeGreaterThanOrEqual(1);

		const ctx = buildMockCtx({ provider: "kilo", id: "gpt-4o" });
		await pi.commands["reset-fallback-blacklist"].handler([], ctx);

		const statusAfter = handle.getStatus();
		expect(statusAfter.blacklistSize).toBe(0);
	});

	it("falls through to a global pool when the same provider has no other free model (Q-A)", async () => {
		// kilo exposes only ONE free model (the one that fails); sambanova
		// exposes another. With the default provider scope, the first
		// selection attempt finds nothing, so it must broaden to global and
		// switch to the other provider instead of silently doing nothing.
		mockProviderRegistry.clear();
		mockProviderRegistry.set("kilo", {
			stored: {
				free: [{ id: "gpt-4o", name: "gpt-4o" }],
				all: [{ id: "gpt-4o", name: "gpt-4o" }],
			},
			reRegister: vi.fn(),
		});
		mockProviderRegistry.set("sambanova", {
			stored: {
				free: [{ id: "llama-3.1-8b", name: "llama-3.1-8b" }],
				all: [{ id: "llama-3.1-8b", name: "llama-3.1-8b" }],
			},
			reRegister: vi.fn(),
		});

		const pi = buildMockPi({ provider: "kilo", id: "gpt-4o" });
		const handle = createAutoFallback();
		handle.register(
			pi as unknown as Parameters<
				ReturnType<typeof createAutoFallback>["register"]
			>[0],
		);

		await emit(
			pi,
			"session_start",
			{},
			buildMockCtx({ provider: "kilo", id: "gpt-4o" }),
		);
		await emit(
			pi,
			"message_end",
			{
				message: {
					role: "assistant",
					provider: "kilo",
					model: "gpt-4o",
					stopReason: "error",
					errorMessage: "rate limit exceeded",
				},
			},
			buildMockCtx({ provider: "kilo", id: "gpt-4o" }),
		);
		await emit(
			pi,
			"agent_settled",
			{},
			buildMockCtx({ provider: "kilo", id: "gpt-4o" }),
		);

		expect(pi.setModel).toHaveBeenCalledTimes(1);
		const switchedTo = pi.setModel.mock.calls[0][0] as {
			provider: string;
			id: string;
		};
		expect(switchedTo.provider).toBe("sambanova");
		expect(switchedTo.id).toBe("llama-3.1-8b");
	});

	it("skips candidates whose provider has no usable auth and switches to the next usable one (Q-B)", async () => {
		// kilo (failing) exposes only one free model. The global fall-through
		// pool contains `aaa` (NO auth) and `zzz` (has auth). `aaa` sorts first
		// but must be skipped, so the switch lands on `zzz`.
		mockProviderRegistry.clear();
		mockProviderRegistry.set("kilo", {
			stored: {
				free: [{ id: "gpt-4o", name: "gpt-4o" }],
				all: [{ id: "gpt-4o", name: "gpt-4o" }],
			},
			reRegister: vi.fn(),
		});
		mockProviderRegistry.set("aaa", {
			stored: {
				free: [{ id: "nokey-model", name: "nokey-model" }],
				all: [{ id: "nokey-model", name: "nokey-model" }],
			},
			reRegister: vi.fn(),
		});
		mockProviderRegistry.set("zzz", {
			stored: {
				free: [{ id: "good-model", name: "good-model" }],
				all: [{ id: "good-model", name: "good-model" }],
			},
			reRegister: vi.fn(),
		});

		const pi = buildMockPi({ provider: "kilo", id: "gpt-4o" });
		const handle = createAutoFallback();
		handle.register(
			pi as unknown as Parameters<
				ReturnType<typeof createAutoFallback>["register"]
			>[0],
		);

		await emit(
			pi,
			"session_start",
			{},
			buildMockCtx({ provider: "kilo", id: "gpt-4o" }, ["aaa"]),
		);
		await emit(
			pi,
			"message_end",
			{
				message: {
					role: "assistant",
					provider: "kilo",
					model: "gpt-4o",
					stopReason: "error",
					errorMessage: "rate limit exceeded",
				},
			},
			buildMockCtx({ provider: "kilo", id: "gpt-4o" }, ["aaa"]),
		);
		await emit(
			pi,
			"agent_settled",
			{},
			buildMockCtx({ provider: "kilo", id: "gpt-4o" }, ["aaa"]),
		);

		expect(pi.setModel).toHaveBeenCalledTimes(1);
		const switchedTo = pi.setModel.mock.calls[0][0] as {
			provider: string;
			id: string;
		};
		expect(switchedTo.provider).toBe("zzz");
		expect(switchedTo.id).toBe("good-model");
	});

	it("auto-continues by replaying the captured prompt after a switch (Q-C)", async () => {
		const pi = buildMockPi({ provider: "kilo", id: "gpt-4o" });
		createAutoFallback().register(
			pi as unknown as Parameters<
				ReturnType<typeof createAutoFallback>["register"]
			>[0],
		);

		await emit(
			pi,
			"session_start",
			{},
			buildMockCtx({ provider: "kilo", id: "gpt-4o" }),
		);
		// Capture the user's prompt via before_agent_start.
		await emit(
			pi,
			"before_agent_start",
			{ prompt: "write a poem about pi", images: [] },
			buildMockCtx({ provider: "kilo", id: "gpt-4o" }),
		);
		await emit(
			pi,
			"message_end",
			{
				message: {
					role: "assistant",
					provider: "kilo",
					model: "gpt-4o",
					stopReason: "error",
					errorMessage: "rate limit exceeded",
				},
			},
			buildMockCtx({ provider: "kilo", id: "gpt-4o" }),
		);
		// The switch + strike happen at settle time.
		await emit(
			pi,
			"agent_settled",
			{},
			buildMockCtx({ provider: "kilo", id: "gpt-4o" }),
		);
		expect(pi.setModel).toHaveBeenCalledTimes(1);

		// The auto-continue replay is dispatched on the NEXT settle (the
		// replayed run's settle, with the switched model active).
		await emit(
			pi,
			"agent_settled",
			{},
			buildMockCtx({ provider: "kilo", id: "claude-sonnet" }),
		);

		expect(pi.sendUserMessage).toHaveBeenCalledTimes(1);
		const [content, options] = pi.sendUserMessage.mock.calls[0] as [
			string | unknown[],
			{ expandPromptTemplates?: boolean } | undefined,
		];
		expect(content).toBe("write a poem about pi");
		expect(options?.expandPromptTemplates).toBe(false);
	});

	it("does not auto-continue when auto_fallback_auto_continue is disabled (Q-C)", async () => {
		mockGetAutoFallbackConfig.mockReturnValue({
			enabled: true,
			scope: "provider" as const,
			whitelistProviders: [] as string[],
			blacklistTtlMs: 60_000,
			blacklistMaxStrikes: 3,
			notifyLevel: "silent" as const,
			restoreMode: "manual" as const,
			autoContinue: false,
			autoContinueMax: 3,
		});
		const pi = buildMockPi({ provider: "kilo", id: "gpt-4o" });
		createAutoFallback().register(
			pi as unknown as Parameters<
				ReturnType<typeof createAutoFallback>["register"]
			>[0],
		);

		await emit(
			pi,
			"session_start",
			{},
			buildMockCtx({ provider: "kilo", id: "gpt-4o" }),
		);
		await emit(
			pi,
			"before_agent_start",
			{ prompt: "do thing", images: [] },
			buildMockCtx({ provider: "kilo", id: "gpt-4o" }),
		);
		await emit(
			pi,
			"message_end",
			{
				message: {
					role: "assistant",
					provider: "kilo",
					model: "gpt-4o",
					stopReason: "error",
					errorMessage: "rate limit exceeded",
				},
			},
			buildMockCtx({ provider: "kilo", id: "gpt-4o" }),
		);
		await emit(
			pi,
			"agent_settled",
			{},
			buildMockCtx({ provider: "kilo", id: "gpt-4o" }),
		);
		expect(pi.setModel).toHaveBeenCalledTimes(1);

		await emit(
			pi,
			"agent_settled",
			{},
			buildMockCtx({ provider: "kilo", id: "claude-sonnet" }),
		);

		expect(pi.sendUserMessage).not.toHaveBeenCalled();
	});

	it("stops auto-continuing once the budget is exhausted (loop guard, Q-C)", async () => {
		mockGetAutoFallbackConfig.mockReturnValue({
			enabled: true,
			scope: "global",
			whitelistProviders: [] as string[],
			blacklistTtlMs: 60_000,
			blacklistMaxStrikes: 3,
			notifyLevel: "silent",
			restoreMode: "manual",
			autoContinue: true,
			autoContinueMax: 2, // tight budget so we hit the cap quickly
		});
		const pi = buildMockPi({ provider: "kilo", id: "gpt-4o" });
		createAutoFallback().register(
			pi as unknown as Parameters<
				ReturnType<typeof createAutoFallback>["register"]
			>[0],
		);

		// Cycle 1: kilo/gpt-4o fails -> switch to kilo/claude-sonnet ->
		// auto-replay (budget 2->1).
		await emit(
			pi,
			"session_start",
			{},
			buildMockCtx({ provider: "kilo", id: "gpt-4o" }),
		);
		await emit(
			pi,
			"before_agent_start",
			{ prompt: "retry me", images: [] },
			buildMockCtx({ provider: "kilo", id: "gpt-4o" }),
		);
		await emit(
			pi,
			"message_end",
			{
				message: {
					role: "assistant",
					provider: "kilo",
					model: "gpt-4o",
					stopReason: "error",
					errorMessage: "rate limit exceeded",
				},
			},
			buildMockCtx({ provider: "kilo", id: "gpt-4o" }),
		);
		await emit(
			pi,
			"agent_settled",
			{},
			buildMockCtx({ provider: "kilo", id: "gpt-4o" }),
		);
		await emit(
			pi,
			"agent_settled",
			{},
			buildMockCtx({ provider: "kilo", id: "claude-sonnet" }),
		);
		expect(pi.sendUserMessage).toHaveBeenCalledTimes(1);
		expect(pi.setModel).toHaveBeenCalledTimes(1);

		// Cycle 2: claude-sonnet also fails -> switch to sambanova/llama ->
		// auto-replay (budget 1->0).
		await emit(
			pi,
			"message_end",
			{
				message: {
					role: "assistant",
					provider: "kilo",
					model: "claude-sonnet",
					stopReason: "error",
					errorMessage: "rate limit exceeded",
				},
			},
			buildMockCtx({ provider: "kilo", id: "claude-sonnet" }),
		);
		await emit(
			pi,
			"agent_settled",
			{},
			buildMockCtx({ provider: "kilo", id: "claude-sonnet" }),
		);
		await emit(
			pi,
			"agent_settled",
			{},
			buildMockCtx({ provider: "sambanova", id: "llama-3.1-8b" }),
		);
		expect(pi.sendUserMessage).toHaveBeenCalledTimes(2);
		expect(pi.setModel).toHaveBeenCalledTimes(2);

		// Cycle 3: sambanova/llama also fails -> switch to sambanova/70b.
		// Budget is now 0 -> NO auto-replay.
		await emit(
			pi,
			"message_end",
			{
				message: {
					role: "assistant",
					provider: "sambanova",
					model: "llama-3.1-8b",
					stopReason: "error",
					errorMessage: "rate limit exceeded",
				},
			},
			buildMockCtx({ provider: "sambanova", id: "llama-3.1-8b" }),
		);
		await emit(
			pi,
			"agent_settled",
			{},
			buildMockCtx({ provider: "sambanova", id: "llama-3.1-8b" }),
		);
		await emit(
			pi,
			"agent_settled",
			{},
			buildMockCtx({ provider: "sambanova", id: "llama-3.3-70b" }),
		);
		expect(pi.sendUserMessage).toHaveBeenCalledTimes(2); // still 2, no third replay
		expect(pi.setModel).toHaveBeenCalledTimes(3); // switch still happens
	});

	it("resets the auto-continue budget when the fallback model recovers (Q-C)", async () => {
		const pi = buildMockPi({ provider: "kilo", id: "gpt-4o" });
		createAutoFallback().register(
			pi as unknown as Parameters<
				ReturnType<typeof createAutoFallback>["register"]
			>[0],
		);

		await emit(
			pi,
			"session_start",
			{},
			buildMockCtx({ provider: "kilo", id: "gpt-4o" }),
		);
		await emit(
			pi,
			"before_agent_start",
			{ prompt: "hello", images: [] },
			buildMockCtx({ provider: "kilo", id: "gpt-4o" }),
		);

		// First failure -> switch to claude-sonnet + auto-replay.
		await emit(
			pi,
			"message_end",
			{
				message: {
					role: "assistant",
					provider: "kilo",
					model: "gpt-4o",
					stopReason: "error",
					errorMessage: "rate limit exceeded",
				},
			},
			buildMockCtx({ provider: "kilo", id: "gpt-4o" }),
		);
		await emit(
			pi,
			"agent_settled",
			{},
			buildMockCtx({ provider: "kilo", id: "gpt-4o" }),
		);
		await emit(
			pi,
			"agent_settled",
			{},
			buildMockCtx({ provider: "kilo", id: "claude-sonnet" }),
		);
		expect(pi.sendUserMessage).toHaveBeenCalledTimes(1);

		// Successful run on claude-sonnet (no error message) -> recovery
		// path resets budget to max.
		await emit(
			pi,
			"message_end",
			{
				message: {
					role: "assistant",
					provider: "kilo",
					model: "claude-sonnet",
					stopReason: "stop",
				},
			},
			buildMockCtx({ provider: "kilo", id: "claude-sonnet" }),
		);
		await emit(
			pi,
			"agent_settled",
			{},
			buildMockCtx({ provider: "kilo", id: "claude-sonnet" }),
		);

		// New, independent failure later -> switch + auto-replay again
		// (budget was reset by recovery).
		await emit(
			pi,
			"before_agent_start",
			{ prompt: "hello again", images: [] },
			buildMockCtx({ provider: "kilo", id: "claude-sonnet" }),
		);
		await emit(
			pi,
			"message_end",
			{
				message: {
					role: "assistant",
					provider: "kilo",
					model: "claude-sonnet",
					stopReason: "error",
					errorMessage: "rate limit exceeded",
				},
			},
			buildMockCtx({ provider: "kilo", id: "claude-sonnet" }),
		);
		await emit(
			pi,
			"agent_settled",
			{},
			buildMockCtx({ provider: "kilo", id: "claude-sonnet" }),
		);
		// The switch lands on sambanova; its settle dispatches the replay.
		await emit(
			pi,
			"agent_settled",
			{},
			buildMockCtx({ provider: "sambanova", id: "llama-3.1-8b" }),
		);
		expect(pi.sendUserMessage).toHaveBeenCalledTimes(2);
	});
});
