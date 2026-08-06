/** Native API-key authentication for ZenMux. */

import type {
	ApiKeyAuth,
	ApiKeyCredential,
	AuthContext,
	AuthInteraction,
	AuthResult,
	ProviderAuth,
} from "@earendil-works/pi-ai/compat";
import { getZenmuxApiKey } from "../../config.ts";

async function resolveZenmuxApiKey(input: {
	ctx: AuthContext;
	credential?: ApiKeyCredential;
	signal?: AbortSignal;
}): Promise<AuthResult | undefined> {
	const key = input.credential?.key ?? getZenmuxApiKey();
	if (!key) return undefined;
	return {
		auth: { apiKey: key },
		source: input.credential?.key ? "stored API key" : "ZENMUX_API_KEY",
	};
}

export const zenmuxApiKeyAuth: ApiKeyAuth = {
	name: "ZenMux API key",
	async login(interaction: AuthInteraction): Promise<ApiKeyCredential> {
		const key = await interaction.prompt({
			type: "secret",
			message: "ZenMux API key",
		});
		return { type: "api_key", key };
	},
	resolve: resolveZenmuxApiKey,
};

export const zenmuxAuth: ProviderAuth = {
	apiKey: zenmuxApiKeyAuth,
};
