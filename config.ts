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
	PROVIDER_QWEN,
	PROVIDER_ROUTEWAY,
} from "./constants.ts";
import { createLogger } from "./lib/logger.ts";

const _logger = createLogger("config");

interface PiFreeConfig {
	nvidia_api_key?: string;
	ollama_api_key?: string;
	zenmux_api_key?: string;
	crofai_api_key?: string;
	codestral_api_key?: string;
	llm7_api_key?: string;
	deepinfra_api_key?: string;
	sambanova_api_key?: string;
	together_api_key?: string;
	novita_api_key?: string;
	routeway_api_key?: string;
	fastrouter_api_key?: string;
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
	together_show_paid?: boolean;
	novita_show_paid?: boolean;
	routeway_show_paid?: boolean;
	fastrouter_show_paid?: boolean;
	openrouter_show_paid?: boolean;
	opencode_show_paid?: boolean;
}

const CONFIG_TEMPLATE: PiFreeConfig = {
	nvidia_api_key: "",
	ollama_api_key: "",
	zenmux_api_key: "",
	crofai_api_key: "",
	codestral_api_key: "",
	llm7_api_key: "",
	deepinfra_api_key: "",
	sambanova_api_key: "",
	together_api_key: "",
	novita_api_key: "",
	routeway_api_key: "",
	fastrouter_api_key: "",

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
	together_show_paid: false,
	novita_show_paid: false,
	routeway_show_paid: false,
	fastrouter_show_paid: false,
	openrouter_show_paid: false,
	opencode_show_paid: false,
};

const PI_DIR = join(process.env.HOME || process.env.USERPROFILE || "", ".pi");
const CONFIG_PATH = join(PI_DIR, "free.json");

