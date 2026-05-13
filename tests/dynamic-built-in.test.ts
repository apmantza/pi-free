import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	fetchOpenRouterCompatibleModels: vi.fn(),
	registerWithGlobalToggle: vi.fn(),
}));

vi.mock("../config.ts", () => ({
	getCerebrasApiKey: () => undefined,
	getFastrouterApiKey: () => undefined,
	getFastrouterShowPaid: () => false,
	getGroqApiKey: () => undefined,
	getHfToken: () => undefined,
	getMistralApiKey: () => undefined,
	getOpencodeApiKey: () => undefined,
	getOpencodeShowPaid: () => false,
	getOpenrouterApiKey: () => undefined,
	getOpenrouterShowPaid: () => false,
	getXaiApiKey: () => undefined,
	saveConfig: vi.fn(),
}));

vi.mock("../providers/model-fetcher.ts", () => ({
	fetchOpenRouterCompatibleModels: (...args: unknown[]) =>
		mocks.fetchOpenRouterCompatibleModels(...args),
}));

vi.mock("../lib/registry.ts", () => ({
	isFreeModel: (model: { name: string }) =>
		model.name.toLowerCase().includes("free"),
	registerWithGlobalToggle: (...args: unknown[]) =>
		mocks.registerWithGlobalToggle(...args),
}));

vi.mock("../provider-helper.ts", () => ({
	enhanceWithCI: (models: unknown[]) => models,
}));

describe("dynamic built-in providers", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("awaits dynamic discovery before setup resolves", async () => {
		let resolveModels!: (models: unknown[]) => void;
		mocks.fetchOpenRouterCompatibleModels.mockReturnValue(
			new Promise((resolve) => {
				resolveModels = resolve;
			}),
		);

		const registerProvider = vi.fn();
		const registerCommand = vi.fn();
		const on = vi.fn();
		const pi = {
			registerProvider,
			registerCommand,
			on,
		} as unknown as ExtensionAPI;

		const { setupDynamicBuiltInProviders } = await import(
			"../providers/dynamic-built-in/index.ts"
		);

		let resolved = false;
		const setupPromise = setupDynamicBuiltInProviders(pi).then(() => {
			resolved = true;
		});

		await Promise.resolve();
		expect(resolved).toBe(false);
		expect(registerProvider).not.toHaveBeenCalled();

		resolveModels([
			{
				id: "free-model",
				name: "Free Model",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128000,
				maxTokens: 4096,
			},
		]);
		await setupPromise;

		expect(resolved).toBe(true);
		expect(registerProvider).toHaveBeenCalledWith(
			"fastrouter",
			expect.objectContaining({
				apiKey: "FASTROUTER_API_KEY",
				models: [expect.objectContaining({ id: "free-model" })],
			}),
		);
	});
});
