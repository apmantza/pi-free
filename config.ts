/**
 * Shared config for pi-free-providers.
 *
 * Keys and flags are resolved in this order (first wins):
 *   1. Environment variable
 *   2. ~/.pi/free.json
 *
 * Per-provider paid model flags:
 *   KILO_SHOW_PAID=true or kilo_show_paid: true
 *   NVIDIA_SHOW_PAID=true or nvidia_show_paid: true
 *   FIREWORKS_SHOW_PAID=true or fireworks_show_paid: true
 *   CLINE_SHOW_PAID=true or cline_show_paid: true
 *   QWEN_SHOW_PAID=true or qwen_show_paid: true
 *   MODAL_SHOW_PAID=true or modal_show_paid: true
 *
 * PI_FREE_KILO_FREE_ONLY=true — restrict Kilo to free models even after login.
 *
 * Global free-only mode (new in v2.0):
 *   PI_FREE_ONLY=true or free_only: true — applies to ALL providers
 *   Use /free command to toggle interactively
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	PROVIDER_CLINE,
	PROVIDER_FIREWORKS,
	PROVIDER_KILO,
	PROVIDER_MODAL,
	PROVIDER_NVIDIA,
	PROVIDER_QWEN,
} from "./constants.ts";
import { createLogger } from "./lib/logger.ts";

const _logger = createLogger("config");

interface PiFreeConfig {
	// API Keys
	nvidia_api_key?: string;
	cloudflare_api_token?: string;
	cloudflare_account_id?: string;
	ollama_api_key?: string;
	fireworks_api_key?: string;
	modal_api_key?: string;
	opencode_api_key?: string; // Used by some providers
	kilo_free_only?: boolean;
	hidden_models?: string[];

	// Global free-only mode (v2.0+)
	free_only?: boolean;

	// Per-provider paid model flags
	kilo_show_paid?: boolean;
	nvidia_show_paid?: boolean;
	cloudflare_show_paid?: boolean;
	ollama_show_paid?: boolean;
	fireworks_show_paid?: boolean;
	cline_show_paid?: boolean;
	/** @deprecated Qwen provider is deprecated */
	qwen_show_paid?: boolean;
	modal_show_paid?: boolean;
	// Built-in pi providers
	openrouter_show_paid?: boolean;
}

const CONFIG_TEMPLATE: PiFreeConfig = {
	nvidia_api_key: "",
	cloudflare_api_token: "",
	cloudflare_account_id: "",
	ollama_api_key: "",
	fireworks_api_key: "",
	modal_api_key: "",
	opencode_api_key: "",
	kilo_free_only: false,
	hidden_models: [],
	free_only: true,
	kilo_show_paid: false,
	nvidia_show_paid: false,
	cloudflare_show_paid: false,
	ollama_show_paid: false,
	fireworks_show_paid: false,
	cline_show_paid: false,
	/** @deprecated Qwen provider is deprecated */
	qwen_show_paid: false,
	modal_show_paid: false,
	// Built-in pi providers - default to showing only free
	openrouter_show_paid: false,
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

// Per-provider paid model flags - default to false (free-only) if not set
export const KILO_SHOW_PAID = resolveBool(
	"KILO_SHOW_PAID",
	file.kilo_show_paid,
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
/** @deprecated Qwen provider is deprecated. The 1,000 req/day free tier is no longer available. */
export const QWEN_SHOW_PAID = resolveBool(
	"QWEN_SHOW_PAID",
	file.qwen_show_paid,
);
if (QWEN_SHOW_PAID) {
	_logger.warn(
		"QWEN_SHOW_PAID is set but Qwen provider is deprecated. The 1,000 req/day free tier is no longer available.",
	);
}
export const MODAL_SHOW_PAID = resolveBool(
	"MODAL_SHOW_PAID",
	file.modal_show_paid,
);
export const OLLAMA_SHOW_PAID = resolveBool(
	"OLLAMA_SHOW_PAID",
	file.ollama_show_paid,
);
export const CLOUDFLARE_SHOW_PAID = resolveBool(
	"CLOUDFLARE_SHOW_PAID",
	file.cloudflare_show_paid,
);

// Built-in pi providers - per-provider free model filtering
export const OPENROUTER_SHOW_PAID = resolveBool(
	"OPENROUTER_SHOW_PAID",
	file.openrouter_show_paid,
);

// Global free-only mode (new in v2.0) - applies to ALL providers
export const FREE_ONLY = resolveBool("PI_FREE_ONLY", file.free_only);

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

// API Keys
export const NVIDIA_API_KEY = resolve("NVIDIA_API_KEY", file.nvidia_api_key);
export const FIREWORKS_API_KEY = resolve(
	"FIREWORKS_API_KEY",
	file.fireworks_api_key,
);
export const MODAL_API_KEY = resolve("MODAL_API_KEY", file.modal_api_key);
export const OLLAMA_API_KEY = resolve("OLLAMA_API_KEY", file.ollama_api_key);
export const CLOUDFLARE_API_TOKEN = resolve(
	"CLOUDFLARE_API_TOKEN",
	file.cloudflare_api_token,
);
export const CLOUDFLARE_ACCOUNT_ID = resolve(
	"CLOUDFLARE_ACCOUNT_ID",
	file.cloudflare_account_id,
);
export const OPENCODE_API_KEY = resolve(
	"OPENCODE_API_KEY",
	file.opencode_api_key,
);

// Re-export provider names for consistency
export {
	PROVIDER_CLINE,
	PROVIDER_FIREWORKS,
	PROVIDER_KILO,
	PROVIDER_MODAL,
	PROVIDER_NVIDIA,
	PROVIDER_QWEN,
};

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
