/**
 * Shared config for pi-free-providers.
 *
 * Keys and flags are resolved in this order (first wins):
 *   1. Environment variable
 *   2. ~/.pi/free.json
 *
 * All exported values are getter functions so that runtime changes
 * (e.g. after toggle-{provider}) are visible immediately.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
export {
	PROVIDER_CLINE,
	PROVIDER_KILO,
	PROVIDER_MODAL,
	PROVIDER_NVIDIA,
	PROVIDER_QWEN,
} from "./constants.ts";
import { createLogger } from "./lib/logger.ts";

const _logger = createLogger("config");

interface PiFreeConfig {
	nvidia_api_key?: string;
	ollama_api_key?: string;
	zenmux_api_key?: string;
	crofai_api_key?: string;
	codestral_api_key?: string;
	mistral_api_key?: string;
	llm7_api_key?: string;
	deepinfra_api_key?: string;
	sambanova_api_key?: string;
	groq_api_key?: string;
	cerebras_api_key?: string;
	xai_api_key?: string;
	hf_token?: string;
	kilo_free_only?: boolean;
	hidden_models?: string[];
	free_only?: boolean;
	kilo_show_paid?: boolean;
	ollama_show_paid?: boolean;
	cline_show_paid?: boolean;
	zenmux_show_paid?: boolean;
	crofai_show_paid?: boolean;
	codestral_show_paid?: boolean;
	llm7_show_paid?: boolean;
	deepinfra_show_paid?: boolean;
	sambanova_show_paid?: boolean;
	openrouter_show_paid?: boolean;
	opencode_show_paid?: boolean;
}

const CONFIG_TEMPLATE: PiFreeConfig = {
	nvidia_api_key: "",
	ollama_api_key: "",
	zenmux_api_key: "",
	crofai_api_key: "",
	codestral_api_key: "",
	mistral_api_key: "",
	llm7_api_key: "",
	deepinfra_api_key: "",
	sambanova_api_key: "",
	groq_api_key: "",
	cerebras_api_key: "",
	xai_api_key: "",
	hf_token: "",

	kilo_free_only: false,
	hidden_models: [],
	free_only: true,
	kilo_show_paid: false,
	ollama_show_paid: false,
	cline_show_paid: false,
	zenmux_show_paid: false,
	crofai_show_paid: false,
	codestral_show_paid: false,
	llm7_show_paid: false,
	deepinfra_show_paid: false,
	sambanova_show_paid: false,
	openrouter_show_paid: false,
	opencode_show_paid: false,
};

const PI_DIR = join(process.env.HOME || process.env.USERPROFILE || "", ".pi");
const CONFIG_PATH = join(PI_DIR, "free.json");

function ensureConfigFile(): void {
	try {
		mkdirSync(PI_DIR, { recursive: true });
		if (existsSync(CONFIG_PATH)) {
			const existing = JSON.parse(
				readFileSync(CONFIG_PATH, "utf8"),
			) as PiFreeConfig;
			const merged = { ...CONFIG_TEMPLATE, ...existing };
			if (JSON.stringify(merged) !== JSON.stringify(existing)) {
				writeFileSync(
					CONFIG_PATH,
					`${JSON.stringify(merged, null, 2)}\n`,
					"utf8",
				);
			}
		} else {
			writeFileSync(
				CONFIG_PATH,
				`${JSON.stringify(CONFIG_TEMPLATE, null, 2)}\n`,
				"utf8",
			);
		}
	} catch (err) {
		_logger.warn("Could not create config file", {
			path: CONFIG_PATH,
			error: err instanceof Error ? err.message : String(err),
		});
	}
}

export function loadConfigFile(): PiFreeConfig {
	try {
		return JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as PiFreeConfig;
	} catch (err) {
		_logger.warn("Could not parse config file — returning empty config", {
			path: CONFIG_PATH,
			error: err instanceof Error ? err.message : String(err),
		});
		return {};
	}
}

ensureConfigFile();

// Resolve each value: env var takes priority over config file.
function resolve(envKey: string, fileVal?: string): string | undefined {
	return process.env[envKey] || (fileVal?.trim() ? fileVal : undefined);
}

// Resolve boolean flag: env var takes priority, then config file.
function resolveBool(envKey: string, fileVal?: boolean): boolean {
	const envValue = process.env[envKey];
	if (envValue === "true") return true;
	if (envValue === "false") return false;
	return fileVal === true;
}

// =============================================================================
// Per-provider paid-model flags (getters so toggles reflect immediately)
// =============================================================================

export function getKiloShowPaid(): boolean {
	return resolveBool("KILO_SHOW_PAID", loadConfigFile().kilo_show_paid);
}

export function getClineShowPaid(): boolean {
	return resolveBool("CLINE_SHOW_PAID", loadConfigFile().cline_show_paid);
}

export function getZenmuxShowPaid(): boolean {
	return resolveBool("ZENMUX_SHOW_PAID", loadConfigFile().zenmux_show_paid);
}

export function getCrofaiShowPaid(): boolean {
	return resolveBool("CROFAI_SHOW_PAID", loadConfigFile().crofai_show_paid);
}

export function getCodestralShowPaid(): boolean {
	return resolveBool(
		"CODESTRAL_SHOW_PAID",
		loadConfigFile().codestral_show_paid,
	);
}

export function getLlm7ShowPaid(): boolean {
	return resolveBool("LLM7_SHOW_PAID", loadConfigFile().llm7_show_paid);
}

export function getDeepinfraShowPaid(): boolean {
	return resolveBool(
		"DEEPINFRA_SHOW_PAID",
		loadConfigFile().deepinfra_show_paid,
	);
}

export function getSambanovaShowPaid(): boolean {
	return resolveBool(
		"SAMBANOVA_SHOW_PAID",
		loadConfigFile().sambanova_show_paid,
	);
}

export function getOllamaShowPaid(): boolean {
	return resolveBool("OLLAMA_SHOW_PAID", loadConfigFile().ollama_show_paid);
}

export function getOpenrouterShowPaid(): boolean {
	return resolveBool(
		"OPENROUTER_SHOW_PAID",
		loadConfigFile().openrouter_show_paid,
	);
}

export function getOpencodeShowPaid(): boolean {
	return resolveBool("OPENCODE_SHOW_PAID", loadConfigFile().opencode_show_paid);
}

// =============================================================================
// Global free-only mode
// =============================================================================

export function getFreeOnly(): boolean {
	return resolveBool("PI_FREE_ONLY", loadConfigFile().free_only);
}

export function getKiloFreeOnly(): boolean {
	return resolveBool("PI_FREE_KILO_FREE_ONLY", loadConfigFile().kilo_free_only);
}

// =============================================================================
// API Keys (getters so runtime config changes are visible)
// =============================================================================

export function getNvidiaApiKey(): string | undefined {
	return resolve("NVIDIA_API_KEY", loadConfigFile().nvidia_api_key);
}

export function getZenmuxApiKey(): string | undefined {
	return resolve("ZENMUX_API_KEY", loadConfigFile().zenmux_api_key);
}

export function getCrofaiApiKey(): string | undefined {
	return resolve("CROFAI_API_KEY", loadConfigFile().crofai_api_key);
}

export function getCodestralApiKey(): string | undefined {
	return resolve("CODESTRAL_API_KEY", loadConfigFile().codestral_api_key);
}

export function getLlm7ApiKey(): string | undefined {
	return resolve("LLM7_API_KEY", loadConfigFile().llm7_api_key);
}

export function getDeepinfraApiKey(): string | undefined {
	return resolve("DEEPINFRA_TOKEN", loadConfigFile().deepinfra_api_key);
}

export function getSambanovaApiKey(): string | undefined {
	return resolve("SAMBANOVA_API_KEY", loadConfigFile().sambanova_api_key);
}

export function getOllamaApiKey(): string | undefined {
	return resolve("OLLAMA_API_KEY", loadConfigFile().ollama_api_key);
}

export function getMistralApiKey(): string | undefined {
	return resolve("MISTRAL_API_KEY", loadConfigFile().mistral_api_key);
}

export function getGroqApiKey(): string | undefined {
	return resolve("GROQ_API_KEY", loadConfigFile().groq_api_key);
}

export function getCerebrasApiKey(): string | undefined {
	return resolve("CEREBRAS_API_KEY", loadConfigFile().cerebras_api_key);
}

export function getXaiApiKey(): string | undefined {
	return resolve("XAI_API_KEY", loadConfigFile().xai_api_key);
}

export function getHfToken(): string | undefined {
	return resolve("HF_TOKEN", loadConfigFile().hf_token);
}

/**
 * OpenRouter key — pi's built-in provider reads from ~/.pi/agent/auth.json.
 * pi-free only checks the env var to avoid stale keys from free.json.
 */
