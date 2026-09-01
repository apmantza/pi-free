/**
 * Requesty native authentication.
 *
 * Requesty's model catalog (router.requesty.ai/v1/models) is public, so
 * native auth resolves even when no key is configured. Chat requests use the
 * configured key; the gateway rejects unauthenticated completions.
 */

import type {
	ApiKeyAuth,
	ApiKeyCredential,
	AuthContext,
	AuthInteraction,
	AuthResult,
	ProviderAuth,
} from "@earendil-works/pi-ai/compat";
import { getRequestyApiKey } from "../../config.ts";

async function resolveRequestyApiKey(input: {
	ctx: AuthContext;
	credential?: ApiKeyCredential;
	signal?: AbortSignal;
}): Promise<AuthResult | undefined> {
	const key = input.credential?.key ?? getRequestyApiKey();
	if (!key) {
		return { auth: {}, source: "public catalog (no account)" };
	}
	return {
		auth: { apiKey: key },
		source: input.credential?.key ? "stored API key" : "REQUESTY_API_KEY",
	};
}

const requestyApiKeyAuth: ApiKeyAuth = {
	name: "Requesty API key",
	async login(interaction: AuthInteraction): Promise<ApiKeyCredential> {
		const key = await interaction.prompt({
			type: "secret",
			message: "Requesty API key",
		});
		return { type: "api_key", key };
	},
	resolve: resolveRequestyApiKey,
};

export const requestyAuth: ProviderAuth = {
	apiKey: requestyApiKeyAuth,
};
