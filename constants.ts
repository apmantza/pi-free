/**
 * Shared constants for pi-free-providers.
 * Centralizes provider names, URLs, and configuration values.
 */

// =============================================================================
// Provider names (must match registerProvider calls)
// =============================================================================

export const PROVIDER_KILO = "kilo";
export const PROVIDER_ZEN = "zen";
export const PROVIDER_GO = "go";
export const PROVIDER_OPENROUTER = "openrouter";
export const PROVIDER_NVIDIA = "nvidia";
export const PROVIDER_CLINE = "cline";
export const PROVIDER_FIREWORKS = "fireworks";
export const PROVIDER_OLLAMA = "ollama";
export const PROVIDER_MISTRAL = "mistral";
export const PROVIDER_QWEN = "qwen";
export const PROVIDER_MODAL = "modal";

export const ALL_PROVIDERS = [
	PROVIDER_KILO,
	PROVIDER_ZEN,
	PROVIDER_GO,
	PROVIDER_OPENROUTER,
	PROVIDER_NVIDIA,
	PROVIDER_CLINE,
	PROVIDER_FIREWORKS,
	PROVIDER_MISTRAL,
	PROVIDER_OLLAMA,
	PROVIDER_QWEN,
	PROVIDER_MODAL,
] as const;

// =============================================================================
// Provider base URLs
// =============================================================================

export const BASE_URL_KILO = "https://api.kilo.ai/api/gateway";
export const BASE_URL_ZEN = "https://opencode.ai/zen/v1";
export const BASE_URL_GO = "https://opencode.ai/zen/go/v1";
export const BASE_URL_OPENROUTER = "https://openrouter.ai/api/v1";
export const BASE_URL_NVIDIA = "https://integrate.api.nvidia.com/v1";
export const BASE_URL_CLINE = "https://api.cline.bot/api/v1";
export const BASE_URL_FIREWORKS = "https://api.fireworks.ai/inference/v1";
export const BASE_URL_OLLAMA = "https://ollama.com/v1";
export const BASE_URL_MODAL = "https://api.us-west-2.modal.direct/v1";

// =============================================================================
// External URLs
// =============================================================================

export const URL_MODELS_DEV = "https://models.dev/api.json";
export const URL_KILO_TOS = "https://kilo.ai/terms";
export const URL_ZEN_TOS = "https://opencode.ai/terms";
export const URL_GO_TOS = "https://opencode.ai/terms";
export const URL_CLINE_TOS = "https://cline.bot/tos";
export const URL_QWEN_TOS = "https://terms.alicloud.com/";
export const URL_MODAL_TOS = "https://modal.com/terms";
export const BASE_URL_QWEN = "https://dashscope.aliyuncs.com/compatible-mode/v1";

// =============================================================================
// Cline auth
// =============================================================================

export const CLINE_AUTH_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// =============================================================================
// Configuration thresholds
// =============================================================================

export const NVIDIA_MIN_SIZE_B = 70; // Minimum model size for NVIDIA NIM
export const DEFAULT_MIN_SIZE_B = 30; // Default minimum model size for filtering

// =============================================================================
// Timeouts (milliseconds)
// =============================================================================

// Timeout for fetch operations
export const DEFAULT_FETCH_TIMEOUT_MS: number = 10_000;

export interface TestConfig {
	timeout: number;
	retries: number;
	label: string;
}

// LSP test - fixed - added missing property
export const testConfig: TestConfig = {
	timeout: 5000,
	retries: 3,
	label: "test",
};

// LSP test - fixed return type
export function calculateTimeout(base: number): number {
	return base * 2;
}

// LSP test - unused variable (should show hint/warning if configured)
export function unusedParamTest(required: string, _unused: number): string {
	return required.toUpperCase();
}
export const KILO_POLL_INTERVAL_MS = 3_000;
export const KILO_TOKEN_EXPIRATION_MS = 365 * 24 * 60 * 60 * 1000; // 1 year

// =============================================================================
// Additional OpenAI-compatible providers
// =============================================================================

export const PROVIDER_GROQ = "groq";
export const PROVIDER_TOGETHER = "together";
export const PROVIDER_DEEPINFRA = "deepinfra";
export const PROVIDER_PERPLEXITY = "perplexity";
export const PROVIDER_XAI = "xai";

export const BASE_URL_GROQ = "https://api.groq.com/openai/v1";
export const BASE_URL_TOGETHER = "https://api.together.xyz/v1";
export const BASE_URL_DEEPINFRA = "https://api.deepinfra.com/v1/openai";
export const BASE_URL_MISTRAL = "https://api.mistral.ai/v1";
export const BASE_URL_PERPLEXITY = "https://api.perplexity.ai";
export const BASE_URL_XAI = "https://api.x.ai/v1";