export function getOpenrouterApiKey(): string | undefined {
	return process.env.OPENROUTER_API_KEY;
}

// =============================================================================
// Hidden models (re-reads config on every call)
// =============================================================================

/**
 * Apply hidden models filter with provider scoping.
 * Hidden models can be specified as:
 *   - "model-id" (global, applies to all providers - deprecated)
 *   - "provider/model-id" (provider-specific, preferred)
 */
export function applyHidden<T extends { id: string }>(
	models: T[],
	providerId?: string,
): T[] {
	const hidden = new Set(loadConfigFile().hidden_models ?? []);
	if (hidden.size === 0) return models;

	return models.filter((m) => {
		// Check provider-scoped ID (preferred format: "provider/model-id")
		if (providerId && hidden.has(`${providerId}/${m.id}`)) {
			return false;
		}
		// Check global ID (legacy format, still supported for backward compat)
		if (hidden.has(m.id)) {
			return false;
		}
		return true;
	});
}

// =============================================================================
// Persistence
// =============================================================================

export function saveConfig(updates: Partial<PiFreeConfig>): void {
	try {
		const existing = loadConfigFile();
		const merged = { ...existing, ...updates };
		writeFileSync(CONFIG_PATH, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
		_logger.info("Config saved", {
			path: CONFIG_PATH,
			keys: Object.keys(updates),
		});
	} catch (err) {
		_logger.error("Failed to save config", {
			path: CONFIG_PATH,
			error: err instanceof Error ? err.message : String(err),
		});
	}
}

export function getConfig(): PiFreeConfig {
	return loadConfigFile();
}

// =============================================================================
