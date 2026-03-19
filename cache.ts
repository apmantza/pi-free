/**
 * File-backed model cache for pi-free-providers.
 *
 * Stored at ~/.pi/free-cache.json with a 1-hour TTL.
 * An in-memory copy is kept for the duration of the session so repeated
 * provider lookups (e.g. session_start + model_select) don't hit disk.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { CACHE_TTL_MS } from "./constants.ts";

const CACHE_PATH = join(process.env.HOME || process.env.USERPROFILE || "", ".pi", "free-cache.json");

interface CacheEntry {
  models: unknown[];
  fetched_at: number;
}

interface CacheStore {
  [key: string]: CacheEntry;
}

// In-memory copy — loaded once per process, flushed on every write.
let mem: CacheStore | null = null;

function load(): CacheStore {
  if (mem) return mem;
  try {
    mem = JSON.parse(readFileSync(CACHE_PATH, "utf8")) as CacheStore;
  } catch {
    mem = {};
  }
  return mem;
}

function save(): void {
  if (!mem) return;
  try {
    // Ensure directory exists
    const dir = join(process.env.HOME || process.env.USERPROFILE || "", ".pi");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(CACHE_PATH, JSON.stringify(mem, null, 2) + "\n", "utf8");
  } catch { /* non-fatal */ }
}

/** Returns cached models for `key` if they exist and are within TTL, otherwise null. */
export function getCached<T>(key: string): T[] | null {
  const entry = load()[key];
  if (!entry) return null;
  if (Date.now() - entry.fetched_at > CACHE_TTL_MS) return null;
  return entry.models as T[];
}

/** Stores models for `key` in the cache. */
export function setCached<T>(key: string, models: T[]): void {
  const store = load();
  store[key] = { models: models as unknown[], fetched_at: Date.now() };
  save();
}

/** Invalidates a single cache entry (e.g. after login when the full model list changes). */
export function invalidate(key: string): void {
  const store = load();
  delete store[key];
  save();
}

/** Clears all cache entries. */
export function clearCache(): void {
  mem = {};
  save();
}
