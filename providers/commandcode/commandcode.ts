/**
 * CommandCode provider extension.
 *
 * CommandCode (commandcode.ai) is an AI subscription gateway routing to ~60
 * models across OpenAI, Anthropic, Google, xAI, Moonshot, Qwen, GLM, MiniMax,
 * DeepSeek, Meta, and more through one Provider API.
 *
 * Endpoints:
 *   Chat:    https://api.commandcode.ai/provider/v1/chat/completions
 *            (+ /messages for claude-* models, see dual-stream note)
 *   Models:  https://api.commandcode.ai/provider/v1/models (public)
 *
 * The catalog is public — models appear before login — but chat requires an
 * account whose plan includes Provider API access (Go plans answer
 * `upgrade_required`).
 *
 * Dual-transport wire: claude-* models are served over Anthropic Messages,
 * everything else over OpenAI Chat Completions. The provider publishes each
 * model with the right `api` (via `apiForModel`) and overrides the shared
 * streams so the transport dispatches on the runtime model api.
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
import type {
	Api,
	Model,
	ProviderStreams,
} from "@earendil-works/pi-ai/compat";
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
 * Dual-transport stream override: dispatch on the runtime model api so
 * claude-* (anthropic-messages) and everything else (openai-completions)
 * each reach the gateway over the protocol it serves.
 */
const dualTransportStreams: ProviderStreams = {
	stream(model: Model<Api>, context, streamOptions) {
		const streams =
			model.api === "anthropic-messages" ? anthropicStreams : openAiStreams;
		return streams.stream(model, context, streamOptions);
	},
	streamSimple(model: Model<Api>, context, streamOptions) {
		const streams =
			model.api === "anthropic-messages" ? anthropicStreams : openAiStreams;
		return streams.streamSimple(model, context, streamOptions);
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
		allowUnauthenticated: true,
		fetchModels: (apiKey, signal) => fetchCommandCodeModels(apiKey, signal),
		apiForModel,
		streams: dualTransportStreams,
	});
	return Promise.resolve();
}
