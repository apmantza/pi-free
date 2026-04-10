/**
 * Qwen OAuth model definitions.
 *
 * Free tier provides Qwen 3.6 Plus (coder-model) with 1,000 requests/day.
 */

import type { ProviderModelConfig } from "@mariozechner/pi-coding-agent";
import { createLogger } from "../lib/logger.ts";

const _logger = createLogger("qwen-models");

/**
 * Hardcoded models available for Qwen OAuth free tier.
 * These match the official qwen-code QWEN_OAUTH_MODELS constant.
 */
export const QWEN_FREE_MODELS: ProviderModelConfig[] = [
	{
		id: "coder-model",
		name: "Qwen 3.6 Plus (Coder) — Free 1k/day",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 131_072,
		maxTokens: 16_384,
	},
];

/**
 * Fetch Qwen models. For OAuth free tier, the model list is static.
 */
export async function fetchQwenModels(): Promise<ProviderModelConfig[]> {
	_logger.info("Qwen OAuth: using static free tier models");
	return QWEN_FREE_MODELS;
}
