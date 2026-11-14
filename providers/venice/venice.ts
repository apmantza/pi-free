/**
 * Venice AI provider extension.
 *
 * Venice.ai offers a privacy-focused, OpenAI-compatible inference API
 * spanning 100+ text models (frontier reasoning, open weights, and stealth
 * preview models) billed in USD or DIEM per million tokens.
 *
 * Endpoint:
 *   Chat:   https://api.venice.ai/api/v1/chat/completions
 *   Models: https://api.venice.ai/api/v1/models?type=text
 *
 * The model catalog is public (no credential required to list models), so
 * models appear before login; chat requests require an API key.
 *
 * Balance gate: Venice requires a positive account balance for ALL
 * inference — including $0-listed models — so an unfunded key will see
 * request-time 402 errors even for models classified free. Classification
 * intentionally follows the published pricing data; the catalog defaults
 * to showing paid models via /toggle-venice.
 *
 * Setup:
 *   1. Sign up at https://venice.ai/ and create an API key
 *      (https://venice.ai/settings/api)
 *   2. Set VENICE_API_KEY env var (or add venice_api_key to ~/.pi/free.json)
 *
 * Usage:
 *   pi install git:github.com/apmantza/pi-free
 *   # Set VENICE_API_KEY env var
 *   # Models appear in /model selector as "venice/claude-sonnet-4-6"
 */

import type {
	ProviderStreams,
	StreamOptions,
} from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getVeniceApiKey, getVeniceShowPaid } from "../../config.ts";
import { BASE_URL_VENICE, PROVIDER_VENICE } from "../../constants.ts";
import { lazyOpenAICompletionsApi } from "../../lib/lazy-compat.ts";
import {
	type NativeOpenAIProviderOptions,
	registerNativeOpenAIProvider,
} from "../../lib/native-provider.ts";
import { veniceAuth } from "./venice-auth.ts";
import { fetchVeniceModels } from "./venice-models.ts";

/**
 * Venice adds its own system prompt to every chat request unless
 * `venice_parameters.include_venice_system_prompt` is false (default true,
 * docs.venice.ai chat/completions). Pi already sends the agent's system
 * prompt, so every request opts out. The flag is set in the stream's
 * `onPayload`, the seam every caller of this provider passes through
 * (agent turns, compaction, branch summaries; defect shape 25), and before
 * Pi's own `before_provider_request` hook, which can still override it.
 */
function withoutVeniceSystemPrompt<T extends StreamOptions>(
	options: T | undefined,
): T {
	const downstream = options?.onPayload;
	return {
		...options,
		onPayload: async (payload, model) => {
			const next =
				payload && typeof payload === "object" && !Array.isArray(payload)
					? {
							...payload,
							venice_parameters: {
								...(payload as { venice_parameters?: object })
									.venice_parameters,
								include_venice_system_prompt: false,
							},
						}
					: payload;
			const replaced = await downstream?.(next, model);
			return replaced === undefined ? next : replaced;
		},
	} as T;
}

const baseStreams = lazyOpenAICompletionsApi();

const veniceStreams: ProviderStreams = {
	stream: (model, context, options) =>
		baseStreams.stream(model, context, withoutVeniceSystemPrompt(options)),
	streamSimple: (model, context, options) =>
		baseStreams.streamSimple(
			model,
			context,
			withoutVeniceSystemPrompt(options),
		),
};

export const veniceProviderOptions: NativeOpenAIProviderOptions = {
	providerId: PROVIDER_VENICE,
	name: "Venice AI",
	baseUrl: BASE_URL_VENICE,
	auth: veniceAuth,
	getApiKey: getVeniceApiKey,
	getShowPaid: getVeniceShowPaid,
	fetchModels: (apiKey, signal) => fetchVeniceModels(apiKey, signal),
	streams: veniceStreams,
};

export default function veniceProvider(pi: ExtensionAPI): Promise<void> {
	registerNativeOpenAIProvider(pi, veniceProviderOptions);
	return Promise.resolve();
}
