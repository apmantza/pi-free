/** FastRouter's public OpenRouter-compatible model catalog. */

import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { applyHidden } from "../../config.ts";
import {
	BASE_URL_FASTROUTER,
	DEFAULT_FETCH_TIMEOUT_MS,
	PROVIDER_FASTROUTER,
} from "../../constants.ts";
import { safeEnrichModelsWithModelsDev } from "../../lib/model-metadata.ts";
import {
	fetchWithRetry,
	mapOpenRouterModel,
	withSignal,
} from "../../lib/util.ts";

/** The fields of a FastRouter /models row this module reads. */
type FastrouterRow = Parameters<typeof mapOpenRouterModel>[0] & {
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
 * Fetch the complete public catalog. The key is optional for /models; it is
 * only passed when configured so public discovery works for logged-out users.
 *
 * Free classification uses FastRouter's own flag,
 * `models_extra_params.free_slug_enabled`: list price 0 is not a free signal
 * here, because fastrouter/auto lists $0 while billing at the routed model's
 * rate (#676).
 */
export async function fetchFastrouterModels(
	apiKey: string,
	signal?: AbortSignal,
): Promise<ProviderModelConfig[]> {
	const response = await fetchWithRetry(
		`${BASE_URL_FASTROUTER}/models`,
		withSignal(
			{
				headers: {
					"Content-Type": "application/json",
					"User-Agent": "pi-free-providers",
					...(apiKey && { Authorization: `Bearer ${apiKey}` }),
				},
			},
			signal,
		),
		3,
		1000,
		DEFAULT_FETCH_TIMEOUT_MS,
	);
	if (!response.ok) {
		throw new Error(
			`Failed to fetch models: ${response.status} ${response.statusText}`,
		);
	}
	const json = (await response.json()) as { data?: FastrouterRow[] };
	if (!Array.isArray(json.data)) {
		throw new Error("Invalid models response: missing data array");
	}

	const models = json.data.filter(isTextChatRow).map((row) =>
		mapOpenRouterModel({
			...row,
			isFree: row.models_extra_params?.free_slug_enabled === true,
		}),
	);
	return applyHidden(
		await safeEnrichModelsWithModelsDev(models, {
			providerId: PROVIDER_FASTROUTER,
		}),
		PROVIDER_FASTROUTER,
	);
}
