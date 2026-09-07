/**
 * Global filter provider overrides — the single resolution rule behind
 * every filter decision: an explicit per-provider choice wins, otherwise
 * the global default applies. No force flags, no preservation branches.
 */
import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getModelViewOverride: vi.fn(),
	saveConfig: vi.fn(),
}));

vi.mock("../config.ts", () => ({
	getFreeOnly: () => true,
	getModelViewOverride: (providerId: string) =>
		mocks.getModelViewOverride(providerId),
	saveConfig: (...args: unknown[]) => mocks.saveConfig(...args),
}));

const freeModel: ProviderModelConfig = {
	id: "free",
	name: "Free Model",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 128000,
	maxTokens: 4096,
};

const paidModel: ProviderModelConfig = {
	id: "paid",
	name: "Paid Model",
	reasoning: false,
	input: ["text"],
	cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 128000,
	maxTokens: 4096,
};

async function loadRegistry() {
	return import("../lib/registry.ts");
}

describe("global filter provider overrides", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.resetModules();
		mocks.getModelViewOverride.mockReturnValue(undefined);
	});

	it("explicit all-override wins over global free-only", async () => {
		mocks.getModelViewOverride.mockImplementation((providerId: string) =>
			providerId === "zenmux" ? "all" : undefined,
		);
		const { applyGlobalFilter, registerWithGlobalToggle } =
			await loadRegistry();
		const reRegister = vi.fn();
		const allModels = [freeModel, paidModel];

		registerWithGlobalToggle(
			"zenmux",
			{ free: [freeModel], all: allModels },
			reRegister,
			true,
		);
		applyGlobalFilter(true);

		expect(reRegister).toHaveBeenCalledWith(allModels);
	});

	it("no override follows the global default", async () => {
		const { applyGlobalFilter, registerWithGlobalToggle } =
			await loadRegistry();
		const reRegister = vi.fn();

		registerWithGlobalToggle(
			"zenmux",
			{ free: [freeModel], all: [freeModel, paidModel] },
			reRegister,
			true,
		);
		applyGlobalFilter(true);

		expect(reRegister).toHaveBeenCalledWith([freeModel]);
	});

	it("explicit free-override wins over global-off", async () => {
		mocks.getModelViewOverride.mockReturnValue("free");
		const { applyGlobalFilter, registerWithGlobalToggle } =
			await loadRegistry();
		const reRegister = vi.fn();

		registerWithGlobalToggle(
			"zenmux",
			{ free: [freeModel], all: [freeModel, paidModel] },
			reRegister,
			true,
		);
		applyGlobalFilter(false);

		expect(reRegister).toHaveBeenCalledWith([freeModel]);
	});

	it("no override follows global-off to the all view", async () => {
		const { applyGlobalFilter, registerWithGlobalToggle } =
			await loadRegistry();
		const reRegister = vi.fn();
		const allModels = [freeModel, paidModel];

		registerWithGlobalToggle(
			"zenmux",
			{ free: [freeModel], all: allModels },
			reRegister,
			true,
		);
		applyGlobalFilter(false);

		expect(reRegister).toHaveBeenCalledWith(allModels);
	});
});

describe("resolveModelView", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.resetModules();
		mocks.getModelViewOverride.mockReturnValue(undefined);
	});

	it("returns the explicit choice when overridden", async () => {
		mocks.getModelViewOverride.mockReturnValue("all");
		const { applyGlobalFilter, resolveModelView } = await loadRegistry();
		applyGlobalFilter(true);
		expect(resolveModelView("zenmux")).toBe("all");
	});

	it("returns free for an explicit-free override under global-off", async () => {
		mocks.getModelViewOverride.mockReturnValue("free");
		const { applyGlobalFilter, resolveModelView } = await loadRegistry();
		applyGlobalFilter(false);
		expect(resolveModelView("zenmux")).toBe("free");
	});

	it("follows the global default without an override", async () => {
		const { applyGlobalFilter, resolveModelView } = await loadRegistry();
		applyGlobalFilter(true);
		expect(resolveModelView("zenmux")).toBe("free");
		applyGlobalFilter(false);
		expect(resolveModelView("zenmux")).toBe("all");
	});
});
