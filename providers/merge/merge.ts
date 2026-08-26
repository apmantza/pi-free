/**
 * Merge Gateway provider extension.
 *
 * Merge (merge.dev) is a multi-vendor LLM gateway exposing an
 * OpenAI-compatible inference API at `https://api-gateway.merge.dev/v1/openai`
 * (chat completions across ~264 catalog entries from OpenAI, Anthropic,
 * Google, Meta, Mistral, xAI, Qwen, DeepSeek, and more).
 *
 * Endpoint:
 *   Chat:   https://api-gateway.merge.dev/v1/openai/chat/completions
 *   Models: https://api-gateway.merge.dev/v1/openai/models
 *
 * The model catalog is keyed (anonymous /models returns 401), so models only
 * appear after MERGE_API_KEY is configured; chat uses the same key.
 *
 * Free models: none observed — the gateway bills every request and the
 * catalog carries no pricing fields, so free-model detection runs on Route B
 * (name-based) and currently yields an empty free set. The toggle exists so
 * users can flip between the default view and the full paid catalog once
 * `merge_show_paid` is enabled.
 *
 * Setup:
 *   MERGE_API_KEY=mg_...
 *   # or add merge_api_key to ~/.pi/free.json
 *
 * Usage:
 *   pi install git:github.com/apmantza/pi-free
 *   # Models appear in /model selector as "merge/openai/gpt-4.1-nano"
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getMergeApiKey, getMergeShowPaid } from "../../config.ts";
import { BASE_URL_MERGE, PROVIDER_MERGE } from "../../constants.ts";
import { registerNativeOpenAIProvider } from "../../lib/native-provider.ts";
import { mergeAuth } from "./merge-auth.ts";
import { fetchMergeModels } from "./merge-models.ts";

export default function mergeProvider(pi: ExtensionAPI): Promise<void> {
	registerNativeOpenAIProvider(pi, {
		providerId: PROVIDER_MERGE,
		name: "Merge Gateway",
		baseUrl: BASE_URL_MERGE,
		auth: mergeAuth,
		getApiKey: getMergeApiKey,
		getShowPaid: getMergeShowPaid,
		fetchModels: (apiKey, signal) => fetchMergeModels(apiKey, signal),
	});
	return Promise.resolve();
}
