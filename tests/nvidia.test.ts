/**
 * NVIDIA Provider Tests
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

let capturedToggleArgs: any = null;

// Model size parser (no regex — avoids SonarCloud S5852 flags)
function parseModelSizeSimple(id: string): number | null {
	const lower = id.toLowerCase();
	for (let i = 0; i < lower.length; i++) {
		if (lower[i] !== "b") continue;
		const afterB = lower.slice(i + 1);
		if (
			afterB.length > 0 &&
			((afterB[0] >= "0" && afterB[0] <= "9") || afterB[0] === ".")
		) {
			continue;
		}
		let start = i;
		while (
			start > 0 &&
			((lower[start - 1] >= "0" && lower[start - 1] <= "9") ||
				lower[start - 1] === ".")
		) {
			start--;
		}
		if (start >= i) break;
		const size = Number.parseFloat(lower.slice(start, i));
		if (!Number.isNaN(size) && size > 0) return size;
		break;
	}
	return null;
}

// Mock for toggle behavior testing
vi.mock("../provider-helper.ts", () => ({
	enhanceWithCI: (m: any[]) => m,
	createReRegister: vi.fn(() => vi.fn()),
}));

vi.mock("../lib/registry.ts", () => ({
	registerWithGlobalToggle: vi.fn((...args: any[]) => {
		capturedToggleArgs = args;
	}),
	// NVIDIA uses Route B (non-pricing-exposed): name-based detection only
	isFreeModel: (m: any) => m.name.toLowerCase().includes("free"),
	getGlobalFreeOnly: () => false,
	providerRegistry: new Map(),
}));

vi.mock("../config.ts", () => ({
	getNvidiaApiKey: vi.fn(() => "test-key"),
	getNvidiaShowPaid: vi.fn(() => true),
	PROVIDER_NVIDIA: "nvidia",
	PROVIDER_KILO: "kilo",
	applyHidden: (m: any[]) => m,
	loadConfigFile: vi.fn(() => ({ hidden_models: [] })),
	saveConfig: vi.fn(),
}));

vi.mock("../constants.ts", () => ({
	BASE_URL_NVIDIA: "https://integrate.api.nvidia.com/v1",
	DEFAULT_FETCH_TIMEOUT_MS: 10000,
	NVIDIA_MIN_SIZE_B: 70,
	URL_MODELS_DEV: "https://models.dev/api.json",
}));

vi.mock("../lib/util.ts", () => ({
	fetchWithRetry: vi.fn(),
	isUsableModel: vi.fn((id: string, minSize?: number) => {
		// Simple size check for testing
		if (minSize !== undefined) {
			const size = parseModelSizeSimple(id);
			if (size !== null && size < minSize) return false;
		}
		return true;
	}),
}));

import { fetchWithRetry } from "../lib/util.ts";
import nvidiaProvider from "../providers/nvidia/nvidia.ts";

function mockNvidiaApiResponse(modelIds: string[]) {
	return {
		ok: true,
		json: async () => ({ data: modelIds.map((id) => ({ id })) }),
	};
}

function mockModelsDevResponse(models: Record<string, any>) {
	return {
		ok: true,
		json: async () => ({
			nvidia: {
				id: "nvidia",
				api: "openai-completions",
				models,
			},
		}),
	};
}

describe("NVIDIA Provider", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		capturedToggleArgs = null;
		vi.mocked(fetchWithRetry).mockReset();
	});

	it("should include models from NVIDIA API with models.dev metadata enrichment", async () => {
		vi.mocked(fetchWithRetry).mockImplementation(async (url: string) => {
			if (url.includes("integrate.api.nvidia.com/v1/models")) {
				return mockNvidiaApiResponse([
					"nvidia/llama-3.1-70b-instruct",
					"deepseek-ai/deepseek-v4-flash",
					"nvidia/nv-embed-v1",
					"mistralai/mistral-large-3-675b-instruct-2512",
				]) as any;
			}
			if (url.includes("models.dev")) {
				return mockModelsDevResponse({
					"llama-3.1-70b-instruct": {
						id: "nvidia/llama-3.1-70b-instruct",
						name: "Llama 3.1 70B Instruct",
						reasoning: false,
						limit: { context: 128000, output: 4096 },
						modalities: { input: ["text"], output: ["text"] },
						cost: { input: 0, output: 0 },
					},
				}) as any;
			}
			throw new Error("Unexpected URL: " + url);
		});

		const mockPi = {
			registerProvider: vi.fn(),
			on: vi.fn(),
			registerCommand: vi.fn(),
		} as unknown as ExtensionAPI;

		await nvidiaProvider(mockPi);

		const registeredModels = (mockPi.registerProvider as any).mock.calls[0][1]
			.models;

		expect(
			registeredModels.some(
				(m: any) => m.id === "nvidia/llama-3.1-70b-instruct",
			),
		).toBe(true);
		expect(
			registeredModels.find(
				(m: any) => m.id === "nvidia/llama-3.1-70b-instruct",
			).name,
		).toBe("Llama 3.1 70B Instruct");
		expect(
			registeredModels.some(
				(m: any) => m.id === "deepseek-ai/deepseek-v4-flash",
			),
		).toBe(true);
		expect(
			registeredModels.some(
				(m: any) => m.id === "mistralai/mistral-large-3-675b-instruct-2512",
			),
		).toBe(true);
		expect(
			registeredModels.some((m: any) => m.id === "nvidia/nv-embed-v1"),
		).toBe(false);
	});

	it("should infer metadata for models not present in models.dev", async () => {
		vi.mocked(fetchWithRetry).mockImplementation(async (url: string) => {
			if (url.includes("integrate.api.nvidia.com/v1/models")) {
				return mockNvidiaApiResponse(["deepseek-ai/deepseek-v4-flash"]) as any;
			}
			if (url.includes("models.dev")) {
				return mockModelsDevResponse({}) as any;
			}
			throw new Error("Unexpected URL: " + url);
		});

		const mockPi = {
			registerProvider: vi.fn(),
			on: vi.fn(),
			registerCommand: vi.fn(),
		} as unknown as ExtensionAPI;

		await nvidiaProvider(mockPi);

		const registeredModels = (mockPi.registerProvider as any).mock.calls[0][1]
			.models;
		const model = registeredModels.find(
			(m: any) => m.id === "deepseek-ai/deepseek-v4-flash",
		);

		expect(model).toBeDefined();
		expect(model.name).toBe("Deepseek V4 Flash");
		expect(model.reasoning).toBe(false);
		expect(model.contextWindow).toBe(128000);
		expect(model.maxTokens).toBe(4096);
		expect(model.input).toEqual(["text"]);
		expect(model.cost.input).toBe(0);
	});

	it("should exclude non-chat models via ID heuristics", async () => {
		vi.mocked(fetchWithRetry).mockImplementation(async (url: string) => {
			if (url.includes("integrate.api.nvidia.com/v1/models")) {
				return mockNvidiaApiResponse([
					"nvidia/nv-embed-v1",
					"openai/whisper-large-v3",
					"nvidia/nemotron-parse",
					"nvidia/llama-3.1-70b-instruct",
				]) as any;
			}
			if (url.includes("models.dev")) {
				return mockModelsDevResponse({}) as any;
			}
			throw new Error("Unexpected URL: " + url);
		});

		const mockPi = {
			registerProvider: vi.fn(),
			on: vi.fn(),
			registerCommand: vi.fn(),
		} as unknown as ExtensionAPI;

		await nvidiaProvider(mockPi);

		const registeredModels = (mockPi.registerProvider as any).mock.calls[0][1]
			.models;
		expect(registeredModels.map((m: any) => m.id)).toEqual([
			"nvidia/llama-3.1-70b-instruct",
		]);
	});

	it("should include models regardless of cost (NVIDIA is not pricing-exposed)", async () => {
		vi.mocked(fetchWithRetry).mockImplementation(async (url: string) => {
			if (url.includes("integrate.api.nvidia.com/v1/models")) {
				return mockNvidiaApiResponse([
					"mistralai/mistral-large-3-675b-instruct-2512",
				]) as any;
			}
			if (url.includes("models.dev")) {
				return mockModelsDevResponse({
					"mistral-large-3-675b-instruct-2512": {
						id: "mistralai/mistral-large-3-675b-instruct-2512",
						name: "Mistral Large 3",
						reasoning: false,
						limit: { context: 256000, output: 8192 },
						modalities: { input: ["text"], output: ["text"] },
						cost: { input: 2.0, output: 6.0 },
					},
				}) as any;
			}
			throw new Error("Unexpected URL: " + url);
		});

		const mockPi = {
			registerProvider: vi.fn(),
			on: vi.fn(),
			registerCommand: vi.fn(),
		} as unknown as ExtensionAPI;

		await nvidiaProvider(mockPi);

		const registeredModels = (mockPi.registerProvider as any).mock.calls[0][1]
			.models;
		const model = registeredModels.find(
			(m: any) => m.id === "mistralai/mistral-large-3-675b-instruct-2512",
		);

		expect(model).toBeDefined();
		expect(model.cost.input).toBe(2);
		expect(model.cost.output).toBe(6);
	});

	it("should fall back to models.dev when NVIDIA API is unreachable", async () => {
		vi.mocked(fetchWithRetry).mockImplementation(async (url: string) => {
			if (url.includes("integrate.api.nvidia.com/v1/models")) {
				return { ok: false, status: 500, statusText: "Server Error" } as any;
			}
			if (url.includes("models.dev")) {
				return mockModelsDevResponse({
					"llama-3.1-70b-instruct": {
						id: "nvidia/llama-3.1-70b-instruct",
						name: "Llama 3.1 70B Instruct",
						reasoning: false,
						limit: { context: 128000, output: 4096 },
						modalities: { input: ["text"], output: ["text"] },
						cost: { input: 0, output: 0 },
					},
				}) as any;
			}
			throw new Error("Unexpected URL: " + url);
		});

		const mockPi = {
			registerProvider: vi.fn(),
			on: vi.fn(),
			registerCommand: vi.fn(),
		} as unknown as ExtensionAPI;

		await nvidiaProvider(mockPi);

		const registeredModels = (mockPi.registerProvider as any).mock.calls[0][1]
			.models;
		expect(
			registeredModels.some(
				(m: any) => m.id === "nvidia/llama-3.1-70b-instruct",
			),
		).toBe(true);
	});

	it("should filter out known 404 models", async () => {
		vi.mocked(fetchWithRetry).mockImplementation(async (url: string) => {
			if (url.includes("integrate.api.nvidia.com/v1/models")) {
				return mockNvidiaApiResponse([
					"nvidia/llama-3.1-70b-instruct",
					"aisingapore/sea-lion-7b-instruct",
					"nvidia/cosmos-reason2-8b",
					"databricks/dbrx-instruct",
				]) as any;
			}
			if (url.includes("models.dev")) {
				return mockModelsDevResponse({}) as any;
			}
			throw new Error("Unexpected URL: " + url);
		});

		const mockPi = {
			registerProvider: vi.fn(),
			on: vi.fn(),
			registerCommand: vi.fn(),
		} as unknown as ExtensionAPI;

		await nvidiaProvider(mockPi);

		const registeredModels = (mockPi.registerProvider as any).mock.calls[0][1]
			.models;
		expect(
			registeredModels.some(
				(m: any) => m.id === "nvidia/llama-3.1-70b-instruct",
			),
		).toBe(true);
		expect(
			registeredModels.some(
				(m: any) => m.id === "aisingapore/sea-lion-7b-instruct",
			),
		).toBe(false);
		expect(
			registeredModels.some((m: any) => m.id === "nvidia/cosmos-reason2-8b"),
		).toBe(false);
		expect(
			registeredModels.some((m: any) => m.id === "databricks/dbrx-instruct"),
		).toBe(false);
	});

	it("should configure provider correctly with toggle support", async () => {
		vi.mocked(fetchWithRetry).mockImplementation(async (url: string) => {
			if (url.includes("integrate.api.nvidia.com/v1/models")) {
				return mockNvidiaApiResponse(["nvidia/llama-3.1-70b-instruct"]) as any;
			}
			if (url.includes("models.dev")) {
				return mockModelsDevResponse({}) as any;
			}
			throw new Error("Unexpected URL: " + url);
		});

		const mockPi = {
			registerProvider: vi.fn(),
			on: vi.fn(),
			registerCommand: vi.fn(),
		} as unknown as ExtensionAPI;

		await nvidiaProvider(mockPi);

		expect(mockPi.registerProvider).toHaveBeenCalledWith(
			"nvidia",
			expect.objectContaining({
				baseUrl: "https://integrate.api.nvidia.com/v1",
				apiKey: "test-key",
				api: "openai-completions",
			}),
		);

		expect(capturedToggleArgs).toBeDefined();
		expect(capturedToggleArgs[0]).toBe("nvidia");
		expect(capturedToggleArgs[1]).toMatchObject({
			free: expect.any(Array),
			all: expect.any(Array),
		});
		// NVIDIA treats all models as free-tier (like Codestral/Ollama).
		// All models are accessible via free credits, no payment required.
		expect(capturedToggleArgs[1].free.length).toBe(
			capturedToggleArgs[1].all.length,
		);
		expect(capturedToggleArgs[1].all.length).toBeGreaterThan(0);
	});

	it("should treat all models as free-tier (matching Codestral/Ollama approach)", async () => {
		vi.mocked(fetchWithRetry).mockImplementation(async (url: string) => {
			if (url.includes("integrate.api.nvidia.com/v1/models")) {
				return mockNvidiaApiResponse([
					"nvidia/llama-3.1-70b-instruct",
					"nvidia/llama-3.1-free-edition",
				]) as any;
			}
			if (url.includes("models.dev")) {
				return mockModelsDevResponse({
					"llama-3.1-70b-instruct": {
						id: "nvidia/llama-3.1-70b-instruct",
						name: "Llama 3.1 70B Instruct",
						reasoning: false,
						limit: { context: 128000, output: 4096 },
						modalities: { input: ["text"], output: ["text"] },
						cost: { input: 0, output: 0 },
					},
					"llama-3.1-free-edition": {
						id: "nvidia/llama-3.1-free-edition",
						name: "Llama 3.1 Free Edition",
						reasoning: false,
						limit: { context: 128000, output: 4096 },
						modalities: { input: ["text"], output: ["text"] },
						cost: { input: 0, output: 0 },
					},
				}) as any;
			}
			throw new Error("Unexpected URL: " + url);
		});

		const mockPi = {
			registerProvider: vi.fn(),
			on: vi.fn(),
			registerCommand: vi.fn(),
		} as unknown as ExtensionAPI;

		await nvidiaProvider(mockPi);

		expect(capturedToggleArgs).toBeDefined();
		// All NVIDIA models are free-tier — both models should be in the free list.
		expect(capturedToggleArgs[1].free.length).toBe(2);
		expect(capturedToggleArgs[1].all.length).toBe(2);
	});
});
