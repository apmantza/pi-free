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
export const PROVIDER_NOVITA = "novita";
export const PROVIDER_ROUTEWAY = "routeway";
export const PROVIDER_OPENGATEWAY = "opengateway";
export const PROVIDER_TOKENROUTER = "tokenrouter";
export const PROVIDER_ANYAPI = "anyapi";
export const PROVIDER_BAI = "bai";
export const PROVIDER_QODER = "qoder";
export const PROVIDER_FASTROUTER = "fastrouter";
export const PROVIDER_REQUESTY = "requesty";
export const PROVIDER_STEPFUN = "stepfun";
export const PROVIDER_GMI = "gmi";
export const PROVIDER_AGNES = "agnes";
export const PROVIDER_VENICE = "venice";
export const PROVIDER_INFRON = "infron";

// Built-in pi providers that pi-free wraps with toggles
export const PROVIDER_OPENROUTER = "openrouter";
export const PROVIDER_OPENCODE = "opencode";
// Distinct registration ids for the OpenCode Zen tiers (pi's built-in
// provider is registered as "opencode"; see lib/built-in-toggle.ts).
export const PROVIDER_OPENCODE_FREE = "opencode-free";
export const PROVIDER_OPENCODE_GO = "opencode-go";

// =============================================================================
// Provider base URLs
// =============================================================================

export const BASE_URL_OLLAMA = "https://ollama.com/v1"; // OpenAI-compatible API endpoint
export const BASE_URL_CLINE = "https://api.cline.bot/api/v1";
/**
 * Cline client identity reported to the gateway in request headers.
 * Cline gates some models (e.g. deepseek/deepseek-v4-flash) to its own
 * product surfaces and rejects stale client versions (403 "only available
 * via Cline product surfaces … update to the latest version"). Keep these in
 * sync with the current Cline extension version (marketplace
 * saoudrizwan.claude-dev). Single source of truth for cline-provider.ts,
 * cline-auth.ts and cline-models.ts — they must not define their own copies.
 */
export const CLINE_EXTENSION_VERSION = "4.1.10";
export const VS_CODE_VERSION = "1.109.3";
export const BASE_URL_ZENMUX = "https://zenmux.ai/api/v1";
export const BASE_URL_CROFAI = "https://crof.ai/v1";
export const BASE_URL_LLM7 = "https://api.llm7.io/v1";
export const BASE_URL_DEEPINFRA = "https://api.deepinfra.com/v1/openai";
export const BASE_URL_SAMBANOVA = "https://api.sambanova.ai/v1";
export const BASE_URL_NOVITA = "https://api.novita.ai/openai/v1";
export const BASE_URL_ROUTEWAY = "https://api.routeway.ai/v1";
export const BASE_URL_OPENGATEWAY = "https://opengateway.gitlawb.com/v1";
export const BASE_URL_TOKENROUTER = "https://api.tokenrouter.com/v1";
export const BASE_URL_ANYAPI = "https://api.anyapi.ai/v1";
export const BASE_URL_BAI = "https://api.b.ai/v1";
export const BASE_URL_FASTROUTER = "https://api.fastrouter.ai/api/v1";
export const BASE_URL_REQUESTY = "https://router.requesty.ai/v1";
/** StepFun Step Plan OpenAI-compatible Chat Completions API base URL. */
export const BASE_URL_STEPFUN = "https://api.stepfun.ai/step_plan/v1";
/** GMI Cloud OpenAI-compatible Inference API base URL. */
export const BASE_URL_GMI = "https://api.gmi-serving.com/v1";
/** Agnes AI OpenAI-compatible free gateway base URL. */
export const BASE_URL_AGNES = "https://apihub.agnes-ai.com/v1";
/** Venice AI OpenAI-compatible inference API base URL. */
export const BASE_URL_VENICE = "https://api.venice.ai/api/v1";
/** Infron AI unified gateway (OneRouter) OpenAI-compatible API base URL. */
export const BASE_URL_INFRON = "https://llm.onerouter.pro/v1";
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

/**
 * Hard upper bound on how long a startup model-list fetch may block the
 * extension factory — and therefore Pi session start, which awaits the async
 * factory before flushing provider registrations.
 *
 * On a cold/stale cache a provider's own fetch+retry budget can run for tens
 * of seconds against an unresponsive API (measured up to ~66s with several
 * keyed providers). We stop *waiting* after this deadline and fall back to the
 * stale cache (or an empty list on a true cold start), refreshing on a later
 * session_start. Healthy fetches complete in well under a second, so this only
 * ever trips on a degraded network. Overridable via
 * PI_FREE_STARTUP_FETCH_TIMEOUT_MS (milliseconds).
 */
export const STARTUP_FETCH_DEADLINE_MS: number = (() => {
 const raw = Number.parseInt(
  process.env.PI_FREE_STARTUP_FETCH_TIMEOUT_MS ?? "",
  10,
 );
 return Number.isFinite(raw) && raw > 0 ? raw : 8_000;
})();

export const KILO_POLL_INTERVAL_MS = 3_000;
export const KILO_TOKEN_EXPIRATION_MS = 365 * 24 * 60 * 60 * 1000; // 1 year

// =============================================================================
// Removed providers (now built into pi):
// - openrouter: use pi's built-in with OPENROUTER_API_KEY
// - zen/opencode: use pi's built-in with OPENCODE_API_KEY
// - go/opencode-go: use pi's built-in with OPENCODE_API_KEY
// - mistral: use pi's built-in with MISTRAL_API_KEY
// - groq: use pi's built-in with GROQ_API_KEY
// - cerebras: use pi's built-in with CEREBRAS_API_KEY
// - xai: use pi's built-in with XAI_API_KEY
// - huggingface: use pi's built-in with HF_TOKEN
// - together: use pi's built-in with TOGETHER_API_KEY (pi-free used TOGETHER_AI_API_KEY)
// - ollama: add to ~/.pi/agent/models.json as custom provider
// =============================================================================
