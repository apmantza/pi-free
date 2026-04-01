/**
 * Mistral Provider Tests
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

let capturedConfig: any = null;
let capturedHook: Function | null = null;

vi.mock("../config.ts", () => ({
	MISTRAL_API_KEY: "test-mistral-key",
	MISTRAL_SHOW_PAID: false,
	PROVIDER_MISTRAL: "mistral",
	applyHidden: (models: any[]) => models,
}));

vi.mock("../constants.ts", () => ({
	BASE_URL_MISTRAL: "https://api.mistral.ai/v1",
}));

vi.mock("../provider-helper.ts", () => ({
	createReRegister: vi.fn(() => vi.fn()),
	setupProvider: vi.fn(),
}));

vi.mock("../provider-factory.ts", () => ({
	createProvider: vi.fn(async (pi: any, def: any) => {
		capturedConfig = def;
		// Capture the beforeProviderRequest hook if provided
		if (def.beforeProviderRequest) {
			capturedHook = def.beforeProviderRequest;
			// Also register it via pi.on
			(pi.on as Function)("before_provider_request", (event: any) => {
				const payload = event.payload as Record<string, unknown>;
				return def.beforeProviderRequest(payload);
			});
		}
	}),
}));

vi.mock("../lib/logger.ts", () => ({
	createLogger: () => ({
		warn: vi.fn(),
		info: vi.fn(),
		debug: vi.fn(),
		error: vi.fn(),
	}),
}));

import mistralProvider from "../providers/mistral.ts";

describe("Mistral Provider", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		capturedConfig = null;
		capturedHook = null;
	});

	describe("initialization", () => {
		it("should configure factory correctly", async () => {
			const mockPi = {
				registerProvider: vi.fn(),
				on: vi.fn(),
			} as unknown as ExtensionAPI;

			await mistralProvider(mockPi);

			expect(capturedConfig).toMatchObject({
				providerId: "mistral",
				baseUrl: "https://api.mistral.ai/v1",
				apiKeyEnvVar: "MISTRAL_API_KEY",
				apiKeyConfigKey: "mistral_api_key",
			});
		});

		it("should include beforeProviderRequest hook", async () => {
			const mockPi = {
				registerProvider: vi.fn(),
				on: vi.fn(),
			} as unknown as ExtensionAPI;

			await mistralProvider(mockPi);

			expect(capturedConfig.beforeProviderRequest).toBeDefined();
			expect(typeof capturedConfig.beforeProviderRequest).toBe("function");
		});
	});

	describe("payload filtering", () => {
		it("should filter to only allowed fields for Mistral requests", async () => {
			const mockPi = {
				registerProvider: vi.fn(),
				on: vi.fn(),
			} as unknown as ExtensionAPI;

			await mistralProvider(mockPi);

			const mistralPayload = {
				model: "mistral-large-latest",
				messages: [{ role: "user", content: "Hello" }],
				temperature: 0.7,
				max_tokens: 100,
				unsupported_field: "should be removed",
				another_bad_field: 123,
			};

			const result = capturedHook?.(mistralPayload);

			expect(result).toEqual({
				model: "mistral-large-latest",
				messages: [{ role: "user", content: "Hello" }],
				temperature: 0.7,
				max_tokens: 100,
			});
			expect(result.unsupported_field).toBeUndefined();
		});

		it("should not filter requests from other providers", async () => {
			const mockPi = {
				registerProvider: vi.fn(),
				on: vi.fn(),
			} as unknown as ExtensionAPI;

			await mistralProvider(mockPi);

			const otherPayload = {
				model: "gpt-4",
				messages: [{ role: "user", content: "Hello" }],
				temperature: 0.7,
			};

			const result = capturedHook?.(otherPayload);

			// Should return undefined to let payload through unchanged
			expect(result).toBeUndefined();
		});
	});
});
