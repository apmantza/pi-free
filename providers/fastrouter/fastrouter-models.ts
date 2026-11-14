/** FastRouter's public OpenRouter-compatible model catalog. */

import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { applyHidden } from "../../config.ts";
import { BASE_URL_FASTROUTER, PROVIDER_FASTROUTER } from "../../constants.ts";
import type { OpenRouterCatalogRow } from "../../lib/model-map.ts";
import { fetchOpenRouterCompatibleModels } from "../model-fetcher.ts";

/** The fields of a FastRouter /models row this module reads. */
type FastrouterRow = OpenRouterCatalogRow & {
	models_extra_params?: { free_slug_enabled?: boolean } | null;
};

/**
 * Admit text-in, text-only-out chat models and refuse everything else.
 * Output-only filtering let speech-to-text models through: deepgram/nova-3,
 * openai/gpt-transcribe, whisper-* and sarvam/saaras take ["audio"] in and
 * give ["text"] out, and the $0 ones classified free (#676). Media-output
 * hybrids (gemini-*-image, prompt-to-audio) are refused by the same rule.
 */
function isTextChatRow(row: FastrouterRow): boolean {
	const output = row.architecture?.output_modalities ?? [];
	const input = row.architecture?.input_modalities ?? [];
	return (
		output.length > 0 &&
		output.every((mod) => mod === "text") &&
		input.includes("text")
	);
}

/**
 * Free classification uses FastRouter's own flag,
 * `models_extra_params.free_slug_enabled`: list price 0 is not a free signal
 * here, because fastrouter/auto lists $0 while billing at the routed model's
 * rate (#676).
 */
function adaptFastrouterRow(
	row: FastrouterRow,
): OpenRouterCatalogRow | undefined {
	if (!isTextChatRow(row)) return undefined;
	return {
		...row,
		isFree: row.models_extra_params?.free_slug_enabled === true,
	};
}

/**
 * Fetch the complete public catalog. /models itself accepts no key, but Pi
 * refreshes FastRouter only once a key resolves (#697), so it is always sent.
 */
export async function fetchFastrouterModels(
	apiKey: string,
	signal?: AbortSignal,
): Promise<ProviderModelConfig[]> {
	const models = await fetchOpenRouterCompatibleModels({
		providerId: PROVIDER_FASTROUTER,
		baseUrl: BASE_URL_FASTROUTER,
		apiKey,
		signal,
		adaptRow: adaptFastrouterRow,
	});
	return applyHidden(models, PROVIDER_FASTROUTER);
}
