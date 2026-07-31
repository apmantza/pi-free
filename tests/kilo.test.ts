/**
 * Kilo extension wiring tests (native createProvider object form).
 *
 * The provider object itself is unit-tested in kilo-provider.test.ts; here we
 * mock createKiloProvider and assert the extension factory wires it up correctly:
 *   - registers the native provider via the single-arg registerProvider(provider)
 *   - participates in the global toggle (registerWithGlobalToggle)
 *   - /toggle-kilo flips show_paid and republishes via setView + re-register
 *   - model_select ToS notice + session_start handler
 *   - non-destructive credential migration inspection
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetKiloApiKey = vi.hoisted(() => vi.fn((): string | undefined => undefined));
const mockGetKiloShowPaid = vi.hoisted(() => vi.fn(() => false));
const mockSaveConfig = vi.hoisted(() =>
	vi.fn<(...args: unknown[]) => Promise<void>>(),
);
const mockRegisterWithGlobalToggle = vi.hoisted(() =>
	vi.fn<(...args: unknown[]) => void>(),
);
const mockReadStoredCredential = vi.hoisted(() =>
	vi.fn<(...args: unknown[]) => unknown>(),
);
const mockSetView = vi.hoisted(() => vi.fn());

const mockProvider = vi.hoisted(() => ({
	id: "kilo",
	name: "Kilo",
	auth: { apiKey: { name: "Kilo API key" }, oauth: { name: "Kilo" } },
	getModels: () => [],
}));
const mockStored = vi.hoisted(() => ({ free: [] as unknown[], all: [] as unknown[] }));

vi.mock("../config.ts", () => ({
	getKiloApiKey: () => mockGetKiloApiKey(),
	getKiloShowPaid: () => mockGetKiloShowPaid(),
	saveConfig: (...args: unknown[]) => mockSaveConfig(...args),
	PROVIDER_KILO: "kilo",
}));

vi.mock("../lib/registry.ts", () => ({
	registerWithGlobalToggle: (...args: unknown[]) =>
		mockRegisterWithGlobalToggle(...args),
}));

vi.mock("@earendil-works/pi-coding-agent", () => ({
	readStoredCredential: (...args: unknown[]) => mockReadStoredCredential(...args),
}));

vi.mock("../providers/kilo/kilo-provider.ts", () => ({
	createKiloProvider: () => ({
		provider: mockProvider,
		stored: mockStored,
		setView: mockSetView,
		ingest: vi.fn(),
	}),
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

describe("Kilo extension wiring", () => {
	let mockPi: ExtensionAPI;
	let mockRegisterProvider: ReturnType<typeof vi.fn>;
	let mockOn: ReturnType<typeof vi.fn>;
	let mockRegisterCommand: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.clearAllMocks();
		mockGetKiloApiKey.mockReturnValue(undefined);
		mockGetKiloShowPaid.mockReturnValue(false);
		mockStored.free = [{ id: "free-1" }];
		mockStored.all = [{ id: "free-1" }, { id: "paid-1" }];

		mockRegisterProvider = vi.fn();
		mockOn = vi.fn();
		mockRegisterCommand = vi.fn();
		mockPi = {
			registerProvider: mockRegisterProvider,
			on: mockOn,
			registerCommand: mockRegisterCommand,
		} as unknown as ExtensionAPI;
	});

	it("registers the native provider object via single-arg registerProvider", async () => {
		await kiloProvider(mockPi);
		// Single-arg native form: the provider object, no legacy config.
		expect(mockRegisterProvider).toHaveBeenCalledWith(mockProvider);
		expect(mockRegisterProvider.mock.calls[0]).toHaveLength(1);
	});

	it("performs no network I/O in the factory (models load via refreshModels)", async () => {
		await kiloProvider(mockPi);
		// The factory only builds + registers; it never awaits a fetch. The
		// provider's getModels still returns its (empty) baseline at this point.
		expect(mockProvider.getModels()).toEqual([]);
	});

	it("registers with the global toggle system (hasKey=false by default)", async () => {
		await kiloProvider(mockPi);
		expect(mockRegisterWithGlobalToggle).toHaveBeenCalledWith(
			"kilo",
			mockStored,
			expect.any(Function),
			false,
			{ native: true },
		);
	});

	it("registers with hasKey=true when an API key is configured", async () => {
		mockGetKiloApiKey.mockReturnValue("sk-kilo-test");
		await kiloProvider(mockPi);
		expect(mockRegisterWithGlobalToggle).toHaveBeenCalledWith(
			"kilo",
			mockStored,
			expect.any(Function),
			true,
			{ native: true },
		);
	});

	it("global-toggle reRegister republishes via setView + re-register (keeps native auth)", async () => {
		await kiloProvider(mockPi);
		const reRegister = mockRegisterWithGlobalToggle.mock.calls[0][2] as (
			models: unknown[],
		) => void;
		mockRegisterProvider.mockClear();

		reRegister(mockStored.all);

		expect(mockSetView).toHaveBeenCalledWith(mockStored.all);
		expect(mockRegisterProvider).toHaveBeenCalledWith(mockProvider);
	});

	describe("/toggle-kilo command", () => {
		it("flips show_paid, persists, and republishes the chosen catalog", async () => {
			await kiloProvider(mockPi);
			const call = mockRegisterCommand.mock.calls.find(
				(c) => c[0] === "toggle-kilo",
			);
			expect(call).toBeDefined();
			if (!call) throw new Error("toggle-kilo not registered");
			const notify = vi.fn();
			mockRegisterProvider.mockClear();

			await call[1].handler({}, { ui: { notify } });

			expect(mockSaveConfig).toHaveBeenCalledWith({ kilo_show_paid: true });
			expect(mockSetView).toHaveBeenCalledWith(mockStored.all);
			expect(mockRegisterProvider).toHaveBeenCalledWith(mockProvider);
			expect(notify).toHaveBeenCalledWith(
				expect.stringContaining("showing all 2 models"),
				"info",
			);
		});
	});

	describe("event handlers", () => {
		it("registers model_select, message_end, and session_start handlers", async () => {
			await kiloProvider(mockPi);
			const events = mockOn.mock.calls.map((c) => c[0]);
			expect(events).toContain("model_select");
			expect(events).toContain("message_end");
			expect(events).toContain("session_start");
		});

		it("shows a ToS notice on first Kilo model selection (no stored cred)", async () => {
			mockReadStoredCredential.mockReturnValue(undefined);
			await kiloProvider(mockPi);
			const call = mockOn.mock.calls.find((c) => c[0] === "model_select");
			if (!call) throw new Error("model_select not registered");
			const notify = vi.fn();
			await call[1]({}, { model: { provider: "kilo" }, ui: { notify } });
			expect(notify).toHaveBeenCalledWith(
				expect.stringContaining("free models shown"),
				"info",
			);
		});

		it("skips the ToS notice when an OAuth credential is stored", async () => {
			mockReadStoredCredential.mockReturnValue({
				type: "oauth",
				access: "a",
				refresh: "r",
				expires: Date.now() + 1000,
			});
			await kiloProvider(mockPi);
			const call = mockOn.mock.calls.find((c) => c[0] === "model_select");
			if (!call) throw new Error("model_select not registered");
			const notify = vi.fn();
			await call[1]({}, { model: { provider: "kilo" }, ui: { notify } });
			expect(notify).not.toHaveBeenCalled();
		});
	});

	describe("credential migration", () => {
		it("inspects stored credentials without throwing (malformed old cred)", async () => {
			mockReadStoredCredential.mockReturnValue({ type: "oauth", access: "" });
			await expect(kiloProvider(mockPi)).resolves.toBeUndefined();
			expect(mockReadStoredCredential).toHaveBeenCalledWith("kilo");
		});
	});
});
