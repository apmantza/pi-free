/**
 * LLM7 factory wiring tests (end-to-end: extension wiring + real native
 * provider). Mirrors tests/cline.test.ts: verifies the network-free factory,
 * native registration, keyless registration (no skip when LLM7_API_KEY is
 * unset), /toggle-llm7, the global /toggle-free re-register hook, the ToS
 * notice, and the session_start refresh nudge.
 */

import type {
	ModelsStoreEntry,
	ProviderModelsStore,
} from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetLlm7ApiKey = vi.hoisted(() =>
	vi.fn((): string | undefined => undefined),
);
const mockGetLlm7ShowPaid = vi.hoisted(() => vi.fn(() => false));
const mockGetGlobalFreeOnly = vi.hoisted(() => vi.fn(() => true));
const mockSaveConfig = vi.hoisted(() =>
	vi.fn<(...args: unknown[]) => Promise<void>>(),
);
const mockRegisterWithGlobalToggle = vi.hoisted(() =>
	vi.fn<(...args: unknown[]) => void>(),
);
const mockFetch = vi.hoisted(() => vi.fn());

let capturedToggleArgs: unknown[][] = [];

vi.mock("../config.ts", () => ({
	getLlm7ApiKey: () => mockGetLlm7ApiKey(),
	getLlm7ShowPaid: () => mockGetLlm7ShowPaid(),
	saveConfig: (...args: unknown[]) => mockSaveConfig(...args),
	applyHidden: (models: { id: string }[]) => models,
}));

vi.mock("../lib/registry.ts", () => ({
	registerWithGlobalToggle: (...args: unknown[]) => {
		capturedToggleArgs.push(args);
		mockRegisterWithGlobalToggle(...args);
	},
	getGlobalFreeOnly: () => mockGetGlobalFreeOnly(),
	getGlobalFreeOnlyForced: () => false,
	isFreeModel: (m: { cost?: { input?: number } }) => (m.cost?.input ?? 0) === 0,
}));

vi.mock("../provider-helper.ts", async () => {
	const actual = await vi.importActual<Record<string, unknown>>(
		"../provider-helper.ts",
	);
	return { ...actual, enhanceWithCI: (models: unknown[]) => models };
});

vi.mock("../lib/logger.ts", () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	}),
}));

import llm7Provider from "../providers/llm7/llm7.ts";

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

