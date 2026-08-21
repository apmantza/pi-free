import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getQoderShowPaid: vi.fn(() => false),
	registerNativeProvider: vi.fn(),
	registerNativeProviderRefresh: vi.fn(),
	registerNativeProviderToggle: vi.fn(),
	registerWithGlobalToggle: vi.fn(),
	restoreNativeProviderModels: vi.fn(async (..._args: unknown[]) => undefined),
	// Mirrors the real shared skeleton (restore → allowNetwork gate → fetch →
	// empty-retain → persist) on top of the spied restore/persist fns.
	refreshNativeProviderModels: vi.fn(
		async (
			providerId: string,
			context: { allowNetwork?: boolean },
			onRestore: (m: unknown[]) => void,
			fetchModels: () => Promise<unknown[]>,
			onFetched: (m: unknown[]) => void,
		) => {
			await mocks.restoreNativeProviderModels(providerId, context, onRestore);
			if (!context.allowNetwork) return;
			const models = await fetchModels();
			if (models.length === 0) return;
			await mocks.persistNativeProviderModels(providerId, context, models, () =>
				onFetched(models),
			);
		},
	),
	persistNativeProviderModels: vi.fn(async (..._args: unknown[]) => undefined),
	filterNativeModels: vi.fn(
		(...args: unknown[]) => (args[1] as readonly unknown[]) ?? [],
	),
	qoderAuth: {
		oauth: {
			name: "Qoder (Browser OAuth / PAT)",
			login: vi.fn(),
			refresh: vi.fn(),
			toAuth: vi.fn(),
		},
	},
}));

vi.mock("../config.ts", () => ({
	getProviderShowPaid: () => mocks.getQoderShowPaid(),
}));

vi.mock("../lib/registry.ts", () => ({
	registerWithGlobalToggle: (...args: unknown[]) =>
		mocks.registerWithGlobalToggle(...args),
}));

vi.mock("../lib/native-provider.ts", () => ({
	filterNativeModels: (...args: unknown[]) => mocks.filterNativeModels(...args),
	persistNativeProviderModels: (...args: unknown[]) =>
		mocks.persistNativeProviderModels(...args),
	registerNativeProvider: (...args: unknown[]) =>
		mocks.registerNativeProvider(...args),
	registerNativeProviderRefresh: (...args: unknown[]) =>
		mocks.registerNativeProviderRefresh(...args),
	registerNativeProviderToggle: (...args: unknown[]) =>
		mocks.registerNativeProviderToggle(...args),
	restoreNativeProviderModels: (...args: unknown[]) =>
		mocks.restoreNativeProviderModels(...args),
	refreshNativeProviderModels: (
		...args: Parameters<typeof mocks.refreshNativeProviderModels>
	) => mocks.refreshNativeProviderModels(...args),
}));

vi.mock("../provider-helper.ts", () => ({
	enhanceWithCI: (models: unknown[]) => models,
}));

vi.mock("../providers/qoder/auth.ts", () => ({
	qoderAuth: mocks.qoderAuth,
}));

import qoderProvider from "../providers/qoder/qoder.ts";
import { isBasicModel, staticModels } from "../providers/qoder/models.ts";

function getRegisteredProvider(): any {
	return mocks.registerNativeProvider.mock.calls[0]?.[1];
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.getQoderShowPaid.mockReturnValue(false);
});

describe("Qoder model classification", () => {
	it("classifies basic router models correctly", () => {
		for (const id of ["auto", "ultimate", "performance", "efficient", "lite"]) {
			const model = staticModels.find((entry) => entry.id === id);
			expect(model).toBeDefined();
			expect(isBasicModel(model!)).toBe(true);
		}
	});

	it("classifies premium named models as non-basic", () => {
		for (const id of ["qmodel", "dmodel", "kmodel", "mmodel"]) {
			const model = staticModels.find((entry) => entry.id === id);
			expect(model).toBeDefined();
			expect(isBasicModel(model!)).toBe(false);
		}
	});
});

describe("Qoder native provider", () => {
	const pi = {} as ExtensionAPI;

	it("registers the complete catalog through Pi's native provider API", async () => {
		await qoderProvider(pi);

		const provider = getRegisteredProvider();
		expect(provider).toMatchObject({
			id: "qoder",
			name: "Qoder",
			baseUrl: "https://api2-v2.qoder.sh",
		});
		expect(provider.getModels()).toHaveLength(staticModels.length);
		expect(provider.getModels()).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "auto", api: "qoder-api" }),
				expect.objectContaining({ id: "qmodel", api: "qoder-api" }),
			]),
		);
		expect(provider.auth).toBe(mocks.qoderAuth);
		expect(provider.stream).toEqual(expect.any(Function));
		expect(provider.streamSimple).toEqual(expect.any(Function));
		expect(mocks.registerNativeProviderRefresh).toHaveBeenCalledWith(pi, "qoder");
	});

	it("keeps the basic catalog in the global toggle state", async () => {
		await qoderProvider(pi);

		const stored = mocks.registerWithGlobalToggle.mock.calls[0]?.[1];
		expect(stored.free).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "auto" }),
				expect.objectContaining({ id: "lite" }),
			]),
		);
		expect(stored.all).toHaveLength(staticModels.length);
		expect(mocks.registerWithGlobalToggle.mock.calls[0]?.[4]).toMatchObject({
			native: true,
			invalidate: expect.any(Function),
		});
	});

	it("filters to basic models by default and can expose paid models", async () => {
		await qoderProvider(pi);
		const provider = getRegisteredProvider();
		const models = provider.getModels();

		provider.filterModels(models, undefined);
		expect(mocks.filterNativeModels).toHaveBeenLastCalledWith(
			"qoder",
			models,
			expect.objectContaining({ showPaid: false }),
		);

		mocks.getQoderShowPaid.mockReturnValue(true);
		provider.filterModels(models, undefined);
		expect(mocks.filterNativeModels).toHaveBeenLastCalledWith(
			"qoder",
			models,
			expect.objectContaining({ showPaid: true }),
		);
	});

	it("registers the native per-provider toggle and refresh hook", async () => {
		await qoderProvider(pi);

		expect(mocks.registerNativeProviderToggle).toHaveBeenCalledWith(
			pi,
			expect.objectContaining({
				providerId: "qoder",
				stored: expect.any(Object),
				getShowPaid: expect.any(Function),
				reRegister: expect.any(Function),
			}),
		);
		const provider = getRegisteredProvider();
		const reRegister = mocks.registerNativeProviderToggle.mock.calls[0][1]
			.reRegister as () => void;
		mocks.registerNativeProvider.mockClear();
		reRegister();
		expect(mocks.registerNativeProvider).toHaveBeenCalledWith(pi, provider);
	});

	it("restores offline catalogs without persisting a network refresh", async () => {
		await qoderProvider(pi);
		const provider = getRegisteredProvider();
		const context = {
			store: { read: vi.fn(), write: vi.fn(), delete: vi.fn() },
			allowNetwork: false,
			signal: new AbortController().signal,
		};

		await provider.refreshModels(context);
		expect(mocks.restoreNativeProviderModels).toHaveBeenCalledWith(
			"qoder",
			context,
			expect.any(Function),
		);
		expect(mocks.persistNativeProviderModels).not.toHaveBeenCalled();
	});
});