function ensureConfigFile(): void {
	try {
		mkdirSync(PI_DIR, { recursive: true });
		if (existsSync(CONFIG_PATH)) {
			let existing: PiFreeConfig;
			try {
				existing = JSON.parse(
					readFileSync(CONFIG_PATH, "utf8"),
				) as PiFreeConfig;
			} catch (_parseErr) {
				// File exists but is corrupt — DO NOT overwrite it.
				// The user needs to fix or delete it manually.
				_logger.error(
					"Config file exists but is corrupt — refusing to overwrite. Fix or delete ~/.pi/free.json.",
					{ path: CONFIG_PATH },
				);
				return;
			}
			// Merge with template to add any missing keys, preserving existing values
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
		_logger.error("Could not parse config file — returning empty config", {
			path: CONFIG_PATH,
			error: err instanceof Error ? err.message : String(err),
		});
		return {};
	}
}

/**
 * Read the raw config file content without merging with template.
 * Returns the file content as string, or undefined if unreadable.
 */
function readRawConfigFile(): string | undefined {
	try {
		return readFileSync(CONFIG_PATH, "utf8");
	} catch {
		return undefined;
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

export function getTogetherShowPaid(): boolean {
	return resolveBool("TOGETHER_SHOW_PAID", loadConfigFile().together_show_paid);
}

export function getNovitaShowPaid(): boolean {
	return resolveBool("NOVITA_SHOW_PAID", loadConfigFile().novita_show_paid);
}

export function getRoutewayShowPaid(): boolean {
	return resolveBool("ROUTEWAY_SHOW_PAID", loadConfigFile().routeway_show_paid);
}

export function getFastrouterShowPaid(): boolean {
	return resolveBool(
		"FASTROUTER_SHOW_PAID",
		loadConfigFile().fastrouter_show_paid,
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

export function getProviderShowPaid(providerId: string): boolean {
	switch (providerId) {
		case "kilo":
			return getKiloShowPaid();
		case "cline":
			return getClineShowPaid();
		case "zenmux":
			return getZenmuxShowPaid();
		case "crofai":
			return getCrofaiShowPaid();
		case "codestral":
			return getCodestralShowPaid();
		case "llm7":
			return getLlm7ShowPaid();
		case "deepinfra":
			return getDeepinfraShowPaid();
		case "sambanova":
			return getSambanovaShowPaid();
		case "together":
			return getTogetherShowPaid();
		case "novita":
			return getNovitaShowPaid();
		case "routeway":
			return getRoutewayShowPaid();
		case "fastrouter":
			return getFastrouterShowPaid();
		case "ollama-cloud":
			return getOllamaShowPaid();
		case "openrouter":
			return getOpenrouterShowPaid();
		case "opencode":
			return getOpencodeShowPaid();
		default:
			return false;
	}
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

export function getTogetherApiKey(): string | undefined {
	return resolve("TOGETHER_AI_API_KEY", loadConfigFile().together_api_key);
}

export function getNovitaApiKey(): string | undefined {
	return resolve("NOVITA_API_KEY", loadConfigFile().novita_api_key);
}

export function getRoutewayApiKey(): string | undefined {
	return resolve("ROUTEWAY_API_KEY", loadConfigFile().routeway_api_key);
}

export function getFastrouterApiKey(): string | undefined {
	return resolve("FASTROUTER_API_KEY", loadConfigFile().fastrouter_api_key);
}

export function getOllamaApiKey(): string | undefined {
	return resolve("OLLAMA_API_KEY", loadConfigFile().ollama_api_key);
}

/** Mistral is pi's built-in provider — key comes from env var only. */
export function getMistralApiKey(): string | undefined {
	return process.env.MISTRAL_API_KEY;
}

/** Groq is pi's built-in provider — key comes from env var only. */
export function getGroqApiKey(): string | undefined {
	return process.env.GROQ_API_KEY;
}

/** Cerebras is pi's built-in provider — key comes from env var only. */
export function getCerebrasApiKey(): string | undefined {
	return process.env.CEREBRAS_API_KEY;
}

/** xAI is pi's built-in provider — key comes from env var only. */
export function getXaiApiKey(): string | undefined {
	return process.env.XAI_API_KEY;
}

/** HuggingFace is pi's built-in provider — token comes from env var only. */
export function getHfToken(): string | undefined {
	return process.env.HF_TOKEN;
}

/**
 * Read an API key from ~/.pi/agent/auth.json.
 * Pi stores built-in provider keys there (opencode, openrouter, etc.).
 * Falls back to env var if auth.json is missing or key not found.
 */
function readAuthJsonKey(
	providerId: string,
	envVar: string,
): string | undefined {
	// Check env var first (fast path)
	const envVal = process.env[envVar];
	if (envVal) return envVal;

	// Check auth.json
	try {
		const authPath = join(PI_DIR, "agent", "auth.json");
		if (!existsSync(authPath)) return undefined;
		const raw = readFileSync(authPath, "utf8");
		const auth = JSON.parse(raw) as Record<
			string,
			{ type?: string; key?: string }
		>;
		const entry = auth[providerId];
		if (entry?.key?.trim()) return entry.key;
	} catch {
		// auth.json missing or corrupt — silently skip
	}
	return undefined;
}

/**
 * OpenRouter key — pi's built-in provider reads from ~/.pi/agent/auth.json.
 * pi-free checks env var first, then auth.json.
 */
export function getOpenrouterApiKey(): string | undefined {
	return readAuthJsonKey("openrouter", "OPENROUTER_API_KEY");
}

/** OpenCode key — pi's built-in provider. Read from env or auth.json. */
export function getOpencodeApiKey(): string | undefined {
	return readAuthJsonKey("opencode", "OPENCODE_API_KEY");
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
		// Read the raw file content — never use loadConfigFile() here because
		// if the file is unparseable, loadConfigFile() returns {} which would
		// cause us to write a partial config and WIPE all existing keys.
		const raw = readRawConfigFile();
		if (raw === undefined) {
			// File doesn't exist or can't be read — start from template
			const merged = { ...CONFIG_TEMPLATE, ...updates };
			writeFileSync(
				CONFIG_PATH,
				`${JSON.stringify(merged, null, 2)}\n`,
				"utf8",
			);
			_logger.info("Config saved (new file)", {
				path: CONFIG_PATH,
				keys: Object.keys(updates),
			});
			return;
		}

		let existing: PiFreeConfig;
		try {
			existing = JSON.parse(raw) as PiFreeConfig;
		} catch (parseErr) {
			// File exists but is corrupt. REFUSE to overwrite it with a partial
			// config — that would permanently destroy the user's keys.
			_logger.error(
				"REFUSING to save config — existing file is corrupt. Fix or delete ~/.pi/free.json manually.",
				{
					path: CONFIG_PATH,
					error:
						parseErr instanceof Error ? parseErr.message : String(parseErr),
				},
			);
			return;
		}

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
