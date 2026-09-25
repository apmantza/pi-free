import { describe, expect, it } from "vitest";
import {
	isOrcaRouterFreeModel,
	mapOrcaRouterModel,
} from "../providers/orcarouter/orcarouter.ts";

describe("OrcaRouter free model detection", () => {
	it("recognizes the provider's explicit free flag", () => {
		expect(isOrcaRouterFreeModel({ id: "provider/model", isFree: true })).toBe(
			true,
		);
		expect(isOrcaRouterFreeModel({ id: "provider/model", isFree: false })).toBe(
			false,
		);
	});

	it("recognizes free labels in model ids or names", () => {
		expect(
			isOrcaRouterFreeModel({ id: "orcarouter/free", name: "OrcaRouter Free" }),
		).toBe(true);
		expect(
			isOrcaRouterFreeModel({
				id: "z-ai/glm-5.3-flash-free",
				name: "Z.ai: GLM 5.3 Flash (Free)",
			}),
		).toBe(true);
		expect(
			isOrcaRouterFreeModel({
				id: "tencent/hy3-free",
				name: "Tencent: Hy3 (Free)",
			}),
		).toBe(true);
	});

	it("uses the gateway's zero request pricing for free models", () => {
		expect(
			isOrcaRouterFreeModel({
				id: "deepseek/deepseek-v4-flash-free",
				pricing: { request: "0.000000" },
			}),
		).toBe(true);
		expect(
			isOrcaRouterFreeModel({
				id: "provider/model",
				pricing: { prompt: "0", completion: "0" },
			}),
		).toBe(true);
	});

	it("does not treat missing pricing as free (fusion router models)", () => {
		expect(isOrcaRouterFreeModel({ id: "orcarouter/fusion" })).toBe(false);
		expect(
			isOrcaRouterFreeModel({
				id: "orcarouter/fusion-flash",
				context_length: 262144,
			}),
		).toBe(false);
	});

	it("does not treat nonzero pricing as free", () => {
		expect(
			isOrcaRouterFreeModel({
				id: "deepseek/deepseek-v4.1-flash",
				pricing: { prompt: "0.0000001500", completion: "0.0000006000" },
			}),
		).toBe(false);
	});

	it("marks mapped free models as authoritative", () => {
		const model = mapOrcaRouterModel({
			id: "z-ai/glm-5.3-flash-free",
			name: "Z.ai: GLM 5.3 Flash (Free)",
			pricing: { request: "0.000000" },
			supported_endpoint_types: null,
		});

		expect(model).toMatchObject({
			id: "z-ai/glm-5.3-flash-free",
			_freeKnown: true,
			_isFree: true,
			_pricingKnown: true,
		});
	});

	it("marks the orcarouter/free router model as free without pricing", () => {
		const model = mapOrcaRouterModel({
			id: "orcarouter/free",
			supported_endpoint_types: [
				"openai",
				"openai-response",
				"anthropic",
				"gemini",
			],
		});

		expect(model).toMatchObject({
			id: "orcarouter/free",
			_freeKnown: true,
			_isFree: true,
			_pricingKnown: false,
		});
	});
});
