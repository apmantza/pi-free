/**
 * Shared constants for pi-free-providers.
 * Centralizes provider names, URLs, and configuration values.
 */

// =============================================================================
// Provider names (unique providers NOT built into pi)
// =============================================================================

export const PROVIDER_KILO = "kilo";
export const PROVIDER_CLINE = "cline";
export const PROVIDER_CLOUDFLARE = "cloudflare";
export const PROVIDER_OLLAMA = "ollama-cloud";
/** @deprecated Qwen provider is deprecated. The 1,000 req/day free tier is no longer available. */
export const PROVIDER_QWEN = "qwen";
export const PROVIDER_MODAL = "modal";
export const PROVIDER_ZENMUX = "zenmux";
export const PROVIDER_CROFAI = "crofai";
export const PROVIDER_CODESTRAL = "codestral";
export const PROVIDER_LLM7 = "llm7";
export const PROVIDER_DEEPINFRA = "deepinfra";
export const PROVIDER_SAMBANOVA = "sambanova";
export const PROVIDER_TOGETHER = "together";
export const PROVIDER_NOVITA = "novita";
export const PROVIDER_ROUTEWAY = "routeway";
export const PROVIDER_TOKENROUTER = "tokenrouter";
export const PROVIDER_BAI = "bai";
export const PROVIDER_OPENMODEL = "openmodel";

// Built-in pi providers that pi-free wraps with toggles
export const PROVIDER_OPENROUTER = "openrouter";
export const PROVIDER_OPENCODE = "opencode";
export const PROVIDER_FASTROUTER = "fastrouter";

export const ALL_UNIQUE_PROVIDERS = [
	PROVIDER_KILO,
	PROVIDER_CLINE,
	/** @deprecated Qwen free tier no longer available */
	PROVIDER_QWEN,
	PROVIDER_MODAL,
	PROVIDER_OLLAMA,
	PROVIDER_ZENMUX,
	PROVIDER_CROFAI,
	PROVIDER_CODESTRAL,
	PROVIDER_LLM7,
	PROVIDER_DEEPINFRA,
	PROVIDER_SAMBANOVA,
	PROVIDER_TOGETHER,
	PROVIDER_NOVITA,
	PROVIDER_ROUTEWAY,
	PROVIDER_TOKENROUTER,
	PROVIDER_BAI,
	PROVIDER_OPENMODEL,
] as const;

// =============================================================================
// Provider base URLs
// =============================================================================

export const BASE_URL_KILO = "https://api.kilo.ai/api/gateway";
export const BASE_URL_CLOUDFLARE = "https://api.cloudflare.com/client/v4";
export const BASE_URL_OLLAMA = "https://ollama.com/v1"; // OpenAI-compatible API endpoint
export const BASE_URL_CLINE = "https://api.cline.bot/api/v1";
export const BASE_URL_MODAL = "https://api.us-west-2.modal.direct/v1";
export const BASE_URL_QWEN =
	"https://dashscope.aliyuncs.com/compatible-mode/v1";
export const BASE_URL_ZENMUX = "https://zenmux.ai/api/v1";
export const BASE_URL_CROFAI = "https://crof.ai/v1";
export const BASE_URL_CODESTRAL = "https://codestral.mistral.ai/v1";
export const BASE_URL_LLM7 = "https://api.llm7.io/v1";
export const BASE_URL_DEEPINFRA = "https://api.deepinfra.com/v1/openai";
export const BASE_URL_SAMBANOVA = "https://api.sambanova.ai/v1";
export const BASE_URL_TOGETHER = "https://api.together.xyz/v1";
export const BASE_URL_NOVITA = "https://api.novita.ai/openai/v1";
export const BASE_URL_ROUTEWAY = "https://api.routeway.ai/v1";
export const BASE_URL_TOKENROUTER = "https://api.tokenrouter.com/v1";
export const BASE_URL_BAI = "https://api.b.ai/v1";
/**
 * OpenModel is registered with `api: "anthropic-messages"`. The pi-ai
 * Anthropic SDK appends `/v1/messages` to `baseURL`, so the base must
 * NOT include `/v1`. See {@link PROVIDER_OPENMODEL}.
 */
export const BASE_URL_OPENMODEL = "https://api.openmodel.ai";

/** Cline fetches free models from OpenRouter */
export const BASE_URL_OPENROUTER = "https://openrouter.ai/api/v1";

// =============================================================================
// External URLs
// =============================================================================

export const URL_MODELS_DEV = "https://models.dev/api.json";
export const URL_KILO_TOS = "https://kilo.ai/terms";
export const URL_CLINE_TOS = "https://cline.bot/tos";
export const URL_QWEN_TOS = "https://terms.alicloud.com/";
export const URL_MODAL_TOS = "https://modal.com/terms";

// =============================================================================
// Cline auth
// =============================================================================

export const CLINE_AUTH_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// =============================================================================
// Timeouts (milliseconds)
// =============================================================================

/** Timeout for fetch operations */
export const DEFAULT_FETCH_TIMEOUT_MS: number = 10_000;

export const KILO_POLL_INTERVAL_MS = 3_000;
export const KILO_TOKEN_EXPIRATION_MS = 365 * 24 * 60 * 60 * 1000; // 1 year

// =============================================================================
// Removed providers (now built into pi):
// - openrouter: use pi's built-in with OPENROUTER_API_KEY
// - zen/opencode: use pi's built-in with OPENCODE_API_KEY
// - go/opencode-go: use pi's built-in with OPENCODE_API_KEY
// - mistral: use pi's built-in with MISTRAL_API_KEY
// - ollama: add to ~/.pi/agent/models.json as custom provider
// =============================================================================
