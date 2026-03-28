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
 *
 * PI_FREE_KILO_FREE_ONLY=true — restrict Kilo to free models even after login.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface PiFreeConfig {
	openrouter_api_key?: string;
	nvidia_api_key?: string;
	opencode_api_key?: string;
	fireworks_api_key?: string;
	kilo_free_only?: boolean;
	hidden_models?: string[];
	// Per-provider paid model flags
	openrouter_show_paid?: boolean;
	nvidia_show_paid?: boolean;
	fireworks_show_paid?: boolean;
	cline_show_paid?: boolean;
	zen_show_paid?: boolean;
}

const CONFIG_TEMPLATE: PiFreeConfig = {
	openrouter_api_key: "",
	nvidia_api_key: "",
	opencode_api_key: "",
	fireworks_api_key: "",
	kilo_free_only: false,
	hidden_models: [],
	openrouter_show_paid: false,
	nvidia_show_paid: false,
	fireworks_show_paid: false,
	cline_show_paid: false,
	zen_show_paid: false,
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
		console.warn(
			`[pi-free] Could not create config file at ${CONFIG_PATH}:`,
			err instanceof Error ? err.message : err,
		);
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

// Global fallback (deprecated, use per-provider flags)
export const SHOW_PAID =
	process.env.PI_FREE_SHOW_PAID === "true" ||
	file.openrouter_show_paid === true ||
	file.nvidia_show_paid === true ||
	file.fireworks_show_paid === true ||
	file.cline_show_paid === true;

// Per-provider paid model flags
export const OPENROUTER_SHOW_PAID =
	process.env.OPENROUTER_SHOW_PAID === "true" ||
	file.openrouter_show_paid === true;

export const NVIDIA_SHOW_PAID =
	process.env.NVIDIA_SHOW_PAID === "true" || file.nvidia_show_paid === true;

export const FIREWORKS_SHOW_PAID =
	process.env.FIREWORKS_SHOW_PAID === "true" ||
	file.fireworks_show_paid === true;

export const CLINE_SHOW_PAID =
	process.env.CLINE_SHOW_PAID === "true" || file.cline_show_paid === true;

export const ZEN_SHOW_PAID =
	process.env.ZEN_SHOW_PAID === "true" || file.zen_show_paid === true;

export const KILO_FREE_ONLY =
	process.env.PI_FREE_KILO_FREE_ONLY === "true" || file.kilo_free_only === true;

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

// Re-export provider names for consistency
export {
	PROVIDER_CLINE,
	PROVIDER_FIREWORKS,
	PROVIDER_KILO,
	PROVIDER_NVIDIA,
	PROVIDER_OPENROUTER,
	PROVIDER_ZEN,
} from "./constants.ts";
