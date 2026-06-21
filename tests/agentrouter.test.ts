/**
 * Tests for the AgentRouter provider's pure logic: Anthropic protocol
 * filtering (the OpenAI path is blocked for direct API clients) and
 * freemium classification (model_price=0 for all models).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { isFreeModel } from "../lib/registry.ts";
import {
	mapAgentRouterModel,
	supportsAnthropicProtocol,
} from "../providers/agentrouter/agentrouter.ts";

afterEach(() => {
	vi.restoreAllMocks();
});

// =============================================================================
// Fixtures — modeled on the real /api/pricing response
// =============================================================================

function pricingItem(
	model_name: string,
	overrides: Partial<{
		quota_type: number;
		model_ratio: number;
		completion_ratio: number;
		model_price: number;
		owner_by: string;
		supported_endpoint_types: string[];
		enable_groups: string[];
	}> = {},
) {
	return {
		model_name,
		quota_type: 0,
		model_ratio: 1,
		completion_ratio: 1,
		model_price: 0,
		owner_by: "",
		supported_endpoint_types: ["anthropic", "openai"],
		enable_groups: ["default"],
		...overrides,
	};
}

// =============================================================================
// supportsAnthropicProtocol — protocol filtering
// =============================================================================

describe("supportsAnthropicProtocol", () => {
	it("accepts models that support both protocols (Claude)", () => {
		expect(
			supportsAnthropicProtocol(
				pricingItem("claude-opus-4-7", {
					supported_endpoint_types: ["anthropic", "openai"],
				}),
			),
		).toBe(true);
	});

	it("rejects models that only support OpenAI", () => {
		expect(
			supportsAnthropicProtocol(
				pricingItem("deepseek-v4-flash", {
					supported_endpoint_types: ["openai"],
				}),
			),
		).toBe(false);

		expect(
			supportsAnthropicProtocol(
				pricingItem("gpt-5.5", { supported_endpoint_types: ["openai"] }),
			),
		).toBe(false);

		expect(
			supportsAnthropicProtocol(
				pricingItem("glm-5.1", { supported_endpoint_types: ["openai"] }),
			),
		).toBe(false);
	});

	it("rejects items with missing or empty endpoint types", () => {
		expect(
			supportsAnthropicProtocol(
				pricingItem("broken", { supported_endpoint_types: [] }),
			),
		).toBe(false);

		// Edge: missing array
		const broken = pricingItem("no-endpoints");
		(
			broken as { supported_endpoint_types?: string[] }
		).supported_endpoint_types = undefined as unknown as string[];
		expect(supportsAnthropicProtocol(broken)).toBe(false);
	});

	it("selects exactly the 5 Claude models out of 10 (matches the real catalog)", () => {
		const catalog = [
			pricingItem("claude-opus-4-6", {
				model_ratio: 10.5,
				completion_ratio: 5,
				enable_groups: ["default", "svip", "vip"],
			}),
			pricingItem("claude-opus-4-7"),
			pricingItem("claude-opus-4-8"),
			pricingItem("claude-sonnet-4-5", {
				model_ratio: 10,
				completion_ratio: 5,
			}),
			pricingItem("claude-sonnet-4-6"),
			pricingItem("deepseek-v4-flash", {
				supported_endpoint_types: ["openai"],
				enable_groups: ["default", "svip", "vip"],
			}),
			pricingItem("deepseek-v4-pro", { supported_endpoint_types: ["openai"] }),
			pricingItem("glm-5.1", { supported_endpoint_types: ["openai"] }),
			pricingItem("gpt-5.4", { supported_endpoint_types: ["openai"] }),
			pricingItem("gpt-5.5", { supported_endpoint_types: ["openai"] }),
		];

		const anthropic = catalog
			.filter(supportsAnthropicProtocol)
			.map((m) => m.model_name)
			.sort((a, b) => a.localeCompare(b));
		expect(anthropic).toEqual(
			[
				"claude-opus-4-6",
				"claude-opus-4-7",
				"claude-opus-4-8",
				"claude-sonnet-4-5",
				"claude-sonnet-4-6",
			].sort((a, b) => a.localeCompare(b)),
		);
	});
});

// =============================================================================
// mapAgentRouterModel — freemium classification
// =============================================================================

describe("mapAgentRouterModel — freemium classification", () => {
	it("marks every model as _freeKnown / _isFree (free public-welfare service)", () => {
		const model = mapAgentRouterModel(pricingItem("claude-opus-4-7"));
		expect(model._freeKnown).toBe(true);
		expect(model._isFree).toBe(true);
		expect(model._pricingKnown).toBe(true);
	});

	it("starts with conservative defaults (reasoning=false, text-only) for models.dev to enrich", () => {
		const model = mapAgentRouterModel(pricingItem("claude-sonnet-4-6"));
		// safeEnrichModelsWithModelsDev fills in reasoning/vision/contextWindow
		// from models.dev metadata; the raw mapping starts conservative.
		expect(model.reasoning).toBe(false);
		expect(model.input).toEqual(["text"]);
		expect(model.contextWindow).toBe(128_000);
		expect(model.maxTokens).toBe(16_384);
	});

	it("uses 0 cost across the board (model_price is 0 for all models)", () => {
		const model = mapAgentRouterModel(pricingItem("claude-opus-4-6"));
		expect(model.cost.input).toBe(0);
		expect(model.cost.output).toBe(0);
		expect(model.cost.cacheRead).toBe(0);
		expect(model.cost.cacheWrite).toBe(0);
	});

	it("uses the model_name as both id and display name", () => {
		const model = mapAgentRouterModel(pricingItem("claude-sonnet-4-5"));
		expect(model.id).toBe("claude-sonnet-4-5");
		expect(model.name).toBe("claude-sonnet-4-5");
	});
});

// =============================================================================
// End-to-end free detection via isFreeModel
// =============================================================================

describe("AgentRouter + isFreeModel integration (free-only mode)", () => {
	const allModels = [
		mapAgentRouterModel(pricingItem("claude-opus-4-6")),
		mapAgentRouterModel(pricingItem("claude-opus-4-7")),
		mapAgentRouterModel(pricingItem("claude-opus-4-8")),
		mapAgentRouterModel(pricingItem("claude-sonnet-4-5")),
		mapAgentRouterModel(pricingItem("claude-sonnet-4-6")),
	];

	it("classifies every AgentRouter model as free", () => {
		const free = allModels.filter((m) =>
			isFreeModel({ ...m, provider: "agentrouter" }, allModels),
		);
		expect(free.map((m) => m.id).sort((a, b) => a.localeCompare(b))).toEqual(
			[
				"claude-opus-4-6",
				"claude-opus-4-7",
				"claude-opus-4-8",
				"claude-sonnet-4-5",
				"claude-sonnet-4-6",
			].sort((a, b) => a.localeCompare(b)),
		);
	});
});
