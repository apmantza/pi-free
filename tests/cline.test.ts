/**
 * Cline factory wiring tests (end-to-end: extension wiring + real native
 * provider, network mocked). Mirrors tests/kilo-toggle.test.ts: verifies the
 * network-free factory, native registration, /toggle-cline, the global
 * /toggle-free re-register hook, task-id rotation, the session_start refresh
 * nudge, and the non-destructive credential inspection.
 */

import type {
	ModelsStoreEntry,
	ProviderModelsStore,
} from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFetchClineCatalog = vi.hoisted(() =>
	vi.fn<(...args: unknown[]) => unknown>(),
);
const mockGetClineApiKey = vi.hoisted(() => vi.fn((): string | undefined => undefined));
const mockGetClineShowPaid = vi.hoisted(() => vi.fn(() => false));
const mockGetGlobalFreeOnly = vi.hoisted(() => vi.fn(() => true));
const mockSaveConfig = vi.hoisted(() =>
	vi.fn<(...args: unknown[]) => Promise<void>>(),
);
const mockRegisterWithGlobalToggle = vi.hoisted(() =>
	vi.fn<(...args: unknown[]) => void>(),
);
const mockReadStoredCredential = vi.hoisted(() =>
	vi.fn((): unknown => undefined),
);

let capturedToggleArgs: unknown[][] = [];

vi.mock("../config.ts", () => ({
	getClineApiKey: () => mockGetClineApiKey(),
	getClineShowPaid: () => mockGetClineShowPaid(),
	saveConfig: (...args: unknown[]) => mockSaveConfig(...args),
	PROVIDER_CLINE: "cline",
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

vi.mock("../providers/cline/cline-models.ts", async () => {
	const actual = await vi.importActual<Record<string, unknown>>(
		"../providers/cline/cline-models.ts",
	);
	return {
		...actual,
		fetchClineCatalog: (...args: unknown[]) => mockFetchClineCatalog(...args),
	};
});

vi.mock("@earendil-works/pi-coding-agent", () => ({
	readStoredCredential: () => mockReadStoredCredential(),
}));

vi.mock("../lib/logger.ts", () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	}),
}));

import clineProvider from "../providers/cline/cline.ts";
import { buildClineHeaders } from "../providers/cline/cline-provider.ts";

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

