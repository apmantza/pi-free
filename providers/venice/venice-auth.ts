/**
 * Venice AI native authentication.
 *
 * Venice's model catalog (api.venice.ai/api/v1/models) is public, so native
 * auth resolves even when no key is configured — Pi's model refresh populates
 * the catalog for logged-out users. Chat requests use the configured key; the
 * gateway rejects unauthenticated completions.
 */

import type {
	ApiKeyAuth,
	ApiKeyCredential,
	AuthContext,
	AuthInteraction,
	AuthResult,
	ProviderAuth,
} from "@earendil-works/pi-ai/compat";
import { getVeniceApiKey } from "../../config.ts";

async function resolveVeniceApiKey(input: {
	ctx: AuthContext;
	credential?: ApiKeyCredential;
	signal?: AbortSignal;
}): Promise<AuthResult | undefined> {
	const key = input.credential?.key ?? getVeniceApiKey();
	if (!key) {
		return { auth: {}, source: "public catalog (no account)" };
	}
	return {
		auth: { apiKey: key },
		source: input.credential?.key ? "stored API key" : "VENICE_API_KEY",
	};
}

export const veniceApiKeyAuth: ApiKeyAuth = {
	name: "Venice API key",
	async login(interaction: AuthInteraction): Promise<ApiKeyCredential> {
		const key = await interaction.prompt({
			type: "secret",
			message: "Venice API key",
		});
		return { type: "api_key", key };
	},
	resolve: resolveVeniceApiKey,
};

export const veniceAuth: ProviderAuth = {
	apiKey: veniceApiKeyAuth,
};
