/**
 * JSON Persistence Tests
 */

import {
	existsSync,
	mkdirSync,
	rmdirSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJSONLStore, createJSONStore } from "../lib/json-persistence.ts";

const TEST_DIR = join(
	process.env.HOME || process.env.USERPROFILE || "",
	".pi-test",
);

describe("JSON Persistence", () => {
	describe("createJSONStore", () => {
		const testFile = join(TEST_DIR, "test-store.json");

		beforeEach(() => {
			// Clean up
			try {
				if (existsSync(testFile)) unlinkSync(testFile);
			} catch {}
		});

		afterEach(() => {
			try {
				if (existsSync(testFile)) unlinkSync(testFile);
				if (existsSync(TEST_DIR)) rmdirSync(TEST_DIR);
			} catch {}
		});

		it("should return default value when file doesn't exist", () => {
			const store = createJSONStore(testFile, { default: true });
			const data = store.load();
			expect(data).toEqual({ default: true });
		});

		it("should persist and load data", () => {
			const store = createJSONStore(testFile, { count: 0 });
			store.save({ count: 42 });

			// Create new store instance to test loading from disk
			const store2 = createJSONStore(testFile, { count: 0 });
			const data = store2.load();
			expect(data.count).toBe(42);
		});

		it("should cache data after first load", () => {
			const store = createJSONStore(testFile, { value: "initial" });
			store.save({ value: "updated" });

			// First load reads from disk
			const data1 = store.load();
			expect(data1.value).toBe("updated");

			// Second load should return cached value
			const data2 = store.load();
			expect(data2.value).toBe("updated");
		});

		it("should support atomic read-modify-write via update", async () => {
			const store = createJSONStore<{ count: number }>(testFile, {
				count: 0,
			});
			await store.update((data) => ({ ...data, count: data.count + 1 }));
			await store.update((data) => ({ ...data, count: data.count + 1 }));
			expect(store.load().count).toBe(2);

			const store2 = createJSONStore<{ count: number }>(testFile, {
				count: 0,
			});
			expect(store2.load().count).toBe(2);
		});
	});

	describe("createJSONLStore", () => {
		const testFile = join(TEST_DIR, "test-log.jsonl");

		beforeEach(() => {
			try {
				if (existsSync(testFile)) unlinkSync(testFile);
				if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true });
			} catch {}
		});

		afterEach(() => {
			try {
				if (existsSync(testFile)) unlinkSync(testFile);
				if (existsSync(TEST_DIR)) rmdirSync(TEST_DIR);
			} catch {}
		});

		it("should return empty array when file doesn't exist", () => {
			const store = createJSONLStore<{ msg: string }>(testFile);
			const data = store.load();
			expect(data).toEqual([]);
		});

		it("strips __proto__ payloads to prevent prototype pollution", () => {
			// Simulate a poisoned cache file
			const poisoned = JSON.stringify({
				providers: {},
				__proto__: { isAdmin: true },
			});
			writeFileSync(testFile, poisoned, "utf-8");

			const store = createJSONStore<{
				providers: Record<string, unknown>;
			}>(testFile, { providers: {} });
			const data = store.load();
			expect(data).toBeDefined();
			// ({} as any).isAdmin must not be true after parse
			expect(({} as { isAdmin?: boolean }).isAdmin).toBeUndefined();
		});

		it("strips constructor payloads to prevent prototype pollution", () => {
			const poisoned = JSON.stringify({
				providers: {},
				constructor: { prototype: { isAdmin: true } },
			});
			writeFileSync(testFile, poisoned, "utf-8");

			const store = createJSONStore<{
				providers: Record<string, unknown>;
			}>(testFile, { providers: {} });
			store.load();
			expect(({} as { isAdmin?: boolean }).isAdmin).toBeUndefined();
		});

		it("should append entries", async () => {
			const store = createJSONLStore<{ event: string }>(testFile);
			await store.append({ event: "first" });
			await store.append({ event: "second" });

			const data = store.load();
			expect(data).toHaveLength(2);
			expect(data[0].event).toBe("first");
			expect(data[1].event).toBe("second");
		});

		it("should clear entries", () => {
			const store = createJSONLStore<{ event: string }>(testFile);
			store.append({ event: "test" });
			store.clear();

			const data = store.load();
			expect(data).toEqual([]);
		});

		it("should skip malformed JSONL lines and keep valid ones", () => {
			const store = createJSONLStore<{ event: string }>(testFile);
			writeFileSync(
				testFile,
				'{"event":"first"}\nnot json\n{"event":"third"}\n',
				"utf-8",
			);

			const data = store.load();
			expect(data).toHaveLength(2);
			expect(data[0].event).toBe("first");
			expect(data[1].event).toBe("third");
		});
	});
});
