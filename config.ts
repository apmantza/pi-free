/**
 * Shared config for pi-free-providers.
 *
 * Keys and flags are resolved in this order (first wins):
 *   1. Environment variable
 *   2. ~/.pi-free.json  (auto-created on first run)
 *
 * PI_FREE_SHOW_PAID=true — include paid models for providers where an API key
 *                          is set. Free-only providers (no key) are unaffected.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

interface PiFreeConfig {
  openrouter_api_key?: string;
  nvidia_api_key?: string;
  opencode_api_key?: string;
  show_paid?: boolean;
  kilo_free_only?: boolean;
  hidden_models?: string[];
}

const CONFIG_TEMPLATE: PiFreeConfig = {
  openrouter_api_key: "",
  nvidia_api_key: "",
  opencode_api_key: "",
  show_paid: false,
  kilo_free_only: false,
  hidden_models: [],
};

const PI_DIR = join(process.env.HOME || process.env.USERPROFILE || "", ".pi");
const CONFIG_PATH = join(PI_DIR, "free.json");

function ensureConfigFile(): void {
  if (existsSync(CONFIG_PATH)) return;
  try {
    mkdirSync(PI_DIR, { recursive: true });
    writeFileSync(CONFIG_PATH, JSON.stringify(CONFIG_TEMPLATE, null, 2) + "\n", "utf8");
    console.log(`[pi-free] Created config file at ${CONFIG_PATH} — add your API keys there.`);
  } catch (err) {
    console.warn(`[pi-free] Could not create config file at ${CONFIG_PATH}:`, err instanceof Error ? err.message : err);
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

export const SHOW_PAID =
  process.env.PI_FREE_SHOW_PAID === "true" || file.show_paid === true;

export const KILO_FREE_ONLY =
  process.env.PI_FREE_KILO_FREE_ONLY === "true" || file.kilo_free_only === true;

const HIDDEN: Set<string> = new Set(file.hidden_models ?? []);

/** Removes any models whose id appears in hidden_models. */
export function applyHidden<T extends { id: string }>(models: T[]): T[] {
  if (HIDDEN.size === 0) return models;
  return models.filter((m) => !HIDDEN.has(m.id));
}

export const OPENROUTER_API_KEY = resolve("OPENROUTER_API_KEY", file.openrouter_api_key);
export const NVIDIA_API_KEY     = resolve("NVIDIA_API_KEY",     file.nvidia_api_key);
export const OPENCODE_API_KEY   = resolve("OPENCODE_API_KEY",   file.opencode_api_key);
