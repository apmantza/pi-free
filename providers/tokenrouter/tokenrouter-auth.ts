/** Native API-key authentication for TokenRouter. */

import type {
	ApiKeyAuth,
	ApiKeyCredential,
	AuthContext,
	AuthInteraction,
	AuthResult,
	ProviderAuth,
} from "@earendil-works/pi-ai/compat";
import { getTokenrouterApiKey } from "../../config.ts";

async function resolveTokenRouterApiKey(input: {
	ctx: AuthContext;
	credential?: ApiKeyCredential;
	signal?: AbortSignal;
}): Promise<AuthResult | undefined> {
	const key = input.credential?.key ?? getTokenrouterApiKey();
	if (!key) return undefined;
	return {
		auth: { apiKey: key },
		source: input.credential?.key ? "stored API key" : "TOKENROUTER_API_KEY",
	};
}

export const tokenRouterApiKeyAuth: ApiKeyAuth = {
	name: "TokenRouter API key",
	async login(interaction: AuthInteraction): Promise<ApiKeyCredential> {
		const key = await interaction.prompt({
			type: "secret",
			message: "TokenRouter API key",
		});
		return { type: "api_key", key };
	},
	resolve: resolveTokenRouterApiKey,
};

export const tokenRouterAuth: ProviderAuth = {
	apiKey: tokenRouterApiKeyAuth,
};
