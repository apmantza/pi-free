/**
 * NVIDIA Provider Tests
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

let capturedConfig: any = null;

vi.mock("../provider-factory.ts", () => ({
	createProvider: vi.fn(async (_pi: any, def: any) => {
		capturedConfig = def;
		// Don't call fetchModels - just capture config
		return;
	}),
}));

// Minimal mocks for imports
vi.mock("../config.ts", () => ({
	NVIDIA_API_KEY: "test-key",
	NVIDIA_SHOW_PAID: true,
	PROVIDER_NVIDIA: "nvidia",
	applyHidden: (m: any[]) => m,
}));

vi.mock("../constants.ts", () => ({
	BASE_URL_NVIDIA: "https://integrate.api.nvidia.com/v1",
	DEFAULT_FETCH_TIMEOUT_MS: 10000,
	NVIDIA_MIN_SIZE_B: 70,
	URL_MODELS_DEV: "https://models.dev/api.json",
}));

import nvidiaProvider from "../providers/nvidia.ts";

describe("NVIDIA Provider", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		capturedConfig = null;
	});

	it("should configure factory correctly", async () => {
		const mockPi = {} as ExtensionAPI;
		await nvidiaProvider(mockPi);

		expect(capturedConfig).toMatchObject({
			providerId: "nvidia",
			baseUrl: "https://integrate.api.nvidia.com/v1",
			apiKeyEnvVar: "NVIDIA_API_KEY",
			apiKeyConfigKey: "nvidia_api_key",
		});
		// Should NOT have showPaidFlag (NVIDIA filters internally)
		expect(capturedConfig.showPaidFlag).toBeUndefined();
		expect(typeof capturedConfig.fetchModels).toBe("function");
	});
});
