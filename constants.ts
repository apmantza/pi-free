/**
 * Shared constants for pi-free-providers.
 * Centralizes provider names, URLs, and configuration values.
 */

// =============================================================================
// Provider names (unique providers NOT built into pi)
// =============================================================================

export const PROVIDER_KILO = "kilo";
export const PROVIDER_CLINE = "cline";
export const PROVIDER_OLLAMA = "ollama-cloud";
export const PROVIDER_ZENMUX = "zenmux";
export const PROVIDER_CROFAI = "crofai";
export const PROVIDER_LLM7 = "llm7";
export const PROVIDER_DEEPINFRA = "deepinfra";
export const PROVIDER_SAMBANOVA = "sambanova";
export const PROVIDER_TOGETHER = "together";
export const PROVIDER_NOVITA = "novita";
export const PROVIDER_ROUTEWAY = "routeway";
export const PROVIDER_TOKENROUTER = "tokenrouter";
export const PROVIDER_ANYAPI = "anyapi";
export const PROVIDER_BAI = "bai";
export const PROVIDER_OPENMODEL = "openmodel";
export const PROVIDER_QODER = "qoder";

// Built-in pi providers that pi-free wraps with toggles
export const PROVIDER_OPENROUTER = "openrouter";
export const PROVIDER_OPENCODE = "opencode";
export const PROVIDER_FASTROUTER = "fastrouter";

// =============================================================================
// Provider base URLs
// =============================================================================

export const BASE_URL_OLLAMA = "https://ollama.com/v1"; // OpenAI-compatible API endpoint
export const BASE_URL_CLINE = "https://api.cline.bot/api/v1";
export const BASE_URL_ZENMUX = "https://zenmux.ai/api/v1";
export const BASE_URL_CROFAI = "https://crof.ai/v1";
export const BASE_URL_LLM7 = "https://api.llm7.io/v1";
export const BASE_URL_DEEPINFRA = "https://api.deepinfra.com/v1/openai";
export const BASE_URL_SAMBANOVA = "https://api.sambanova.ai/v1";
export const BASE_URL_TOGETHER = "https://api.together.xyz/v1";
export const BASE_URL_NOVITA = "https://api.novita.ai/openai/v1";
export const BASE_URL_ROUTEWAY = "https://api.routeway.ai/v1";
export const BASE_URL_TOKENROUTER = "https://api.tokenrouter.com/v1";
export const BASE_URL_ANYAPI = "https://api.anyapi.ai/v1";
export const BASE_URL_BAI = "https://api.b.ai/v1";
/**
 * OpenModel is registered with `api: "anthropic-messages"`. The pi-ai
 * Anthropic SDK appends `/v1/messages` to `baseURL`, so the base must
 * NOT include `/v1`. See {@link PROVIDER_OPENMODEL}.
 */
export const BASE_URL_OPENMODEL = "https://api.openmodel.ai";
export const BASE_URL_QODER = "https://api2-v2.qoder.sh";

/** Cline fetches free models from OpenRouter */
export const BASE_URL_OPENROUTER = "https://openrouter.ai/api/v1";

// =============================================================================
// External URLs
// =============================================================================

export const URL_MODELS_DEV = "https://models.dev/api.json";
export const URL_KILO_TOS = "https://kilo.ai/terms";

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
