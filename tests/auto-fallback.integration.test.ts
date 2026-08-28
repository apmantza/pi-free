/**
 * Integration test for lib/auto-fallback/index.ts
 *
 * Mocks the ExtensionAPI surface and emits events in the order Pi would,
 * then asserts that auto-fallback:
 *   - registers three commands (Q17 = B)
 *   - records the failure in the blacklist (Q9)
 *   - switches model via setModel when agent_end fires with willRetry:false
 *   - does NOT switch when willRetry:true (Q30 = B; Pi still trying)
 *   - early-returns when free-only is off (Q2)
 *
 * Mocks the registry + config so we don't touch the user's ~/.pi/free.json.
 */

// Mock config + registry so the test can run without disk I/O.
const mockGetAutoFallbackConfig = vi.fn(() => ({
	enabled: true,
	scope: "provider" as const,
	whitelistProviders: [] as string[],
	blacklistTtlMs: 60_000,
	blacklistMaxStrikes: 3,
	notifyLevel: "silent" as const, // avoid ctx.ui in unit test
	restoreMode: "manual" as const,
}));
const mockSaveConfig = vi.fn();
const mockProviderRegistry = new Map<string, {
	stored: { free: Array<{ id: string; name: string }>; all: Array<{ id: string; name: string }> };
	reRegister: ReturnType<typeof vi.fn>;
}>();

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

interface EventHandler {
	(event: unknown, ctx: unknown): void | Promise<void>;
}

interface MockPi {
	on: ReturnType<typeof vi.fn>;
	setModel: ReturnType<typeof vi.fn>;
	registerCommand: ReturnType<typeof vi.fn>;
	commands: Record<string, { description: string; handler: Function }>;
	handlers: Record<string, EventHandler[]>;
}

function buildMockPi(initialModel: { provider: string; id: string }): MockPi {
	const handlers: Record<string, EventHandler[]> = {};
	const commands: Record<string, { description: string; handler: Function }> = {};
	const pi: MockPi = {
		handlers,
		commands,
		on: vi.fn((event: string, handler: EventHandler) => {
			(handlers[event] ||= []).push(handler);
		}),
		setModel: vi.fn(async () => true),
		registerCommand: vi.fn((name: string, config: { description: string; handler: Function }) => {
			commands[name] = config;
		}),
	};

	// Pre-register a session_start so lastSeenCtx + session_start cleanup run.
	// This is also how the real extension wires it up.
	return pi;
}

