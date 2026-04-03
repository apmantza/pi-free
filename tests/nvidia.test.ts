/**
 * NVIDIA Provider Tests
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelsDevModel, ModelsDevProvider } from "../lib/types.ts";

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

	describe("model filtering logic", () => {
		// Helper to simulate the filtering logic from fetchNvidiaModels
		function filterModels(models: ModelsDevModel[]): ModelsDevModel[] {
			return models
				.filter((m) => {
					// Size filtering (from isUsableModel with NVIDIA_MIN_SIZE_B = 70)
					const sizeMatch = m.id.match(/(\d+(?:\.\d+)?)b(?!\w)/i);
					if (sizeMatch) {
						const size = Number.parseFloat(sizeMatch[1]);
						if (size < 70) return false;
					}
					return true;
				})
				.filter((m) => {
					// Modalities filtering - non-chat models
					const modalities = m.modalities;
					if (modalities) {
						const output = modalities.output ?? [];
						const input = modalities.input ?? [];
						if (!output.includes("text")) return false;
						if (!input.includes("text")) return false;
					}
					return true;
				})
				.filter((m) => {
					// Cost filtering
					if ((m.cost?.input ?? 0) > 0) return false;
					return true;
				});
		}

		it("should include chat models with text input/output", () => {
			const models: ModelsDevModel[] = [
				{
					id: "test/chat-70b",
					name: "Chat Model",
					reasoning: false,
					limit: { context: 128000, output: 4096 },
					modalities: { input: ["text"], output: ["text"] },
					cost: { input: 0, output: 0 },
				},
			];
			const filtered = filterModels(models);
			expect(filtered).toHaveLength(1);
			expect(filtered[0].id).toBe("test/chat-70b");
		});

		it("should include vision models (text+image input, text output)", () => {
			const models: ModelsDevModel[] = [
				{
					id: "test/vision-70b",
					name: "Vision Model",
					reasoning: false,
					limit: { context: 128000, output: 4096 },
					modalities: { input: ["text", "image"], output: ["text"] },
					cost: { input: 0, output: 0 },
				},
			];
			const filtered = filterModels(models);
			expect(filtered).toHaveLength(1);
			expect(filtered[0].id).toBe("test/vision-70b");
		});

		it("should filter out image generation models (image output)", () => {
			const models: ModelsDevModel[] = [
				{
					id: "test/image-gen-70b",
					name: "Image Gen Model",
					reasoning: false,
					limit: { context: 4096, output: 0 },
					modalities: { input: ["text"], output: ["image"] },
					cost: { input: 0, output: 0 },
				},
			];
			const filtered = filterModels(models);
			expect(filtered).toHaveLength(0);
		});

		it("should filter out OCR models (image-only input)", () => {
			const models: ModelsDevModel[] = [
				{
					id: "test/ocr-70b",
					name: "OCR Model",
					reasoning: false,
					limit: { context: 0, output: 4096 },
					modalities: { input: ["image"], output: ["text"] },
					cost: { input: 0, output: 0 },
				},
			];
			const filtered = filterModels(models);
			expect(filtered).toHaveLength(0);
		});

		it("should filter out speech-to-text models (audio-only input)", () => {
			const models: ModelsDevModel[] = [
				{
					id: "test/speech-70b",
					name: "Speech Model",
					reasoning: false,
					limit: { context: 0, output: 4096 },
					modalities: { input: ["audio"], output: ["text"] },
					cost: { input: 0, output: 0 },
				},
			];
			const filtered = filterModels(models);
			expect(filtered).toHaveLength(0);
		});

		it("should filter small models (< 70B)", () => {
			const models: ModelsDevModel[] = [
				{
					id: "test/chat-8b",
					name: "Small Chat Model",
					reasoning: false,
					limit: { context: 128000, output: 4096 },
					modalities: { input: ["text"], output: ["text"] },
					cost: { input: 0, output: 0 },
				},
			];
			const filtered = filterModels(models);
			expect(filtered).toHaveLength(0);
		});

		it("should filter paid models when cost > 0", () => {
			const models: ModelsDevModel[] = [
				{
					id: "test/paid-70b",
					name: "Paid Model",
					reasoning: false,
					limit: { context: 128000, output: 4096 },
					modalities: { input: ["text"], output: ["text"] },
					cost: { input: 0.5, output: 1.0 },
				},
			];
			const filtered = filterModels(models);
			expect(filtered).toHaveLength(0);
		});

		it("should handle mixed model list correctly", () => {
			const models: ModelsDevModel[] = [
				{
					id: "nvidia/chat-70b",
					name: "Chat 70B",
					reasoning: false,
					limit: { context: 128000, output: 4096 },
					modalities: { input: ["text"], output: ["text"] },
					cost: { input: 0, output: 0 },
				},
				{
					id: "openai/whisper-large-v3",
					name: "Whisper",
					reasoning: false,
					limit: { context: 0, output: 4096 },
					modalities: { input: ["audio"], output: ["text"] },
					cost: { input: 0, output: 0 },
				},
				{
					id: "black-forest-labs/flux.1-dev",
					name: "FLUX.1",
					reasoning: false,
					limit: { context: 4096, output: 0 },
					modalities: { input: ["text"], output: ["image"] },
					cost: { input: 0, output: 0 },
				},
				{
					id: "nvidia/nemoretriever-ocr-v1",
					name: "OCR",
					reasoning: false,
					limit: { context: 0, output: 4096 },
					modalities: { input: ["image"], output: ["text"] },
					cost: { input: 0, output: 0 },
				},
				{
					id: "nvidia/nemotron-8b",
					name: "Small Model",
					reasoning: false,
					limit: { context: 128000, output: 4096 },
					modalities: { input: ["text"], output: ["text"] },
					cost: { input: 0, output: 0 },
				},
			];
			const filtered = filterModels(models);
			expect(filtered).toHaveLength(1);
			expect(filtered[0].id).toBe("nvidia/chat-70b");
		});
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
