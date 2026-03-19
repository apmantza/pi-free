/**
 * Shared constants for pi-free-providers.
 * Centralizes provider names, cache keys, and configuration values.
 */

// =============================================================================
// Provider names (must match registerProvider calls)
// =============================================================================

export const PROVIDER_KILO = "kilo";
export const PROVIDER_ZEN = "zen";
export const PROVIDER_OPENROUTER = "openrouter";
export const PROVIDER_NVIDIA = "nvidia";
export const PROVIDER_CLINE = "cline";

export const ALL_PROVIDERS = [PROVIDER_KILO, PROVIDER_ZEN, PROVIDER_OPENROUTER, PROVIDER_NVIDIA, PROVIDER_CLINE] as const;

// =============================================================================
// Cache keys
// =============================================================================

export const CACHE_KEY_KILO_FREE = "kilo-free";
export const CACHE_KEY_KILO_ALL = "kilo-all";
export const CACHE_KEY_ZEN = "zen";
export const CACHE_KEY_OPENROUTER_FREE = "openrouter-free";
export const CACHE_KEY_OPENROUTER_ALL = "openrouter-all";
export const CACHE_KEY_NVIDIA = "nvidia";
export const CACHE_KEY_CLINE = "cline";

// =============================================================================
// Provider base URLs
// =============================================================================

export const BASE_URL_KILO = "https://api.kilo.ai/api/gateway";
export const BASE_URL_ZEN = "https://opencode.ai/zen/v1";
export const BASE_URL_OPENROUTER = "https://openrouter.ai/api/v1";
export const BASE_URL_NVIDIA = "https://integrate.api.nvidia.com/v1";
export const BASE_URL_CLINE = "https://api.cline.bot/api/v1";

// =============================================================================
// External URLs
// =============================================================================

export const URL_MODELS_DEV = "https://models.dev/api.json";
export const URL_KILO_TOS = "https://kilo.ai/terms";
export const URL_ZEN_TOS = "https://opencode.ai/terms";
export const URL_CLINE_TOS = "https://cline.bot/tos";

// =============================================================================
// Cline auth
// =============================================================================

export const CLINE_AUTH_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// =============================================================================
// Configuration thresholds
// =============================================================================

export const NVIDIA_MIN_SIZE_B = 70;        // Minimum model size for NVIDIA NIM
export const DEFAULT_MIN_SIZE_B = 30;       // Default minimum model size for filtering

// =============================================================================
// Timeouts (milliseconds)
// =============================================================================

export const DEFAULT_FETCH_TIMEOUT_MS = 10_000;
export const KILO_POLL_INTERVAL_MS = 3_000;
export const KILO_TOKEN_EXPIRATION_MS = 365 * 24 * 60 * 60 * 1000; // 1 year

// =============================================================================
// Cache settings
// =============================================================================

export const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
