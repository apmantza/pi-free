import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";

export interface ProviderModelIdentity {
	id: string;
	name?: string;
}

export const DEEPSEEK_PROXY_COMPAT: NonNullable<ProviderModelConfig["compat"]> =
	{
		supportsStore: false,
		supportsDeveloperRole: false,
		supportsReasoningEffort: true,
		requiresReasoningContentOnAssistantMessages: true,
		thinkingFormat: "deepseek",
	};

export function isDeepSeekModel(model: ProviderModelIdentity): boolean {
	const haystack = `${model.id} ${model.name ?? ""}`.toLowerCase();
	return haystack.includes("deepseek");
}

export function isLikelyReasoningModel(model: ProviderModelIdentity): boolean {
	const haystack = `${model.id} ${model.name ?? ""}`.toLowerCase();
	return (
		isDeepSeekModel(model) ||
		haystack.includes("minimax") ||
		haystack.includes("thinking") ||
		haystack.includes("reasoning") ||
		haystack.includes("reasoner") ||
		haystack.includes("r1") ||
		haystack.includes("qwq")
	);
}

/**
 * For gateway/proxy providers that mask the upstream DeepSeek base URL,
 * add explicit compat so pi-ai preserves and replays reasoning_content.
 */
export function getProxyModelCompat(
	model: ProviderModelIdentity,
): ProviderModelConfig["compat"] | undefined {
	if (isDeepSeekModel(model)) {
		return DEEPSEEK_PROXY_COMPAT;
	}

	// MiniMax uses OpenAI-compatible reasoning_effort param
	if (model.id.toLowerCase().includes("minimax")) {
		return {
			supportsStore: false,
			supportsDeveloperRole: false,
			supportsReasoningEffort: true,
		};
	}

	return undefined;
}
