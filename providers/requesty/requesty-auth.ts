/**
 * Requesty native authentication.
 *
 * Without a stored credential or ambient key, resolve() returns undefined
 * and Pi hides the provider from /model (#530): the public catalog is
 * visible but chat needs a key — the gateway rejects unauthenticated
 * completions — so a logged-out listing is clutter, not discovery.
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
		return undefined;
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
