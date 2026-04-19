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
	it("registers when API key is present", async () => {
		const mockSetupProvider = vi.fn();
		const mockReRegister = vi.fn();

		vi.doMock("../config.ts", () => ({
			applyHidden: (models: unknown[]) => models,
			GO_SHOW_PAID: false,
			OPENCODE_GO_API_KEY: "test-go-key",
			OPENCODE_API_KEY: undefined,
			PROVIDER_GO: "go",
		}));

		vi.doMock("../constants.ts", () => ({
			BASE_URL_GO: "https://opencode.ai/zen/go/v1",
			URL_GO_TOS: "https://opencode.ai/terms",
		}));

		vi.doMock("../provider-helper.ts", async () => {
			const actual = await vi.importActual("../provider-helper.ts");
			return {
				...actual,
				setupProvider: (...args: unknown[]) => mockSetupProvider(...args),
				createReRegister: () => mockReRegister,
			};
		});

		vi.doMock("../lib/logger.ts", () => ({
			createLogger: () => ({
				info: vi.fn(),
				warn: vi.fn(),
				error: vi.fn(),
				debug: vi.fn(),
			}),
		}));

		vi.doMock("../lib/util.ts", () => ({
			logWarning: vi.fn(),
		}));

		vi.doMock("../providers/opencode-session.ts", () => ({
			createOpenCodeSessionTracker: () => ({
				getSessionId: () => "test-session",
				nextRequestId: vi.fn(),
			}),
		}));

		const { default: goProvider } = await import("../providers/go/go.ts");

		const mockOn = vi.fn();
		const mockPi = {
			on: mockOn,
			registerProvider: vi.fn(),
			registerCommand: vi.fn(),
		} as unknown as ExtensionAPI;

		await goProvider(mockPi);

		// Should register immediately with static models
		expect(mockPi.registerProvider).toHaveBeenCalledWith(
			"go",
			expect.objectContaining({
				baseUrl: "https://opencode.ai/zen/go/v1",
				models: expect.any(Array),
			}),
		);

		// Should set up shared boilerplate
		expect(mockSetupProvider).toHaveBeenCalled();

		// Should register session_start handler
		const sessionStartHandler = mockOn.mock.calls.find(
			(call) => call[0] === "session_start",
		)?.[1];
		expect(sessionStartHandler).toBeDefined();
	});

	it("does not set up provider when no API key exists", async () => {
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
			URL_GO_TOS: "https://opencode.ai/terms",
		}));

		vi.doMock("../provider-helper.ts", async () => {
			const actual = await vi.importActual("../provider-helper.ts");
			return {
				...actual,
				setupProvider: (...args: unknown[]) => mockSetupProvider(...args),
			};
		});

		vi.doMock("../lib/logger.ts", () => ({
			createLogger: () => ({
				info: vi.fn(),
				warn: vi.fn(),
				error: vi.fn(),
				debug: vi.fn(),
			}),
		}));

		vi.doMock("../lib/util.ts", () => ({
			logWarning: vi.fn(),
		}));

		vi.doMock("../providers/opencode-session.ts", () => ({
			createOpenCodeSessionTracker: () => ({
				getSessionId: () => "test-session",
				nextRequestId: vi.fn(),
			}),
		}));

		const { default: goProvider } = await import("../providers/go/go.ts");

		const mockPi = {
			on: vi.fn(),
			registerProvider: vi.fn(),
			registerCommand: vi.fn(),
		} as unknown as ExtensionAPI;

		await goProvider(mockPi);

		// With no key, provider should return early without registering
		expect(mockPi.registerProvider).not.toHaveBeenCalled();
		expect(mockSetupProvider).not.toHaveBeenCalled();
	});
});
