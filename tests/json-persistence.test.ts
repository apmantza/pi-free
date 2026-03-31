/**
 * JSON Persistence Tests
 */

import { existsSync, rmdirSync, unlinkSync } from "node:fs";
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
	});

	describe("createJSONLStore", () => {
		const testFile = join(TEST_DIR, "test-log.jsonl");

		beforeEach(() => {
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

		it("should return empty array when file doesn't exist", () => {
			const store = createJSONLStore<{ msg: string }>(testFile);
			const data = store.load();
			expect(data).toEqual([]);
		});

		it("should append entries", () => {
			const store = createJSONLStore<{ event: string }>(testFile);
			store.append({ event: "first" });
			store.append({ event: "second" });

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
	});
});
