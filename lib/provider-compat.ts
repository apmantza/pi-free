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

	// Qwen 3.7+ on OpenRouter/Cline uses reasoning_content (DeepSeek format)
	if (
		model.id.toLowerCase().includes("qwen3.7") ||
		model.id.toLowerCase().includes("qwen3-7")
	) {
		return DEEPSEEK_PROXY_COMPAT;
	}

	// Kimi K2.6 needs reasoning_content on assistant messages (OpenRouter issue #5309)
	if (model.id.toLowerCase().includes("kimi")) {
		return {
			supportsStore: false,
			supportsDeveloperRole: false,
			supportsReasoningEffort: true,
			requiresReasoningContentOnAssistantMessages: true,
		};
	}

	return undefined;
}
