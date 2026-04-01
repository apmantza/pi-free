/**
 * Shared config for pi-free-providers.
 *
 * Keys and flags are resolved in this order (first wins):
 *   1. Environment variable
 *   2. ~/.pi/free.json
 *
 * Per-provider paid model flags:
 *   OPENROUTER_SHOW_PAID=true or openrouter_show_paid: true
 *   NVIDIA_SHOW_PAID=true or nvidia_show_paid: true
 *   FIREWORKS_SHOW_PAID=true or fireworks_show_paid: true
 *   CLINE_SHOW_PAID=true or cline_show_paid: true
 *   OLLAMA_SHOW_PAID=true or ollama_show_paid: true
 *
 * PI_FREE_KILO_FREE_ONLY=true — restrict Kilo to free models even after login.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createLogger } from "./lib/logger.ts";

const _logger = createLogger("config");

interface PiFreeConfig {
	openrouter_api_key?: string;
	nvidia_api_key?: string;
	opencode_api_key?: string;
	fireworks_api_key?: string;
	mistral_api_key?: string;
	ollama_api_key?: string;
	kilo_free_only?: boolean;
	hidden_models?: string[];
	// Per-provider paid model flags
	openrouter_show_paid?: boolean;
	nvidia_show_paid?: boolean;
	fireworks_show_paid?: boolean;
	cline_show_paid?: boolean;
	zen_show_paid?: boolean;
	mistral_show_paid?: boolean;
	ollama_show_paid?: boolean;
}

const CONFIG_TEMPLATE: PiFreeConfig = {
	openrouter_api_key: "",
	nvidia_api_key: "",
	opencode_api_key: "",
	fireworks_api_key: "",
	mistral_api_key: "",
	ollama_api_key: "",
	kilo_free_only: false,
	hidden_models: [],
	openrouter_show_paid: false,
	nvidia_show_paid: false,
	fireworks_show_paid: false,
	cline_show_paid: false,
	zen_show_paid: false,
	mistral_show_paid: false,
	ollama_show_paid: false,
};

const PI_DIR = join(process.env.HOME || process.env.USERPROFILE || "", ".pi");
const CONFIG_PATH = join(PI_DIR, "free.json");

function ensureConfigFile(): void {
	try {
		mkdirSync(PI_DIR, { recursive: true });
		if (existsSync(CONFIG_PATH)) {
			// Merge: add any new template keys without touching existing values
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

function loadConfigFile(): PiFreeConfig {
	try {
		return JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as PiFreeConfig;
	} catch {
		return {};
	}
}

ensureConfigFile();
const file = loadConfigFile();

// Resolve each value: env var takes priority over config file.
// Treat empty strings in the config file as unset.
function resolve(envKey: string, fileVal?: string): string | undefined {
	return process.env[envKey] || (fileVal?.trim() ? fileVal : undefined);
}

// Resolve boolean flag: env var takes priority, then config file.
// If neither is set, defaults to false (free-only mode).
function resolveBool(envKey: string, fileVal?: boolean): boolean {
	const envValue = process.env[envKey];
	if (envValue === "true") return true;
	if (envValue === "false") return false;
	return fileVal === true;
}

// Global fallback (deprecated, use per-provider flags)
// Returns true only if explicitly enabled via env var
export const SHOW_PAID = process.env.PI_FREE_SHOW_PAID === "true";

// Per-provider paid model flags - default to false (free-only) if not set
export const OPENROUTER_SHOW_PAID = resolveBool(
	"OPENROUTER_SHOW_PAID",
	file.openrouter_show_paid,
);

export const NVIDIA_SHOW_PAID = resolveBool(
	"NVIDIA_SHOW_PAID",
	file.nvidia_show_paid,
);

export const FIREWORKS_SHOW_PAID = resolveBool(
	"FIREWORKS_SHOW_PAID",
	file.fireworks_show_paid,
);

export const CLINE_SHOW_PAID = resolveBool(
	"CLINE_SHOW_PAID",
	file.cline_show_paid,
);

export const ZEN_SHOW_PAID = resolveBool("ZEN_SHOW_PAID", file.zen_show_paid);

export const MISTRAL_SHOW_PAID = resolveBool(
	"MISTRAL_SHOW_PAID",
	file.mistral_show_paid,
);

export const OLLAMA_SHOW_PAID = resolveBool(
	"OLLAMA_SHOW_PAID",
	file.ollama_show_paid,
);

export const KILO_FREE_ONLY = resolveBool(
	"PI_FREE_KILO_FREE_ONLY",
	file.kilo_free_only,
);

const HIDDEN: Set<string> = new Set(file.hidden_models ?? []);

/** Removes any models whose id appears in hidden_models. */
export function applyHidden<T extends { id: string }>(models: T[]): T[] {
	if (HIDDEN.size === 0) return models;
	return models.filter((m) => !HIDDEN.has(m.id));
}

export const OPENROUTER_API_KEY = resolve(
	"OPENROUTER_API_KEY",
	file.openrouter_api_key,
);
export const NVIDIA_API_KEY = resolve("NVIDIA_API_KEY", file.nvidia_api_key);
export const OPENCODE_API_KEY = resolve(
	"OPENCODE_API_KEY",
	file.opencode_api_key,
);
export const FIREWORKS_API_KEY = resolve(
	"FIREWORKS_API_KEY",
	file.fireworks_api_key,
);
export const MISTRAL_API_KEY = resolve("MISTRAL_API_KEY", file.mistral_api_key);
export const OLLAMA_API_KEY = resolve("OLLAMA_API_KEY", file.ollama_api_key);

// Re-export provider names for consistency
export {
	PROVIDER_CLINE,
	PROVIDER_FIREWORKS,
	PROVIDER_KILO,
	PROVIDER_MISTRAL,
	PROVIDER_NVIDIA,
	PROVIDER_OLLAMA,
	PROVIDER_OPENROUTER,
	PROVIDER_ZEN,
} from "./constants.ts";

// =============================================================================
// Config Persistence
// =============================================================================

/** Save updated config values to ~/.pi/free.json */
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

/** Get current config values (for checking state) */
export function getConfig(): PiFreeConfig {
	return loadConfigFile();
}
