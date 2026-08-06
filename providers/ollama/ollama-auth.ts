/** Native API-key authentication for Ollama Cloud. */

import type {
	ApiKeyAuth,
	ApiKeyCredential,
	AuthContext,
	AuthInteraction,
	AuthResult,
	ProviderAuth,
} from "@earendil-works/pi-ai/compat";
import { getOllamaApiKey } from "../../config.ts";

async function resolveOllamaApiKey(input: {
	ctx: AuthContext;
	credential?: ApiKeyCredential;
	signal?: AbortSignal;
}): Promise<AuthResult | undefined> {
	const key = input.credential?.key ?? getOllamaApiKey();
	if (!key) return undefined;
	return {
		auth: { apiKey: key },
		source: input.credential?.key ? "stored API key" : "OLLAMA_API_KEY",
	};
}

export const ollamaApiKeyAuth: ApiKeyAuth = {
	name: "Ollama Cloud API key",
	async login(interaction: AuthInteraction): Promise<ApiKeyCredential> {
		const key = await interaction.prompt({
			type: "secret",
			message: "Ollama Cloud API key",
		});
		return { type: "api_key", key };
	},
	resolve: resolveOllamaApiKey,
};

export const ollamaAuth: ProviderAuth = {
	apiKey: ollamaApiKeyAuth,
};
