/**
 * Modal GLM Provider Extension
 *
 * Provides access to GLM models hosted on Modal's OpenAI-compatible endpoint.
 * Requires MODAL_API_KEY (or modal_api_key in ~/.pi/free.json).
 *
 * Endpoint docs: https://modal.com/glm-5-endpoint
 */

import type { ProviderModelConfig } from "@mariozechner/pi-coding-agent";
import { applyHidden, PROVIDER_MODAL } from "../config.ts";
import { BASE_URL_MODAL, URL_MODAL_TOS } from "../constants.ts";
import { createProvider } from "../provider-factory.ts";

function getModalModels(): ProviderModelConfig[] {
	return applyHidden([
		{
			id: "zai-org/GLM-5.1-FP8",
			name: "GLM-5.1 FP8 (Modal)",
			reasoning: true,
			input: ["text"],
			// Promotional/free-period pricing may change; keep conservative placeholders.
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128000,
			maxTokens: 16384,
		},
	]);
}

export default function (pi: Parameters<typeof createProvider>[0]) {
	return createProvider(pi, {
		providerId: PROVIDER_MODAL,
		baseUrl: BASE_URL_MODAL,
		apiKeyEnvVar: "MODAL_API_KEY",
		apiKeyConfigKey: "modal_api_key",
		fetchModels: async () => getModalModels(),
		tosUrl: URL_MODAL_TOS,
		extraHeaders: {
			"X-Title": "Pi",
			"HTTP-Referer": "https://modal.com/",
		},
	});
}
