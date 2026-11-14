/**
 * LLM7 native provider auth (createProvider object form).
 *
 * LLM7 has no OAuth flow — only an API key (free token from
 * https://token.llm7.io/ or a Pro subscription key). It is pi-free's
 * keyless-provider proof case: the free tier works without any credential, so
 * the public catalog must stay visible when no key is configured.
 *
 * To that end `apiKey.resolve` ALWAYS resolves — with a fixed placeholder key
 * when no key exists — instead of returning undefined. Pi's `Models.refresh()` skips
 * providers whose auth does not resolve, which would leave logged-out users
 * with no models at all (no offline init, no background refresh). Always
 * resolving keeps the catalog flowing for everyone — Pi's sanctioned keyless
 * pattern (the pi-ai `faux` provider and pi-free's Cline port do the same) —
 * while authenticated requests still use the ambient `LLM7_API_KEY` env var /
 * `~/.pi/free.json` value exactly as the legacy registration did. There is
 * intentionally no `apiKey.check`: Pi runs that check before availability
 * filtering and would hide this intentionally public catalog when the user is
 * logged out.
 */

import type {
	ApiKeyAuth,
	ApiKeyCredential,
	AuthContext,
	AuthInteraction,
	AuthResult,
	ProviderAuth,
} from "@earendil-works/pi-ai/compat";
import { getLlm7ApiKey } from "../../config.ts";

/**
 * Sent when no key is configured. pi-ai's OpenAI-compatible stream refuses to
 * send without an API key ("No API key for provider: llm7"), and LLM7 serves
 * its public tier to any bearer (verified 2026-11-14: no header and
 * `Bearer unused` both answer 200), so an empty auth made every logged-out
 * turn fail before reaching the network.
 */
const LLM7_ANONYMOUS_KEY = "unused";

/**
 * Resolve the effective LLM7 API key: a natively-stored key (from
 * `interaction.prompt` login) wins, then the ambient `LLM7_API_KEY` env var /
 * `~/.pi/free.json` value via the shared config getter. When NO key is
 * configured this still resolves — with the anonymous placeholder — so Pi
 * keeps the public free catalog visible and its turns can be sent.
 */
async function resolveLlm7ApiKey(input: {
	ctx: AuthContext;
	credential?: ApiKeyCredential;
	signal?: AbortSignal;
}): Promise<AuthResult | undefined> {
	const key = input.credential?.key ?? getLlm7ApiKey();
	if (!key) {
		return {
			auth: { apiKey: LLM7_ANONYMOUS_KEY },
			source: "public free tier (no account)",
		};
	}
	return {
		auth: { apiKey: key },
		source: input.credential?.key ? "stored API key" : "LLM7_API_KEY",
	};
}

const llm7ApiKeyAuth: ApiKeyAuth = {
	name: "LLM7 API key",
	async login(interaction: AuthInteraction): Promise<ApiKeyCredential> {
		const key = await interaction.prompt({
			type: "secret",
			message: "LLM7 API key (free token from https://token.llm7.io/)",
		});
		return { type: "api_key", key };
	},
	resolve: resolveLlm7ApiKey,
};

/**
 * Native auth for the LLM7 provider: API key only (LLM7 has no OAuth flow).
 */
export const llm7Auth: ProviderAuth = {
	apiKey: llm7ApiKeyAuth,
};
