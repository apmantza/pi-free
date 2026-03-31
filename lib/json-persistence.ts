/**
 * Shared JSON persistence utilities.
 * Consolidates file I/O patterns from usage-store.ts and free-tier-limits.ts
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface JSONStore<T> {
	load(): T;
	save(data: T): void;
}

/**
 * Create a JSON file store with automatic directory creation and error handling.
 */
export function createJSONStore<T extends object>(
	filepath: string,
	defaultValue: T,
): JSONStore<T> {
	let cached: T | null = null;

	function load(): T {
		if (cached) return cached;
		try {
			if (existsSync(filepath)) {
				cached = JSON.parse(readFileSync(filepath, "utf-8")) as T;
				return cached;
			}
		} catch (err) {
			// Silently fail and return default
			void err;
		}
		cached = defaultValue;
		return cached;
	}

	function save(data: T): void {
		cached = data;
		try {
			const dir = dirname(filepath);
			if (!existsSync(dir)) {
				mkdirSync(dir, { recursive: true });
			}
			writeFileSync(filepath, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
		} catch (err) {
			// Silently fail - persistence is best-effort
			void err;
		}
	}

	return { load, save };
}

/**
 * Create a JSONL (newline-delimited JSON) store for append-only logs.
 */
export function createJSONLStore<T extends object>(
	filepath: string,
): {
	load(): T[];
	append(entry: T): void;
	clear(): void;
} {
	function load(): T[] {
		try {
			if (existsSync(filepath)) {
				const content = readFileSync(filepath, "utf-8");
				return content
					.split("\n")
					.filter((line) => line.trim())
					.map((line) => JSON.parse(line) as T);
			}
		} catch {
			// Return empty on error
		}
		return [];
	}

	function append(entry: T): void {
		try {
			const dir = dirname(filepath);
			if (!existsSync(dir)) {
				mkdirSync(dir, { recursive: true });
			}
			const line = JSON.stringify(entry);
			writeFileSync(filepath, `${line}\n`, { flag: "a", encoding: "utf-8" });
		} catch {
			// Silently fail
		}
	}

	function clear(): void {
		try {
			writeFileSync(filepath, "", "utf-8");
		} catch {
			// Silently fail
		}
	}

	return { load, append, clear };
}