function buildMockCtx(currentModel: { provider: string; id: string }) {
	// Build a flat list across all providers, stamping the provider id on
	// each model (the real Model object exposes provider via Model.provider).
	const all: Array<{ provider: string; id: string; name: string }> = [];
	for (const [providerId, entry] of mockProviderRegistry) {
		for (const m of entry.stored.all) {
			all.push({ provider: providerId, id: m.id, name: m.name });
		}
	}
	return {
		model: currentModel,
		modelRegistry: {
			getAll: () => all,
			getAvailable: () => all,
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
		createAutoFallback().register(pi as unknown as Parameters<ReturnType<typeof createAutoFallback>["register"]>[0]);
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

	it("switches model when agent_end fires with willRetry=false and an error message", async () => {
		const pi = buildMockPi({ provider: "kilo", id: "gpt-4o" });
		const handle = createAutoFallback();
		handle.register(pi as unknown as Parameters<ReturnType<typeof createAutoFallback>["register"]>[0]);

		await emit(pi, "session_start", {}, buildMockCtx({ provider: "kilo", id: "gpt-4o" }));
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
			"agent_end",
			{
				willRetry: false,
				turnIndex: 1,
				messages: [
					{
						provider: "kilo",
						model: "gpt-4o",
						stopReason: "error",
						errorMessage: "rate limit exceeded",
					},
				],
			},
			buildMockCtx({ provider: "kilo", id: "gpt-4o" }),
		);

		expect(pi.setModel).toHaveBeenCalledTimes(1);
		const status = handle.getStatus();
		expect(status.switchCount).toBe(1);
		expect(status.lastSwitchReason).toBe("error");
		expect(status.blacklistSize).toBeGreaterThanOrEqual(1);
	});

	it("does NOT switch when agent_end fires with willRetry=true (Pi still trying)", async () => {
		const pi = buildMockPi({ provider: "kilo", id: "gpt-4o" });
		const handle = createAutoFallback();
		handle.register(pi as unknown as Parameters<ReturnType<typeof createAutoFallback>["register"]>[0]);

		await emit(pi, "session_start", {}, buildMockCtx({ provider: "kilo", id: "gpt-4o" }));
		await emit(
			pi,
			"agent_end",
			{
				willRetry: true,
				turnIndex: 1,
				messages: [
					{
						provider: "kilo",
						model: "gpt-4o",
						stopReason: "error",
						errorMessage: "rate limit exceeded",
					},
				],
			},
			buildMockCtx({ provider: "kilo", id: "gpt-4o" }),
		);

		expect(pi.setModel).not.toHaveBeenCalled();
	});

	it("does NOT switch on unrecoverable errors (Q15)", async () => {
		const pi = buildMockPi({ provider: "kilo", id: "gpt-4o" });
		const handle = createAutoFallback();
		handle.register(pi as unknown as Parameters<ReturnType<typeof createAutoFallback>["register"]>[0]);

		await emit(pi, "session_start", {}, buildMockCtx({ provider: "kilo", id: "gpt-4o" }));
		await emit(
			pi,
			"agent_end",
			{
				willRetry: false,
				turnIndex: 1,
				messages: [
					{
						provider: "kilo",
						model: "gpt-4o",
						stopReason: "error",
						errorMessage: "Invalid API key",
					},
				],
			},
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
		});
		const pi = buildMockPi({ provider: "kilo", id: "gpt-4o" });
		const handle = createAutoFallback();
		handle.register(pi as unknown as Parameters<ReturnType<typeof createAutoFallback>["register"]>[0]);

		await emit(pi, "session_start", {}, buildMockCtx({ provider: "kilo", id: "gpt-4o" }));
		await emit(
			pi,
			"agent_end",
			{
				willRetry: false,
				turnIndex: 1,
				messages: [
					{
						provider: "kilo",
						model: "gpt-4o",
						stopReason: "error",
						errorMessage: "rate limit exceeded",
					},
				],
			},
			buildMockCtx({ provider: "kilo", id: "gpt-4o" }),
		);

		expect(pi.setModel).not.toHaveBeenCalled();
	});

	it("/toggle-auto-fallback persists the new state (Q6)", async () => {
		const pi = buildMockPi({ provider: "kilo", id: "gpt-4o" });
		createAutoFallback().register(pi as unknown as Parameters<ReturnType<typeof createAutoFallback>["register"]>[0]);

		const ctx = buildMockCtx({ provider: "kilo", id: "gpt-4o" });
		await pi.commands["toggle-auto-fallback"].handler([], ctx);
		expect(mockSaveConfig).toHaveBeenCalledWith({ auto_fallback: false });
	});

	it("/reset-fallback-blacklist clears every entry (Q10 = A escape hatch)", async () => {
		const pi = buildMockPi({ provider: "kilo", id: "gpt-4o" });
		const handle = createAutoFallback();
		handle.register(pi as unknown as Parameters<ReturnType<typeof createAutoFallback>["register"]>[0]);

		await emit(pi, "session_start", {}, buildMockCtx({ provider: "kilo", id: "gpt-4o" }));
		await emit(
			pi,
			"after_provider_response",
			{ status: 429, headers: {} },
			buildMockCtx({ provider: "kilo", id: "gpt-4o" }),
		);
		const statusBefore = handle.getStatus();
		expect(statusBefore.blacklistSize).toBeGreaterThanOrEqual(1);

		const ctx = buildMockCtx({ provider: "kilo", id: "gpt-4o" });
		await pi.commands["reset-fallback-blacklist"].handler([], ctx);

		const statusAfter = handle.getStatus();
		expect(statusAfter.blacklistSize).toBe(0);
	});
});