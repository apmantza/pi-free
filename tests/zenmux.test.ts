import type {
	ModelsStoreEntry,
	ProviderModelsStore,
} from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetZenmuxApiKey = vi.hoisted(() =>
	vi.fn((): string | undefined => undefined),
);
const mockGetZenmuxShowPaid = vi.hoisted(() => vi.fn(() => false));
const mockGetGlobalFreeOnly = vi.hoisted(() => vi.fn(() => true));
const mockSaveConfig = vi.hoisted(() =>
	vi.fn<(...args: unknown[]) => Promise<void>>(),
);
const mockRegisterWithGlobalToggle = vi.hoisted(() => vi.fn());

vi.mock("../config.ts", () => ({
	getZenmuxApiKey: () => mockGetZenmuxApiKey(),
	getZenmuxShowPaid: () => mockGetZenmuxShowPaid(),
	applyHidden: (models: { id: string }[]) => models,
	saveConfig: (...args: unknown[]) => mockSaveConfig(...args),
}));

vi.mock("../lib/registry.ts", () => ({
	registerWithGlobalToggle: (...args: unknown[]) =>
		mockRegisterWithGlobalToggle(...args),
	getGlobalFreeOnly: () => mockGetGlobalFreeOnly(),
	getGlobalFreeOnlyForced: () => false,
	isFreeModel: (model: { cost?: { input?: number; output?: number } }) =>
		(model.cost?.input ?? 0) === 0 && (model.cost?.output ?? 0) === 0,
}));

vi.mock("../lib/model-metadata.ts", () => ({
	safeEnrichModelsWithModelsDev: async <T>(models: T[]) => models,
}));

vi.mock("../lib/provider-compat.ts", () => ({
	getProxyModelCompat: () => undefined,
}));

vi.mock("../lib/util.ts", () => ({
	fetchWithRetry: vi.fn(),
}));

vi.mock("../provider-helper.ts", async () => {
	const actual = await vi.importActual<Record<string, unknown>>(
		"../provider-helper.ts",
	);
	return {
		...actual,
		enhanceWithCI: (models: unknown[]) => models,
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

import zenmuxProvider from "../providers/zenmux/zenmux.ts";

function makeStore(): ProviderModelsStore {
	const entry: ModelsStoreEntry | undefined = undefined;
	return {
		read: async () => entry,
		write: async () => {},
		delete: async () => {},
	};
}

describe("ZenMux native factory", () => {
	let mockPi: ExtensionAPI;
	let registerProvider: ReturnType<typeof vi.fn>;
	let registerCommand: ReturnType<typeof vi.fn>;
	let on: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.clearAllMocks();
		mockGetZenmuxApiKey.mockReturnValue(undefined);
		mockGetZenmuxShowPaid.mockReturnValue(false);
		mockGetGlobalFreeOnly.mockReturnValue(true);
		registerProvider = vi.fn();
		registerCommand = vi.fn();
		on = vi.fn();
		mockPi = {
			registerProvider,
			registerCommand,
			on,
		} as unknown as ExtensionAPI;
	});

	it("registers a native provider without a key but does no network work", async () => {
		await zenmuxProvider(mockPi);

		expect(registerProvider).toHaveBeenCalledTimes(1);
		const provider = registerProvider.mock.calls[0][0];
		expect(provider.id).toBe("zenmux");
		expect(provider.auth.apiKey).toBeDefined();
		expect(provider.getModels()).toEqual([]);
		expect(registerCommand).toHaveBeenCalledWith(
			"toggle-zenmux",
			expect.any(Object),
		);
		expect(on).toHaveBeenCalledWith("session_start", expect.any(Function));
	});

	it("passes keyed-provider state to the global toggle registry", async () => {
		mockGetZenmuxApiKey.mockReturnValue("sk-zenmux");
		await zenmuxProvider(mockPi);
		const args = mockRegisterWithGlobalToggle.mock.calls[0];
		expect(args[0]).toBe("zenmux");
		expect(args[3]).toBe(true);
	});

	it("re-registers the same native provider object on the global toggle", async () => {
		await zenmuxProvider(mockPi);
		const provider = registerProvider.mock.calls[0][0];
		const reRegister = mockRegisterWithGlobalToggle.mock.calls[0][2] as (
			models: unknown[],
		) => void;

		reRegister([]);
		expect(registerProvider).toHaveBeenLastCalledWith(provider);
	});

	it("wires the toggle and session refresh handlers", async () => {
		await zenmuxProvider(mockPi);
		const toggle = registerCommand.mock.calls.find(
			(call) => call[0] === "toggle-zenmux",
		);
		if (!toggle) throw new Error("toggle-zenmux was not registered");
		await toggle[1].handler({}, { ui: { notify: vi.fn() } });
		expect(mockSaveConfig).toHaveBeenCalledWith({ zenmux_show_paid: true });

		const sessionStart = on.mock.calls.find(
			(call) => call[0] === "session_start",
		)?.[1];
		const refresh = vi.fn().mockResolvedValue(undefined);
		await sessionStart({}, { modelRegistry: { refresh } });
		expect(refresh).toHaveBeenCalledWith({ allowNetwork: true });
		await expect(sessionStart({}, {})).resolves.toBeUndefined();
	});

	it("does not perform model refresh work during factory registration", async () => {
		await zenmuxProvider(mockPi);
		const provider = registerProvider.mock.calls[0][0];
		await provider.refreshModels?.({
			store: makeStore(),
			allowNetwork: false,
		});
		expect(provider.getModels()).toEqual([]);
	});
});
