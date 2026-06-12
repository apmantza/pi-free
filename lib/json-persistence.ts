/**
 * Shared JSON persistence utilities.
 * Consolidated file I/O patterns from usage-store.ts and free-tier-limits.ts
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createLogger } from "./logger.ts";
import { ensureDir } from "./paths.ts";

const _logger = createLogger("json-persistence");

/**
 * JSON.parse reviver that strips prototype-pollution payloads.
 * Filters out `__proto__` and `constructor` keys at every level of the
 * parsed object, preventing attackers from polluting Object.prototype
 * through crafted config/cache files.
 */
function safeJsonReviver(_key: string, value: unknown): unknown {
	if (_key === "__proto__" || _key === "constructor") {
		return undefined;
	}
	return value;
}

export interface JSONStore<T> {
	load(): T;
	save(data: T): void;
	update(updater: (data: T) => T): Promise<T>;
}

class Lock {
	private promise: Promise<void> = Promise.resolve();

	async acquire(): Promise<() => void> {
		let release: () => void;
		const newPromise = new Promise<void>((resolve) => {
			release = resolve;
		});
		const previous = this.promise;
		this.promise = previous.then(() => newPromise);
		await previous;
		return release!;
	}
}

/**
 * Create a JSON file store with automatic directory creation and error handling.
 */
export function createJSONStore<T extends object>(
	filepath: string,
	defaultValue: T,
): JSONStore<T> {
	let cached: T | null = null;
	const lock = new Lock();

	function load(): T {
		if (cached) return cached;
		try {
			if (existsSync(filepath)) {
				cached = JSON.parse(
					readFileSync(filepath, "utf-8"),
					safeJsonReviver,
				) as T;
				return cached;
			}
		} catch (err) {
			_logger.warn("Failed to load JSON store, using default", {
				filepath,
				error: err,
			});
		}
		cached = defaultValue;
		return cached;
	}

	function save(data: T): void {
		cached = data;
		try {
			ensureDir(dirname(filepath));
			writeFileSync(filepath, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
		} catch (err) {
			_logger.warn("Failed to save JSON store", { filepath, error: err });
		}
	}

	async function update(updater: (data: T) => T): Promise<T> {
		const release = await lock.acquire();
		try {
			const data = load();
			const updated = updater(data);
			save(updated);
			return updated;
		} finally {
			release();
		}
	}

	return { load, save, update };
}

/**
 * Create a JSONL (newline-delimited JSON) store for append-only logs.
 *
 * `append` and `clear` are async and serialised by an internal lock to
 * prevent interleaved writes (e.g. `clear` truncating the file while
 * `append` is mid-write).
 */
export function createJSONLStore<T extends object>(
	filepath: string,
): {
	load(): T[];
	append(entry: T): Promise<void>;
	clear(): Promise<void>;
} {
	const lock = new Lock();

	function load(): T[] {
		try {
			if (existsSync(filepath)) {
				const content = readFileSync(filepath, "utf-8");
				const lines = content.split("\n").filter((line) => line.trim());
				const entries: T[] = [];
				for (const [index, line] of lines.entries()) {
					try {
						entries.push(JSON.parse(line, safeJsonReviver) as T);
					} catch (err) {
						_logger.warn("Malformed JSONL line skipped", {
							filepath,
							line: index + 1,
							error: err,
						});
					}
				}
				return entries;
			}
		} catch (err) {
			_logger.warn("Failed to load JSONL store, using empty array", {
				filepath,
				error: err,
			});
		}
		return [];
	}

	async function append(entry: T): Promise<void> {
		const release = await lock.acquire();
		try {
			ensureDir(dirname(filepath));
			const line = JSON.stringify(entry);
			writeFileSync(filepath, `${line}\n`, { flag: "a", encoding: "utf-8" });
		} catch (err) {
			_logger.warn("Failed to append to JSONL store", { filepath, error: err });
		} finally {
			release();
		}
	}

	async function clear(): Promise<void> {
		const release = await lock.acquire();
		try {
			writeFileSync(filepath, "", "utf-8");
		} catch (err) {
			_logger.warn("Failed to clear JSONL store", { filepath, error: err });
		} finally {
			release();
		}
	}

	return { load, append, clear };
}
