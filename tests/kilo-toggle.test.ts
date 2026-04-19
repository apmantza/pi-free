/**
 * Kilo toggle behavior tests
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFetchKiloModels = vi.fn();
const mockSetupProvider = vi.fn();

vi.mock("../config.ts", () => ({
	KILO_FREE_ONLY: false,
	KILO_SHOW_PAID: false,
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
	setupProvider: (...args: unknown[]) => mockSetupProvider(...args),
	createReRegister: vi.fn(() => vi.fn()),
	createCtxReRegister: vi.fn(() => vi.fn()),
}));

vi.mock("../usage/widget.ts", () => ({
	registerUsageWidget: vi.fn(),
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
		mockSetupProvider.mockReset();

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

		// Before toggle, should stay free-only
		const beforeToggle = oauth.modifyModels(templateModels, { access: "oauth-token" });
		expect(beforeToggle).toBe(templateModels);

		const setupConfig = mockSetupProvider.mock.calls[0][1];
		const stored = mockSetupProvider.mock.calls[0][2];
		expect(stored.all).toHaveLength(2);
		expect(stored.free).toHaveLength(1);

		// Simulate /kilo-toggle -> paid mode
		setupConfig.reRegister(stored.all);

		const afterToggle = oauth.modifyModels(templateModels, { access: "oauth-token" });
		expect(afterToggle).not.toBe(templateModels);
		expect(afterToggle.map((m: { id: string }) => m.id)).toEqual(
			expect.arrayContaining(["mimo-v2-pro-free", "claude-3-7-sonnet"]),
		);

		// Toggle back to free mode
		setupConfig.reRegister(stored.free);
		const afterToggleBack = oauth.modifyModels(templateModels, {
			access: "oauth-token",
		});
		expect(afterToggleBack).toBe(templateModels);
	});
});
