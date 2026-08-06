/**
 * FastRouter native authentication.
 *
 * FastRouter's model catalog is public, so native auth must resolve even when
 * no key is configured. Chat requests still use the configured key (and the
 * gateway rejects unauthenticated requests when one is required).
 */

import type {
	ApiKeyAuth,
	ApiKeyCredential,
	AuthContext,
	AuthInteraction,
	AuthResult,
	ProviderAuth,
} from "@earendil-works/pi-ai/compat";
import { getFastrouterApiKey } from "../../config.ts";

async function resolveFastrouterApiKey(input: {
	ctx: AuthContext;
	credential?: ApiKeyCredential;
	signal?: AbortSignal;
}): Promise<AuthResult | undefined> {
	const key = input.credential?.key ?? getFastrouterApiKey();
	if (!key) {
		return { auth: {}, source: "public catalog (no account)" };
	}
	return {
		auth: { apiKey: key },
		source: input.credential?.key ? "stored API key" : "FASTROUTER_API_KEY",
	};
}

export const fastrouterApiKeyAuth: ApiKeyAuth = {
	name: "FastRouter API key",
	async login(interaction: AuthInteraction): Promise<ApiKeyCredential> {
		const key = await interaction.prompt({
			type: "secret",
			message: "FastRouter API key",
		});
		return { type: "api_key", key };
	},
	resolve: resolveFastrouterApiKey,
};

export const fastrouterAuth: ProviderAuth = {
	apiKey: fastrouterApiKeyAuth,
};
