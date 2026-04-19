/**
 * Go Provider Tests
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	delete process.env.PI_FREE_GO_API_KEY;
});

describe("Go Provider", () => {
	it("registers when only OPENCODE_API_KEY is present (fallback)", async () => {
		const mockSetupProvider = vi.fn();
		const mockFetchWithRetry = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			statusText: "OK",
			json: async () => ({ data: [{ id: "glm-5" }] }),
		});

		vi.doMock("../config.ts", () => ({
			applyHidden: (models: unknown[]) => models,
			GO_SHOW_PAID: false,
			OPENCODE_GO_API_KEY: undefined,
			OPENCODE_API_KEY: "fallback-opencode-key",
			PROVIDER_GO: "go",
		}));

		vi.doMock("../constants.ts", () => ({
			BASE_URL_GO: "https://opencode.ai/zen/go/v1",
			DEFAULT_FETCH_TIMEOUT_MS: 10000,
			URL_GO_TOS: "https://opencode.ai/terms",
		}));

		vi.doMock("../provider-helper.ts", () => ({
			setupProvider: (...args: unknown[]) => mockSetupProvider(...args),
			createCtxReRegister:
				(ctx: { modelRegistry: { registerProvider: (...args: unknown[]) => void } }, config: { providerId: string }) =>
				(models: unknown[]) => {
					ctx.modelRegistry.registerProvider(config.providerId, {
						...config,
						models,
					});
				},
		}));

		vi.doMock("../providers/model-fetcher.ts", () => ({
			fetchModelsDevMeta: vi.fn().mockResolvedValue({
				"glm-5": {
					id: "glm-5",
					name: "GLM-5",
					cost: { input: 0.5, output: 2 },
					modalities: { input: ["text"], output: ["text"] },
					limit: { context: 128000, output: 16384 },
				},
			}),
		}));

		vi.doMock("../lib/util.ts", () => ({
			fetchWithRetry: (...args: unknown[]) => mockFetchWithRetry(...args),
			logWarning: vi.fn(),
		}));

		const { default: goProvider } = await import("../providers/go/go.ts");

		const mockOn = vi.fn();
		const mockPi = {
			on: mockOn,
			registerProvider: vi.fn(),
			registerCommand: vi.fn(),
		} as unknown as ExtensionAPI;

		await goProvider(mockPi);

		expect(mockSetupProvider).toHaveBeenCalled();

		const sessionStartHandler = mockOn.mock.calls.find(
			(call) => call[0] === "session_start",
		)?.[1];
		expect(sessionStartHandler).toBeDefined();

		const mockCtx = {
			modelRegistry: {
				registerProvider: vi.fn(),
			},
		};

		await sessionStartHandler({}, mockCtx);

		expect(process.env.PI_FREE_GO_API_KEY).toBe("fallback-opencode-key");
		expect(mockCtx.modelRegistry.registerProvider).toHaveBeenCalledWith(
			"go",
			expect.objectContaining({ models: expect.any(Array) }),
		);
	});

	it("does not set up provider when no Go or OpenCode key exists", async () => {
		const mockSetupProvider = vi.fn();

		vi.doMock("../config.ts", () => ({
			applyHidden: (models: unknown[]) => models,
			GO_SHOW_PAID: false,
			OPENCODE_GO_API_KEY: undefined,
			OPENCODE_API_KEY: undefined,
			PROVIDER_GO: "go",
		}));

		vi.doMock("../constants.ts", () => ({
			BASE_URL_GO: "https://opencode.ai/zen/go/v1",
			DEFAULT_FETCH_TIMEOUT_MS: 10000,
			URL_GO_TOS: "https://opencode.ai/terms",
		}));

		vi.doMock("../provider-helper.ts", () => ({
			setupProvider: (...args: unknown[]) => mockSetupProvider(...args),
			createCtxReRegister: vi.fn(),
		}));

		vi.doMock("../providers/model-fetcher.ts", () => ({
			fetchModelsDevMeta: vi.fn(),
		}));

		vi.doMock("../lib/util.ts", () => ({
			fetchWithRetry: vi.fn(),
			logWarning: vi.fn(),
		}));

		const { default: goProvider } = await import("../providers/go/go.ts");

		const mockOn = vi.fn();
		const mockPi = {
			on: mockOn,
			registerProvider: vi.fn(),
			registerCommand: vi.fn(),
		} as unknown as ExtensionAPI;

		await goProvider(mockPi);

		expect(mockSetupProvider).not.toHaveBeenCalled();
		const sessionStartHandler = mockOn.mock.calls.find(
			(call) => call[0] === "session_start",
		)?.[1];
		expect(sessionStartHandler).toBeDefined();
	});
});
