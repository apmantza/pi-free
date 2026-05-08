/**
 * Thinking level mapping for Ollama Cloud models.
 *
 * Maps Pi's thinking levels to Ollama Cloud's OpenAI-compatible
 * `reasoning_effort` values. The API accepts "none", "low", "medium",
 * "high", and "max". On simple prompts, "max" can be a no-op over
 * "high", but on harder prompts it can increase thinking substantially
 * (e.g. deepseek-v4-pro: ~32k tokens on high vs ~55k on max).
 *
 * A `null` value means the level is hidden in Pi's UI.
 *
 * Model-specific behavior discovered through testing
 * (see https://github.com/fgrehm/pi-ollama-cloud/blob/main/docs/think-experiment.md):
 *   - Most models: all levels work, "none" disables thinking
 *   - GPT-OSS: no off mode, only low/medium/high
 *   - Qwen 3.x (non-VL): binary-only (think/nothink) - off works
 *   - Qwen 3 VL: "none" doesn't disable thinking - off is hidden
 *   - Kimi K2 Thinking: "none" doesn't disable thinking - off is hidden
 *   - MiniMax M2.x: "none" doesn't disable thinking - off is hidden
 *
 * Reference: https://docs.ollama.com/api/openai-compatibility
 */

import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";

export type ThinkingLevelMap = NonNullable<
	ProviderModelConfig["thinkingLevelMap"]
>;

/** Default: off/low/medium/high/xhigh with minimal hidden. */
export const DEFAULT: ThinkingLevelMap = {
	off: "none",
	minimal: null,
	low: "low",
	medium: "medium",
	high: "high",
	xhigh: "max",
};

/**
 * GPT-OSS: can't disable thinking, only low/medium/high.
 * https://ollama.com/library/gpt-oss
 */
export const GPT_OSS: ThinkingLevelMap = {
	off: null,
	minimal: null,
	low: "low",
	medium: "medium",
	high: "high",
	xhigh: null,
};

/**
 * Qwen 3.x: binary-only (think/nothink), no gradation.
 * https://docs.ollama.com/capabilities/thinking
 */
export const QWEN3: ThinkingLevelMap = {
	off: "none",
	minimal: null,
	low: null,
	medium: "medium",
	high: null,
	xhigh: null,
};

/**
 * "none" doesn't disable thinking - off is hidden.
 * Used by kimi-k2-thinking, minimax family, qwen3-vl.
 */
export const NO_OFF: ThinkingLevelMap = {
	off: null,
	minimal: null,
	low: "low",
	medium: "medium",
	high: "high",
	xhigh: "max",
};

/**
 * Resolve the thinking level map for a model.
 * Matches by model ID prefix (case-sensitive, checks first chars).
 */
export function resolveThinkingMap(
	id: string,
	capabilities: string[],
): ThinkingLevelMap | undefined {
	if (!capabilities.includes("thinking")) return undefined;

	if (id.startsWith("gpt-oss")) return GPT_OSS;
	if (id.startsWith("qwen3-vl")) return NO_OFF;
	if (id.startsWith("qwen3")) return QWEN3;
	if (id === "kimi-k2-thinking") return NO_OFF;
	if (id.startsWith("minimax")) return NO_OFF;

	return DEFAULT;
}
