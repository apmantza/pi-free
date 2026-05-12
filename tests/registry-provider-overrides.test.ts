import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getProviderShowPaid: vi.fn(),
	saveConfig: vi.fn(),
}));

vi.mock("../config.ts", () => ({
	getFreeOnly: () => true,
	getProviderShowPaid: (providerId: string) =>
		mocks.getProviderShowPaid(providerId),
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

describe("global filter provider overrides", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.resetModules();
		mocks.getProviderShowPaid.mockReturnValue(false);
	});

	it("preserves a persisted provider all-models toggle during startup global free-only", async () => {
		mocks.getProviderShowPaid.mockImplementation(
			(providerId: string) => providerId === "zenmux",
		);
		const { applyGlobalFilter, registerWithGlobalToggle } = await import(
			"../lib/registry.ts"
		);
		const reRegister = vi.fn();
		const allModels = [freeModel, paidModel];

		registerWithGlobalToggle(
			"zenmux",
			{ free: [freeModel], all: allModels },
			reRegister,
			true,
		);
		applyGlobalFilter({} as ExtensionAPI, true);

		expect(reRegister).toHaveBeenCalledWith(allModels);
	});

	it("force global free-only still applies free models", async () => {
		mocks.getProviderShowPaid.mockReturnValue(true);
		const { applyGlobalFilter, registerWithGlobalToggle } = await import(
			"../lib/registry.ts"
		);
		const reRegister = vi.fn();

		registerWithGlobalToggle(
			"zenmux",
			{ free: [freeModel], all: [freeModel, paidModel] },
			reRegister,
			true,
		);
		applyGlobalFilter({} as ExtensionAPI, true, { force: true });

		expect(reRegister).toHaveBeenCalledWith([freeModel]);
	});
});
