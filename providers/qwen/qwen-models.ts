/**
 * Qwen OAuth model definitions.
 *
 * @deprecated The 1,000 req/day free tier is no longer available. Auth is broken.
 * This provider remains for backward compatibility but should not be used.
 */

import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { createLogger } from "../../lib/logger.ts";

const _logger = createLogger("qwen-models");

/**
 * portal.qwen.ai compatibility settings.
 *
 * portal.qwen.ai's OpenAI-compatible API does not support several parameters
 * that the pi framework sends by default.
 */
export const PORTAL_COMPAT: NonNullable<ProviderModelConfig["compat"]> = {
	supportsStore: false,
	supportsDeveloperRole: false,
	supportsReasoningEffort: false,
	supportsUsageInStreaming: false,
	supportsStrictMode: false,
	maxTokensField: "max_tokens",
};

/**
 * Fallback model used before OAuth completes or if model discovery fails.
 * The real model ID is resolved dynamically via fetchQwenLiveModels() after auth.
 */
export const QWEN_FREE_MODELS: ProviderModelConfig[] = [
	{
		id: "coder-model",
		name: "Qwen Coder — DEPRECATED (free tier discontinued)",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 131_072,
		maxTokens: 16_384,
		compat: PORTAL_COMPAT,
	},
];

/**
 * Fetch Qwen models. Returns static model list for backward compatibility.
 * @deprecated Qwen free tier is discontinued.
 */
export async function fetchQwenModels(): Promise<ProviderModelConfig[]> {
	_logger.info("Qwen provider is deprecated, returning placeholder models");
	return QWEN_FREE_MODELS;
}

/**
 * Fetch live model list from the Qwen API using the OAuth access token.
 * Returns updated models with real IDs from the server, or the original
 * models unchanged if the request fails.
 */
export async function fetchQwenLiveModels(
	baseUrl: string,
	accessToken: string,
	templateModels: ProviderModelConfig[],
): Promise<ProviderModelConfig[]> {
	try {
		const response = await fetch(`${baseUrl}/models`, {
			headers: {
				Authorization: `Bearer ${accessToken}`,
				Accept: "application/json",
			},
		});

		if (!response.ok) {
			_logger.info("Qwen /v1/models fetch failed, keeping current model IDs", {
				status: response.status,
			});
			return templateModels;
		}

		interface ModelEntry {
			id: string;
		}
		const data = (await response.json()) as { data?: ModelEntry[] };
		const ids: string[] = (data.data ?? [])
			.map((m: ModelEntry) => m.id)
			.filter(Boolean);

		_logger.info("Qwen live models discovered", { ids });

		if (ids.length === 0) return templateModels;

		// Prefer a coder model if available, otherwise use the first model
		const preferred = ids.find((id) => /coder/i.test(id)) ?? ids[0];

		return templateModels.map((m) => ({ ...m, id: preferred }));
	} catch (err) {
		_logger.info("Qwen live model fetch error, keeping current model IDs", {
			error: String(err),
		});
		return templateModels;
	}
}
