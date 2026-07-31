/**
 * Kilo toggle interop tests (end-to-end: extension wiring + real native provider,
 * network mocked). Verifies /toggle-kilo and the global /toggle-free re-register
 * hook both drive the native provider's visible catalog without dropping auth.
 */

import type {
	ModelsStoreEntry,
	ProviderModelsStore,
} from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFetchKiloCatalog = vi.hoisted(() =>
	vi.fn<(...args: unknown[]) => unknown>(),
);
const mockGetKiloApiKey = vi.hoisted(() => vi.fn((): string | undefined => undefined));
const mockGetKiloShowPaid = vi.hoisted(() => vi.fn(() => false));
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

vi.mock("@earendil-works/pi-coding-agent", () => ({
	readStoredCredential: () => undefined,
}));

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

function makeStore(): ProviderModelsStore {
	let entry: ModelsStoreEntry | undefined;
	return {
		read: async () => entry,
		write: async (e: ModelsStoreEntry) => {
			entry = e;
		},
		delete: async () => {
			entry = undefined;
		},
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
		mockGetKiloFreeOnly.mockReturnValue(false);
		mockGetGlobalFreeOnly.mockReturnValue(true);
		mockFetchKiloCatalog.mockResolvedValue({
			all: [cfg({ id: "free-1" }), cfg({ id: "paid-1", cost: { input: 3, output: 15, cacheRead: 0, cacheWrite: 0 } })],
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

	it("factory registers empty; refreshModels populates; toggle republishes", async () => {
		await kiloProvider(mockPi);

		// Native provider object registered (single arg).
		const provider = mockRegisterProvider.mock.calls[0][0];
		expect(provider.id).toBe("kilo");
		expect(provider.getModels()).toEqual([]);

		// Global toggle hook captured with mutable stored catalogs.
		expect(capturedToggleArgs).toHaveLength(1);
		const [providerId, stored, reRegister, hasKey] = capturedToggleArgs[0] as [
			string,
			{ free: unknown[]; all: unknown[] },
			(models: unknown[]) => void,
			boolean,
		];
		expect(providerId).toBe("kilo");
		expect(hasKey).toBe(false);

		// Pi refreshes (online) -> catalogs populate.
		await provider.refreshModels({ store: makeStore(), allowNetwork: true });
		expect(stored.all).toHaveLength(2);
		expect(stored.free).toHaveLength(1);

		// Global /toggle-free showing all -> reRegister(stored.all).
		mockRegisterProvider.mockClear();
		reRegister(stored.all);
		expect(provider.getModels().map((m: { id: string }) => m.id).sort()).toEqual([
			"free-1",
			"paid-1",
		]);
		// Re-registration reused the SAME native provider object (auth preserved).
		expect(mockRegisterProvider).toHaveBeenCalledWith(provider);

		// Global /toggle-free showing free -> reRegister(stored.free).
		reRegister(stored.free);
		expect(provider.getModels().map((m: { id: string }) => m.id)).toEqual([
			"free-1",
		]);
	});

	it("/toggle-kilo flips show_paid and shows the full catalog", async () => {
		await kiloProvider(mockPi);
		const provider = mockRegisterProvider.mock.calls[0][0];
		await provider.refreshModels({ store: makeStore(), allowNetwork: true });

		const call = mockRegisterCommand.mock.calls.find(
			(c) => c[0] === "toggle-kilo",
		);
		if (!call) throw new Error("toggle-kilo not registered");
		const notify = vi.fn();
		await call[1].handler({}, { ui: { notify } });

		expect(mockSaveConfig).toHaveBeenCalledWith({ kilo_show_paid: true });
		expect(provider.getModels().map((m: { id: string }) => m.id).sort()).toEqual([
			"free-1",
			"paid-1",
		]);
		expect(notify).toHaveBeenCalledWith(
			expect.stringContaining("showing all 2 models"),
			"info",
		);
	});
});
