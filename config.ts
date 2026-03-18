/**
 * Shared config for pi-free-providers.
 *
 * Keys and flags are resolved in this order (first wins):
 *   1. Environment variable
 *   2. ~/.pi-free.json
 *
 * Example ~/.pi-free.json:
 * {
 *   "openrouter_api_key": "sk-or-...",
 *   "nvidia_api_key":     "nvapi-...",
 *   "opencode_api_key":   "oc-...",
 *   "show_paid":          false
 * }
 *
 * PI_FREE_SHOW_PAID=true — include paid models for providers where an API key
 *                          is set. Free-only providers (no key) are unaffected.
 */

import { readFileSync } from "fs";
import { join } from "path";

interface PiFreeConfig {
  openrouter_api_key?: string;
  nvidia_api_key?: string;
  opencode_api_key?: string;
  show_paid?: boolean;
}

function loadConfigFile(): PiFreeConfig {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  try {
    return JSON.parse(readFileSync(join(home, ".pi-free.json"), "utf8")) as PiFreeConfig;
  } catch {
    return {};
  }
}

const file = loadConfigFile();

export const SHOW_PAID =
  process.env.PI_FREE_SHOW_PAID === "true" || file.show_paid === true;

export const OPENROUTER_API_KEY =
  process.env.OPENROUTER_API_KEY || file.openrouter_api_key;

export const NVIDIA_API_KEY =
  process.env.NVIDIA_API_KEY || file.nvidia_api_key;

export const OPENCODE_API_KEY =
  process.env.OPENCODE_API_KEY || file.opencode_api_key;
