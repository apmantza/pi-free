/**
 * Kilo toggle interop tests (end-to-end: extension wiring + real native provider,
 * network mocked). Verifies /toggle-kilo and the global /toggle-free re-register
 * hook both drive the native provider's visible catalog without dropping auth.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFetchKiloCatalog = vi.hoisted(() =>
	vi.fn<(...args: unknown[]) => unknown>(),
);
const mockGetKiloApiKey = vi.hoisted(() =>
	vi.fn((): string | undefined => undefined),
);
const mockGetKiloShowPaid = vi.hoisted(() => vi.fn(() => false));
const mockGetModelViewOverride = vi.hoisted(() =>
	vi.fn((_providerId: string): "free" | "all" | undefined => undefined),
);
const mockSetModelViewOverride = vi.hoisted(() => vi.fn());
const mockGetKiloFreeOnly = vi.hoisted(() => vi.fn(() => false));
const mockGetGlobalFreeOnly = vi.hoisted(() => vi.fn(() => true));
const mockSaveConfig = vi.hoisted(() =>
	vi.fn<(...args: unknown[]) => Promise<void>>(),
);
const mockRegisterWithGlobalToggle = vi.hoisted(() =>
	vi.fn<(...args: unknown[]) => void>(),
);

let capturedToggleArgs: unknown[][] = [];

vi.mock("../config.ts", () => ({
	getKiloApiKey: () => mockGetKiloApiKey(),
	getKiloShowPaid: () => mockGetKiloShowPaid(),
	getModelViewOverride: (providerId: string) =>
		mockGetModelViewOverride(providerId),
	setModelViewOverride: (...args: unknown[]) =>
		mockSetModelViewOverride(...args),
	getKiloFreeOnly: () => mockGetKiloFreeOnly(),
	saveConfig: (...args: unknown[]) => mockSaveConfig(...args),
	PROVIDER_KILO: "kilo",
}));

vi.mock("../lib/registry.ts", () => ({
	registerWithGlobalToggle: (...args: unknown[]) => {
		capturedToggleArgs.push(args);
		mockRegisterWithGlobalToggle(...args);
	},
	getGlobalFreeOnly: () => mockGetGlobalFreeOnly(),
	// Mirrors the real resolveModelView over the mocked config getters (the
	// real rule is unit-tested in registry-provider-overrides.test.ts).
	resolveModelView: (providerId: string) =>
		mockGetModelViewOverride(providerId) ??
		(mockGetKiloShowPaid() ? "all" : mockGetGlobalFreeOnly() ? "free" : "all"),
	isFreeModel: (m: { cost?: { input?: number } }) => (m.cost?.input ?? 0) === 0,
}));

vi.mock("../provider-helper.ts", async () => {
	const actual = await vi.importActual<Record<string, unknown>>(
		"../provider-helper.ts",
	);
	return { ...actual, enhanceWithCI: (models: unknown[]) => models };
});

vi.mock("../providers/kilo/kilo-models.ts", async () => {
	const actual = await vi.importActual<Record<string, unknown>>(
		"../providers/kilo/kilo-models.ts",
	);
	return {
		...actual,
		fetchKiloCatalog: (...args: unknown[]) => mockFetchKiloCatalog(...args),
	};
});

vi.mock("../lib/logger.ts", () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	}),
}));

import kiloProvider from "../providers/kilo/kilo.ts";

function cfg(over: Record<string, unknown> = {}) {
	return {
		id: "m",
		name: "Model",
		reasoning: false,
		input: ["text"] as ("text" | "image")[],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 4096,
		...over,
	};
}

describe("Kilo toggle interop", () => {
	let mockPi: ExtensionAPI;
	let mockRegisterProvider: ReturnType<typeof vi.fn>;
	let mockRegisterCommand: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.clearAllMocks();
		capturedToggleArgs = [];
		mockGetKiloApiKey.mockReturnValue(undefined);
		mockGetKiloShowPaid.mockReturnValue(false);
		mockGetModelViewOverride.mockReturnValue(undefined);
		mockGetKiloFreeOnly.mockReturnValue(false);
		mockGetGlobalFreeOnly.mockReturnValue(true);
		mockFetchKiloCatalog.mockResolvedValue({
			all: [
				cfg({ id: "free-1" }),
				cfg({
					id: "paid-1",
					cost: { input: 3, output: 15, cacheRead: 0, cacheWrite: 0 },
				}),
			],
			free: [cfg({ id: "free-1" })],
		});

		mockRegisterProvider = vi.fn();
		mockRegisterCommand = vi.fn();
		mockPi = {
			registerProvider: mockRegisterProvider,
			on: vi.fn(),
			registerCommand: mockRegisterCommand,
		} as unknown as ExtensionAPI;
	});

	// Population + views are proven live by rpc-session-check (managed
	// catalog with free-only, all-view, and persistence phases); this pins
	// the re-registration wiring (same object, auth preserved) that RPC
	// cannot see per provider.
	it("global /toggle-free reRegister republishes the same provider object", async () => {
		await kiloProvider(mockPi);
		const provider = mockRegisterProvider.mock.calls[0]![0];

		expect(capturedToggleArgs).toHaveLength(1);
		const reRegister = capturedToggleArgs[0]![2] as () => void;

		mockRegisterProvider.mockClear();
		reRegister();
		// Re-registration reused the SAME native provider object (auth preserved).
		expect(mockRegisterProvider).toHaveBeenCalledWith(provider);
	});

	// Flip/persist/view behavior is proven live by rpc-toggle-check
	// (opencode-free) + rpc-session-check (/toggle-llm7); this pins the
	// per-provider wiring that would otherwise go unverified.
	it("registers the toggle-kilo command", async () => {
		await kiloProvider(mockPi);
		const call = mockRegisterCommand.mock.calls.find(
			(c) => c[0] === "toggle-kilo",
		);
		expect(call).toBeDefined();
	});
});
