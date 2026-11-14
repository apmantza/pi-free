import { describe, expect, it } from "vitest";
import { isFreeModel } from "../lib/registry.ts";
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
			// Per-request pricing is not a token price (#675); the free verdict
			// comes from the authoritative stamp, not from a $0 token cost.
			_pricingKnown: false,
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

	// Recurrence (#685): routers list prompt/completion "-1" (billed at the
	// routed model's rate). Pre-fix the shared mapper published cost -1; once
	// it zeroes router prices, this mapper's own pricing stamp would turn the
	// row into a known $0 and leak it into the free view.
	it("keeps a router '-1' row paid and pricing-unknown, never negative or $0-known", () => {
		const router = mapOrcaRouterModel({
			id: "vendor/router",
			name: "Router",
			pricing: { prompt: "-1", completion: "-1" },
		});
		const paid = mapOrcaRouterModel({
			id: "vendor/paid",
			name: "Paid",
			pricing: { prompt: "0.000001", completion: "0.000002" },
		});

		expect(router.cost).toMatchObject({ input: 0, output: 0 });
		expect(router._pricingKnown).toBe(false);
		expect(
			isFreeModel({ ...router, provider: "orcarouter" }, [router, paid]),
		).toBe(false);
	});
});