describe("Cline factory wiring", () => {
	let mockPi: ExtensionAPI;
	let mockRegisterProvider: ReturnType<typeof vi.fn>;
	let mockRegisterCommand: ReturnType<typeof vi.fn>;
	let mockOn: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.clearAllMocks();
		capturedToggleArgs = [];
		mockGetClineApiKey.mockReturnValue(undefined);
		mockGetClineShowPaid.mockReturnValue(false);
		mockGetGlobalFreeOnly.mockReturnValue(true);
		mockReadStoredCredential.mockReturnValue(undefined);
		mockFetchClineCatalog.mockResolvedValue({
			all: [
				cfg({ id: "free-1" }),
				cfg({ id: "paid-1", cost: { input: 3, output: 15, cacheRead: 0, cacheWrite: 0 } }),
			],
			free: [cfg({ id: "free-1" })],
		});

		mockRegisterProvider = vi.fn();
		mockRegisterCommand = vi.fn();
		mockOn = vi.fn();
		mockPi = {
			registerProvider: mockRegisterProvider,
			on: mockOn,
			registerCommand: mockRegisterCommand,
		} as unknown as ExtensionAPI;
	});

	it("factory is network-free: registers the native provider empty", async () => {
		await clineProvider(mockPi);

		// The factory never fetches: models load via refreshModels.
		expect(mockFetchClineCatalog).not.toHaveBeenCalled();

		// Native provider object registered (single arg).
		expect(mockRegisterProvider).toHaveBeenCalledTimes(1);
		const provider = mockRegisterProvider.mock.calls[0][0];
		expect(provider.id).toBe("cline");
		expect(provider.getModels()).toEqual([]);
		expect(provider.auth.apiKey).toBeDefined();
		expect(provider.auth.oauth).toBeDefined();

		// Lifecycle handlers + toggle command registered.
		expect(mockOn).toHaveBeenCalledWith(
			"before_agent_start",
			expect.any(Function),
		);
		expect(mockOn).toHaveBeenCalledWith("session_start", expect.any(Function));
		expect(
			mockRegisterCommand.mock.calls.some((c) => c[0] === "toggle-cline"),
		).toBe(true);
	});

	it("registers with the global toggle (hasKey reflects CLINE_API_KEY)", async () => {
		await clineProvider(mockPi);
		expect(capturedToggleArgs).toHaveLength(1);
		const [providerId, , , hasKey] = capturedToggleArgs[0] as [
			string,
			unknown,
			unknown,
			boolean,
		];
		expect(providerId).toBe("cline");
		expect(hasKey).toBe(false);

		mockGetClineApiKey.mockReturnValue("sk-cline");
		capturedToggleArgs = [];
		await clineProvider(mockPi);
		expect((capturedToggleArgs[0] as [string, unknown, unknown, boolean])[3]).toBe(
			true,
		);
	});

	it("refreshModels populates; global /toggle-free reRegister republishes the same provider", async () => {
		await clineProvider(mockPi);
		const provider = mockRegisterProvider.mock.calls[0][0];

		expect(capturedToggleArgs).toHaveLength(1);
		const [, stored, reRegister] = capturedToggleArgs[0] as [
			string,
			{ free: unknown[]; all: unknown[] },
			(models: unknown[]) => void,
		];

		// Pi refreshes (online) -> public catalogs populate.
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

	it("/toggle-cline flips cline_show_paid and shows the full catalog, then back", async () => {
		await clineProvider(mockPi);
		const provider = mockRegisterProvider.mock.calls[0][0];
		await provider.refreshModels({ store: makeStore(), allowNetwork: true });

		const call = mockRegisterCommand.mock.calls.find(
			(c) => c[0] === "toggle-cline",
		);
		if (!call) throw new Error("toggle-cline not registered");
		const notify = vi.fn();

		// First toggle: free -> all.
		await call[1].handler({}, { ui: { notify } });
		expect(mockSaveConfig).toHaveBeenCalledWith({ cline_show_paid: true });
		expect(provider.getModels().map((m: { id: string }) => m.id).sort()).toEqual([
			"free-1",
			"paid-1",
		]);
		expect(notify).toHaveBeenCalledWith(
			expect.stringContaining("showing all 2 models"),
			"info",
		);

		// Second toggle: all -> free.
		mockGetClineShowPaid.mockReturnValue(true);
		notify.mockClear();
		await call[1].handler({}, { ui: { notify } });
		expect(mockSaveConfig).toHaveBeenCalledWith({ cline_show_paid: false });
		expect(provider.getModels().map((m: { id: string }) => m.id)).toEqual([
			"free-1",
		]);
		expect(notify).toHaveBeenCalledWith(
			expect.stringContaining("showing 1 free models"),
			"info",
		);
	});

	it("before_agent_start rotates the Cline task id for Cline models only", async () => {
		await clineProvider(mockPi);
		const handler = mockOn.mock.calls.find(
			(call) => call[0] === "before_agent_start",
		)?.[1];
		expect(handler).toBeDefined();

		const before = buildClineHeaders()["X-Task-ID"];
		await handler({}, { model: { provider: "cline" } });
		const after = buildClineHeaders()["X-Task-ID"];
		expect(after).not.toBe(before);
		// The rest of the VS Code-spoofing headers are unchanged.
		expect(buildClineHeaders()).toMatchObject({
			"HTTP-Referer": "https://cline.bot",
			"X-Title": "Cline",
			"X-CLIENT-TYPE": "VSCode Extension",
		});

		// A different provider does not rotate the task id.
		await handler({}, { model: { provider: "kilo" } });
		expect(buildClineHeaders()["X-Task-ID"]).toBe(after);
	});

	it("session_start nudges the model registry refresh and is safe without one", async () => {
		await clineProvider(mockPi);
		const handler = mockOn.mock.calls.find(
			(call) => call[0] === "session_start",
		)?.[1];
		expect(handler).toBeDefined();

		const refresh = vi.fn().mockResolvedValue(undefined);
		await handler({}, { modelRegistry: { refresh } });
		expect(refresh).toHaveBeenCalledWith({ allowNetwork: true });

		// No modelRegistry on the context -> safe no-op.
		await expect(handler({}, {})).resolves.toBeUndefined();
	});

	describe("non-destructive credential inspection", () => {
		it.each([
			["no stored credential", undefined],
			[
				"valid oauth credential",
				{ type: "oauth", access: "tok", refresh: "r", expires: 1 },
			],
			[
				"malformed oauth credential",
				{ type: "oauth", access: "", refresh: "r", expires: 1 },
			],
			["api key credential", { type: "api_key", key: "sk" }],
			["unrecognized credential", { type: "mystery" }],
		])("registers normally with %s", async (_label, cred) => {
			mockReadStoredCredential.mockReturnValue(cred);
			await clineProvider(mockPi);
			expect(mockRegisterProvider).toHaveBeenCalledTimes(1);
			expect(mockRegisterProvider.mock.calls[0][0].id).toBe("cline");
		});
	});
});
