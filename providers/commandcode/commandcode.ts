/**
 * CommandCode provider extension.
 *
 * CommandCode (commandcode.ai) is an AI subscription gateway routing to ~60
 * models across OpenAI, Anthropic, Google, xAI, Moonshot, Qwen, GLM, MiniMax,
 * DeepSeek, Meta, and more through one Provider API.
 *
 * Endpoints:
 *   Chat:    https://api.commandcode.ai/provider/v1/chat/completions
 *            https://api.commandcode.ai/provider/v1/messages (claude-*)
 *   Models:  https://api.commandcode.ai/provider/v1/models (public)
 *
 * The catalog is public — models appear before login — but chat requires an
 * account whose plan includes Provider API access (Go plans answer
 * `upgrade_required`).
 *
 * Dual-transport wire: claude-* models are served over Anthropic Messages,
 * everything else over OpenAI Chat Completions. The provider publishes each
 * model with the right `api` (via `apiForModel`) and overrides the shared
 * streams so the transport dispatches on the runtime model api. The
 * Anthropic SDK appends `/v1/messages` to the base URL, so claude-* streams
 * get the base without `/v1` (`.../provider/v1/v1/messages` is a 404).
 *
 * Pricing: curated USD-per-M table ported from patlux/pi-commandcode-provider
 * (MIT), verified against CommandCode's official pricing page 2026-08-25;
 * converted to pi-free's per-token cost unit at mapping time.
 *
 * Setup:
 *   COMMAND_CODE_API_KEY=user_...
 *   # or add commandcode_api_key to ~/.pi/free.json
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Api, Model, ProviderStreams } from "@earendil-works/pi-ai/compat";
import { getCommandCodeApiKey, getCommandCodeShowPaid } from "../../config.ts";
import { BASE_URL_COMMANDCODE, PROVIDER_COMMANDCODE } from "../../constants.ts";
import {
	lazyAnthropicMessagesApi,
	lazyOpenAICompletionsApi,
} from "../../lib/lazy-compat.ts";
import { registerNativeOpenAIProvider } from "../../lib/native-provider.ts";
import { commandCodeAuth } from "./commandcode-auth.ts";
import { fetchCommandCodeModels, apiForModel } from "./commandcode-models.ts";

// Both bridges load lazily on first use of their respective transport; a
// session that never touches a claude-* model never pays for Anthropic.
const openAiStreams = lazyOpenAICompletionsApi();
const anthropicStreams = lazyAnthropicMessagesApi();

/**
 * Anthropic Messages base URL. The shared `BASE_URL_COMMANDCODE` ends in
 * `/v1` for the OpenAI client, which appends only `/chat/completions`; the
 * Anthropic SDK appends `/v1/messages` itself.
 */
const ANTHROPIC_BASE_URL_COMMANDCODE = BASE_URL_COMMANDCODE.replace(
	/\/v1$/,
	"",
);

/**
 * Dual-transport stream override: dispatch on the runtime model api so
 * claude-* (anthropic-messages) and everything else (openai-completions)
 * each reach the gateway over the protocol it serves. The anthropic route
 * swaps in its own base URL at stream time, so models restored from Pi's
 * store (which carry the shared `/v1` base) are routed correctly too.
 */
function routeModel(model: Model<Api>): {
	streams: ProviderStreams;
	model: Model<Api>;
} {
	if (model.api !== "anthropic-messages") {
		return { streams: openAiStreams, model };
	}
	return {
		streams: anthropicStreams,
		model: { ...model, baseUrl: ANTHROPIC_BASE_URL_COMMANDCODE },
	};
}

const dualTransportStreams: ProviderStreams = {
	stream(model: Model<Api>, context, streamOptions) {
		const routed = routeModel(model);
		return routed.streams.stream(routed.model, context, streamOptions);
	},
	streamSimple(model: Model<Api>, context, streamOptions) {
		const routed = routeModel(model);
		return routed.streams.streamSimple(routed.model, context, streamOptions);
	},
};

export default function commandCodeProvider(pi: ExtensionAPI): Promise<void> {
	registerNativeOpenAIProvider(pi, {
		providerId: PROVIDER_COMMANDCODE,
		name: "CommandCode",
		baseUrl: BASE_URL_COMMANDCODE,
		auth: commandCodeAuth,
		getApiKey: getCommandCodeApiKey,
		getShowPaid: getCommandCodeShowPaid,
		fetchModels: (apiKey, signal) => fetchCommandCodeModels(apiKey, signal),
		apiForModel,
		streams: dualTransportStreams,
	});
	return Promise.resolve();
}
