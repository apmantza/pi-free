import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import type { ModelIdentity } from "./types.ts";

export type ProviderModelIdentity = ModelIdentity;

export const DEEPSEEK_PROXY_COMPAT: NonNullable<ProviderModelConfig["compat"]> =
	{
		supportsStore: false,
		supportsDeveloperRole: false,
		supportsReasoningEffort: true,
		requiresReasoningContentOnAssistantMessages: true,
		thinkingFormat: "deepseek",
	};

/** Kimi K2.6 on OpenRouter needs reasoning_content on assistant messages
 *  (OpenRouter issue #5309) but doesn't use the DeepSeek thinking format. */
const KIMI_PROXY_COMPAT: NonNullable<ProviderModelConfig["compat"]> = {
	supportsStore: false,
	supportsDeveloperRole: false,
	supportsReasoningEffort: true,
	requiresReasoningContentOnAssistantMessages: true,
};

function getModelHaystack(model: ProviderModelIdentity): string {
	return [model.id, model.name, model.family, model.provider]
		.filter(Boolean)
		.join(" ")
		.toLowerCase();
}

export function isDeepSeekModel(model: ProviderModelIdentity): boolean {
	return getModelHaystack(model).includes("deepseek");
}

/** MiMo/Xiaomi reasoning models expose OpenAI-compatible reasoning controls
 * through gateways such as Cline/OpenRouter, but they are not DeepSeek-format. */
function isMimoModel(model: ProviderModelIdentity): boolean {
	const haystack = getModelHaystack(model);
	return haystack.includes("mimo") || haystack.includes("xiaomi");
}

export function isLikelyReasoningModel(model: ProviderModelIdentity): boolean {
	const haystack = getModelHaystack(model);
	return (
		isDeepSeekModel(model) ||
		haystack.includes("minimax") ||
		isMimoModel(model) ||
		haystack.includes("kimi") ||
		haystack.includes("qwen3.7") ||
		haystack.includes("qwen3-7") ||
		haystack.includes("thinking") ||
		haystack.includes("reasoning") ||
		haystack.includes("reasoner") ||
		haystack.includes("r1") ||
		haystack.includes("qwq")
	);
}

/**
 * Models that the gateway/proxy exposes as a DeepSeek-style reasoning
 * format — use the canonical DEEPSEEK_PROXY_COMPAT (full feature set +
 * thinkingFormat).
 */
function isDeepSeekStyleModel(model: ProviderModelIdentity): boolean {
	const id = model.id.toLowerCase();
	return (
		isDeepSeekModel(model) ||
		id.includes("minimax") ||
		id.includes("qwen3.7") ||
		id.includes("qwen3-7")
	);
}

/**
 * Kimi variants need the same reasoning_content replay as DeepSeek-style
 * models but without the thinkingFormat override.
 */
function isKimiModel(model: ProviderModelIdentity): boolean {
	return model.id.toLowerCase().includes("kimi");
}

/**
 * For gateway/proxy providers that mask the upstream DeepSeek base URL,
 * add explicit compat so pi-ai preserves and replays reasoning_content.
 */
export function getProxyModelCompat(
	model: ProviderModelIdentity,
): ProviderModelConfig["compat"] | undefined {
	if (isDeepSeekStyleModel(model)) {
		return DEEPSEEK_PROXY_COMPAT;
	}
	if (isKimiModel(model) || isMimoModel(model)) {
		return KIMI_PROXY_COMPAT;
	}
	return undefined;
}
