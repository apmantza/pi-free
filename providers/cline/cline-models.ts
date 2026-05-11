/**
 * Cline model fetching.
 *
 * Fetches ALL models from OpenRouter (Cline's gateway).
 * Free/paid filtering is handled by the global free-only filter.
 */

import { applyHidden } from "../../config.ts";
import {
	BASE_URL_OPENROUTER,
	DEFAULT_FETCH_TIMEOUT_MS,
	PROVIDER_CLINE,
} from "../../constants.ts";
import type { ProviderModelConfig } from "../../lib/types.ts";
import { cleanModelName, fetchWithRetry } from "../../lib/util.ts";

interface OpenRouterRaw {
	id: string;
	name: string;
	context_length?: number;
	supported_parameters?: string[];
	architecture?: { input_modalities?: string[]; output_modalities?: string[] };
	top_provider?: { max_completion_tokens?: number | null };
	pricing?: { prompt?: string; completion?: string };
}

function extractNameFromId(id: string): string {
	const part = id.split("/")[1] ?? id;
	return part
		.split(/[-_]/)
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(" ");
}

/**
 * Parse pricing string to cost per million tokens.
 * OpenRouter returns pricing as string (e.g., "0.0001" or "0").
 */
function parsePricing(pricingStr: string | undefined): number {
	if (!pricingStr || pricingStr === "0") return 0;
	const parsed = Number.parseFloat(pricingStr);
	return Number.isNaN(parsed) ? 0 : parsed * 1_000_000; // Convert to per-million
}

/**
 * Check if a model is free (both prompt and completion pricing is 0).
 */
function isFreeModel(info: OpenRouterRaw): boolean {
	return info.pricing?.prompt === "0" && info.pricing?.completion === "0";
}

/**
 * Fetch ALL models from OpenRouter.
 * @param freeOnly - If true, return only free models
 */
export async function fetchClineModels(
	freeOnly = false,
): Promise<ProviderModelConfig[]> {
	const response = await fetchWithRetry(
		`${BASE_URL_OPENROUTER}/models`,
		{},
		3,
		1000,
		DEFAULT_FETCH_TIMEOUT_MS,
	);

	if (!response.ok)
		throw new Error(`Failed to fetch OpenRouter models: ${response.status}`);

	const json = (await response.json()) as { data?: OpenRouterRaw[] };

	// Filter to usable models (chat-capable)
	let usableModels = json.data ?? [];

	// If freeOnly, filter to free models
	if (freeOnly) {
		usableModels = usableModels.filter(isFreeModel);
	}

	const models: ProviderModelConfig[] = [];
	for (const info of usableModels) {
		const isReasoning = !!(
			info.supported_parameters?.includes("include_reasoning") ||
			info.supported_parameters?.includes("reasoning")
		);
		const hasImage =
			info.architecture?.input_modalities?.includes("image") ?? false;

		// Calculate cost per million tokens
		const inputCost = parsePricing(info.pricing?.prompt);
		const outputCost = parsePricing(info.pricing?.completion);
		const isFree = inputCost === 0 && outputCost === 0;

		const cleanName = info.name
			? cleanModelName(info.name)
			: extractNameFromId(info.id);

		models.push({
			id: info.id,
			name: `${cleanName} (Cline)${isFree ? "" : " 💰"}`,
			reasoning: isReasoning,
			input: hasImage ? ["text", "image"] : ["text"],
			cost: {
				input: inputCost,
				output: outputCost,
				cacheRead: 0,
				cacheWrite: 0,
			},
			contextWindow: info.context_length ?? 128_000,
			maxTokens: info.top_provider?.max_completion_tokens ?? 8_192,
		});
	}

	return applyHidden(models, PROVIDER_CLINE);
}

/**
 * Fetch only free models (backward compatibility).
 */
export async function fetchClineFreeModels(): Promise<ProviderModelConfig[]> {
	return fetchClineModels(true);
}
