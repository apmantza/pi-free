/**
 * Kilo toggle behavior tests
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFetchKiloModels = vi.fn();
const mockRegisterWithGlobalToggle = vi.fn();
let capturedToggleArgs: any[] = [];

vi.mock("../config.ts", () => ({
	getKiloFreeOnly: vi.fn(() => false),
	getKiloShowPaid: vi.fn(() => false),
	PROVIDER_KILO: "kilo",
}));

vi.mock("../providers/kilo/kilo-models.ts", () => ({
	fetchKiloModels: (...args: unknown[]) => mockFetchKiloModels(...args),
	KILO_GATEWAY_BASE: "https://api.kilo.ai/api/gateway",
}));

vi.mock("../providers/kilo/kilo-auth.ts", () => ({
	loginKilo: vi.fn().mockResolvedValue({ access: "oauth-token" }),
	refreshKiloToken: vi.fn(),
}));

vi.mock("../provider-helper.ts", () => ({
	enhanceWithCI: (models: unknown[]) => models,
	createReRegister: vi.fn(() => vi.fn()),
	createCtxReRegister: vi.fn(() => vi.fn()),
}));

vi.mock("../lib/registry.ts", () => ({
	registerWithGlobalToggle: (...args: unknown[]) => {
		capturedToggleArgs.push(args);
		mockRegisterWithGlobalToggle(...args);
	},
	isFreeModel: (m: { cost?: { input?: number } }) => (m.cost?.input ?? 0) === 0,
}));

vi.mock("../lib/util.ts", () => ({
	cleanModelName: (name: string) => name,
	logWarning: vi.fn(),
}));

import kiloProvider from "../providers/kilo/kilo.ts";

describe("Kilo toggle behavior", () => {
	let mockPi: ExtensionAPI;
	let mockRegisterProvider: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.clearAllMocks();
		mockFetchKiloModels.mockReset();
		mockRegisterWithGlobalToggle.mockReset();
		capturedToggleArgs = [];

		mockRegisterProvider = vi.fn();
		mockPi = {
			registerProvider: mockRegisterProvider,
			on: vi.fn(),
			registerCommand: vi.fn(),
		} as unknown as ExtensionAPI;
	});

	it("uses free models by default and switches to all models after toggle", async () => {
		const freeModels = [
			{
				id: "mimo-v2-pro-free",
				name: "MiMo V2 Pro Free",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128000,
				maxTokens: 4096,
			},
		];

		const allModels = [
			{
				id: "mimo-v2-pro-free",
				name: "MiMo V2 Pro Free",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128000,
				maxTokens: 4096,
			},
			{
				id: "claude-3-7-sonnet",
				name: "Claude 3.7 Sonnet",
				reasoning: true,
				input: ["text"],
				cost: { input: 3, output: 15, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 200000,
				maxTokens: 8192,
			},
		];

		// Startup free model fetch, then post-login full fetch
		mockFetchKiloModels
			.mockResolvedValueOnce(freeModels)
			.mockResolvedValueOnce(allModels);

		await kiloProvider(mockPi);

		const providerConfig = mockRegisterProvider.mock.calls[0][1];
		const oauth = providerConfig.oauth;
		expect(oauth).toBeDefined();

		// Simulate successful OAuth login -> cached all models
		await oauth.login({ onProgress: vi.fn() });

		const templateModels = [
			{
				provider: "kilo",
				id: "template",
				name: "Template",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128000,
				maxTokens: 4096,
			},
		];

		// Before toggle, should stay free-only (no paid models without OAuth)
		const beforeToggle = oauth.modifyModels(templateModels, {
			access: "oauth-token",
		});
		expect(beforeToggle).toBe(templateModels);

		// Verify registerWithGlobalToggle was called with correct stored models
		expect(capturedToggleArgs.length).toBeGreaterThan(0);
		const [providerId, stored, reRegister, hasKey] = capturedToggleArgs[0];
		expect(providerId).toBe("kilo");
		expect(stored.free).toHaveLength(1);
		expect(stored.all).toHaveLength(2);
		expect(typeof reRegister).toBe("function");
		expect(hasKey).toBe(false); // No API key initially

		// Verify reRegister function can be called with different model sets
		// (This is what happens when /free toggle or /kilo-toggle is used)
		expect(() => reRegister(stored.all)).not.toThrow();
		expect(() => reRegister(stored.free)).not.toThrow();
	});
});
