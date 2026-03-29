/**
 * Cline free model fetching.
 *
 * Fetches zero-cost models from OpenRouter (Cline's gateway).
 */

import { applyHidden } from "../config.ts";
import { BASE_URL_OPENROUTER, DEFAULT_FETCH_TIMEOUT_MS } from "../constants.ts";
import type { ProviderModelConfig } from "../types.ts";
import { fetchWithRetry, isUsableModel } from "../util.ts";

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

export async function fetchClineModels(): Promise<ProviderModelConfig[]> {
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
	const freeModels = (json.data ?? []).filter(
		(m) => m.pricing?.prompt === "0" && m.pricing?.completion === "0",
	);

	const models: ProviderModelConfig[] = [];
	for (const info of freeModels) {
		if (!isUsableModel(info.id)) continue;

		const isReasoning = !!(
			info.supported_parameters?.includes("include_reasoning") ||
			info.supported_parameters?.includes("reasoning")
		);
		const hasImage =
			info.architecture?.input_modalities?.includes("image") ?? false;

		models.push({
			id: info.id,
			name: `${info.name ?? extractNameFromId(info.id)} (Cline)`,
			reasoning: isReasoning,
			input: hasImage ? ["text", "image"] : ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: info.context_length ?? 128_000,
			maxTokens: info.top_provider?.max_completion_tokens ?? 8_192,
		});
	}

	return applyHidden(models);
}