describe("LLM7 factory wiring", () => {
	let mockPi: ExtensionAPI;
	let mockRegisterProvider: ReturnType<typeof vi.fn>;
	let mockRegisterCommand: ReturnType<typeof vi.fn>;
	let mockOn: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.clearAllMocks();
		capturedToggleArgs = [];
		mockGetLlm7ApiKey.mockReturnValue(undefined);
		mockGetLlm7ShowPaid.mockReturnValue(false);
		mockGetGlobalFreeOnly.mockReturnValue(true);
		vi.stubGlobal("fetch", mockFetch);

		mockRegisterProvider = vi.fn();
		mockRegisterCommand = vi.fn();
		mockOn = vi.fn();
		mockPi = {
			registerProvider: mockRegisterProvider,
			on: mockOn,
			registerCommand: mockRegisterCommand,
		} as unknown as ExtensionAPI;
	});

	it("factory is network-free and registers the native provider empty — even with no API key", async () => {
		await llm7Provider(mockPi);

		// The factory never fetches: models load via refreshModels. Unlike the
		// legacy registration, a missing LLM7_API_KEY does NOT skip the provider.
		expect(mockFetch).not.toHaveBeenCalled();
		expect(mockRegisterProvider).toHaveBeenCalledTimes(1);
		const provider = mockRegisterProvider.mock.calls[0][0];
		expect(provider.id).toBe("llm7");
		expect(provider.getModels()).toEqual([]);
		expect(provider.auth.apiKey).toBeDefined();

		// Lifecycle handlers + toggle command registered.
		expect(mockOn).toHaveBeenCalledWith("model_select", expect.any(Function));
		expect(mockOn).toHaveBeenCalledWith("session_start", expect.any(Function));
		expect(
			mockRegisterCommand.mock.calls.some((c) => c[0] === "toggle-llm7"),
		).toBe(true);
	});

	it("registers with the global toggle (hasKey reflects LLM7_API_KEY)", async () => {
		await llm7Provider(mockPi);
		expect(capturedToggleArgs).toHaveLength(1);
		const [providerId, , , hasKey] = capturedToggleArgs[0] as [
			string,
			unknown,
			unknown,
			boolean,
		];
		expect(providerId).toBe("llm7");
		expect(hasKey).toBe(false);

		mockGetLlm7ApiKey.mockReturnValue("sk-llm7");
		capturedToggleArgs = [];
		await llm7Provider(mockPi);
		expect(
			(capturedToggleArgs[0] as [string, unknown, unknown, boolean])[3],
		).toBe(true);
	});

	it("refreshModels populates; global /toggle-free reRegister republishes the same provider", async () => {
		await llm7Provider(mockPi);
		const provider = mockRegisterProvider.mock.calls[0][0];

		expect(capturedToggleArgs).toHaveLength(1);
		const [, stored, reRegister] = capturedToggleArgs[0] as [
			string,
			{ free: unknown[]; all: unknown[] },
			() => void,
		];

		// Pi refreshes (online) -> static catalogs populate.
		await provider.refreshModels({ store: makeStore(), allowNetwork: true });
		expect(stored.all).toHaveLength(3);
		expect(stored.free).toHaveLength(2);

		// Global /toggle-free showing all -> re-register the same provider.
		mockRegisterProvider.mockClear();
		reRegister();
		expect(provider.getModels().map((m: { id: string }) => m.id)).toEqual([
			"default",
			"fast",
			"pro",
		]);
		// Re-registration reused the SAME native provider object (auth preserved).
		expect(mockRegisterProvider).toHaveBeenCalledWith(provider);

		// Global /toggle-free showing free invalidates the same provider object;
		// Pi's filterModels applies the free view to the complete catalog.
		reRegister();
		expect(provider.getModels().map((m: { id: string }) => m.id)).toEqual([
			"default",
			"fast",
			"pro",
		]);
	});

	it("/toggle-llm7 flips llm7_show_paid and shows the full catalog, then back", async () => {
		await llm7Provider(mockPi);
		const provider = mockRegisterProvider.mock.calls[0][0];
		await provider.refreshModels({ store: makeStore(), allowNetwork: true });

		const call = mockRegisterCommand.mock.calls.find(
			(c) => c[0] === "toggle-llm7",
		);
		if (!call) throw new Error("toggle-llm7 not registered");
		const notify = vi.fn();

		// First toggle: free -> all.
		await call[1].handler({}, { ui: { notify } });
		expect(mockSaveConfig).toHaveBeenCalledWith({ llm7_show_paid: true });
		expect(provider.getModels().map((m: { id: string }) => m.id)).toEqual([
			"default",
			"fast",
			"pro",
		]);
		expect(notify).toHaveBeenCalledWith(
			expect.stringContaining("showing all 3 models"),
			"info",
		);

		// Second toggle: all -> free. The complete catalog remains registered;
		// Pi's filterModels applies the free view.
		mockGetLlm7ShowPaid.mockReturnValue(true);
		notify.mockClear();
		await call[1].handler({}, { ui: { notify } });
		expect(mockSaveConfig).toHaveBeenCalledWith({ llm7_show_paid: false });
		expect(provider.getModels().map((m: { id: string }) => m.id)).toEqual([
			"default",
			"fast",
			"pro",
		]);
		expect(notify).toHaveBeenCalledWith(
			expect.stringContaining("showing 2 free models"),
			"info",
		);
	});

	it("shows the ToS notice once for keyless LLM7 selections, never with a key", async () => {
		await llm7Provider(mockPi);
		const handler = mockOn.mock.calls.find(
			(call) => call[0] === "model_select",
		)?.[1];
		expect(handler).toBeDefined();
		const notify = vi.fn();

		// Keyless: notice fires with the Terms link.
		await handler({}, { model: { provider: "llm7" }, ui: { notify } });
		expect(notify).toHaveBeenCalledWith(
			expect.stringContaining("https://llm7.io/"),
			"info",
		);

		// Only once per session.
		notify.mockClear();
		await handler({}, { model: { provider: "llm7" }, ui: { notify } });
		expect(notify).not.toHaveBeenCalled();

		// Other providers never trigger it.
		const notify2 = vi.fn();
		await handler({}, { model: { provider: "kilo" }, ui: { notify: notify2 } });
		expect(notify2).not.toHaveBeenCalled();
	});

	it("suppresses the ToS notice when LLM7_API_KEY is configured", async () => {
		mockGetLlm7ApiKey.mockReturnValue("sk-llm7");
		await llm7Provider(mockPi);
		const handler = mockOn.mock.calls.find(
			(call) => call[0] === "model_select",
		)?.[1];
		const notify = vi.fn();
		await handler({}, { model: { provider: "llm7" }, ui: { notify } });
		expect(notify).not.toHaveBeenCalled();
	});

	it("session_start nudges the model registry refresh and is safe without one", async () => {
		await llm7Provider(mockPi);
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
});
