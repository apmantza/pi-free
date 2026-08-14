/**
 * SambaNova Provider Extension
 *
 * SambaNova Cloud offers fast inference on custom RDU hardware with an
 * OpenAI-compatible API. Known for running Llama 3.3 70B faster than
 * competitors.
 *
 * Free tier (no credit card, no payment method):
 *   - Production models: 20-480 RPM, 400-9600 RPD
 *   - Preview models: 10-150 RPM, 200-3000 RPD
 *   - Forever free, no token pricing
 *
 * Developer tier (add payment method):
 *   - Higher rate limits, same models
 *
 * Endpoint:
 *   Chat: https://api.sambanova.ai/v1/chat/completions
 *
 * Setup:
 *   1. Sign up at https://cloud.sambanova.ai/
 *   2. Get API key from https://cloud.sambanova.ai/apis
 *   3. Set SAMBANOVA_API_KEY env var (or add to ~/.pi/free.json)
 *
 * Usage:
 *   pi install git:github.com/apmantza/pi-free
 *   # Set SAMBANOVA_API_KEY env var
 *   # Models appear in /model selector as "sambanova/Meta-Llama-3.3-70B-Instruct"
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getSambanovaApiKey, getSambanovaShowPaid } from "../../config.ts";
import { BASE_URL_SAMBANOVA, PROVIDER_SAMBANOVA } from "../../constants.ts";
import { createOpenAIAvailabilityProbe } from "../../lib/provider-probe.ts";
import {
	registerNativeAvailabilityProbe,
	registerNativeOpenAIProvider,
} from "../../lib/native-provider.ts";
import { fetchOpenAICompatibleModels } from "../../lib/util.ts";
import { sambanovaAuth } from "./sambanova-auth.ts";

export default function sambanovaProvider(pi: ExtensionAPI): Promise<void> {
	const handle = registerNativeOpenAIProvider(pi, {
		providerId: PROVIDER_SAMBANOVA,
		name: "SambaNova",
		baseUrl: BASE_URL_SAMBANOVA,
		auth: sambanovaAuth,
		getApiKey: getSambanovaApiKey,
		getShowPaid: getSambanovaShowPaid,
		allowUnauthenticated: true,
		fetchModels: async (apiKey, signal) => {
			const models = await fetchOpenAICompatibleModels(
				"sambanova",
				BASE_URL_SAMBANOVA,
				apiKey,
				{ maxTokens: 8_192 },
				{},
				signal,
			);
			for (const model of models) {
				(model as unknown as { _pricingKnown?: boolean })._pricingKnown = true;
			}
			return models;
		},
		tosUrl: "https://sambanova.ai/terms",
	});
	const apiKey = getSambanovaApiKey();
	if (!apiKey) return Promise.resolve();

	const probe = createOpenAIAvailabilityProbe(
		PROVIDER_SAMBANOVA,
		BASE_URL_SAMBANOVA,
	);
	registerNativeAvailabilityProbe(pi, {
		providerId: PROVIDER_SAMBANOVA,
		label: "SambaNova",
		apiKey,
		probe,
		handle,
	});
	return Promise.resolve();
}
