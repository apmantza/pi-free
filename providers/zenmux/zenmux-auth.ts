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

/**
 * Resolve the ZenMux API key, or a truthy keyless result when nothing is
 * configured: ZenMux's model catalog is public, so native auth must resolve
 * anonymously for Pi's model refresh to populate it. Chat requests still use
 * the configured key (the gateway rejects unauthenticated requests).
 */
async function resolveZenmuxApiKey(input: {
	ctx: AuthContext;
	credential?: ApiKeyCredential;
	signal?: AbortSignal;
}): Promise<AuthResult | undefined> {
	const key = input.credential?.key ?? getZenmuxApiKey();
	if (!key) {
		return { auth: {}, source: "public catalog (no account)" };
	}
	return {
		auth: { apiKey: key },
		source: input.credential?.key ? "stored API key" : "ZENMUX_API_KEY",
	};
}

const zenmuxApiKeyAuth: ApiKeyAuth = {
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
