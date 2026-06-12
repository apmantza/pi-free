import { describe, expect, it } from "vitest";
import { PI_DATA_DIR, resolveSafeDataFile } from "../lib/paths.ts";
import { join, sep } from "node:path";

describe("resolveSafeDataFile", () => {
	it("returns the default path when env value is undefined", () => {
		expect(resolveSafeDataFile(undefined, "free.log")).toBe(
			join(PI_DATA_DIR, "free.log"),
		);
	});

	it("returns the default path when env value is empty", () => {
		expect(resolveSafeDataFile("", "free.log")).toBe(
			join(PI_DATA_DIR, "free.log"),
		);
	});

	it("accepts a bare filename inside ~/.pi/", () => {
		const result = resolveSafeDataFile("test.log", "free.log");
		expect(result).toBe(join(PI_DATA_DIR, "test.log"));
		expect(result.startsWith(PI_DATA_DIR + sep)).toBe(true);
	});

	it("rejects paths containing forward slashes", () => {
		expect(resolveSafeDataFile("../../etc/passwd", "free.log")).toBe(
			join(PI_DATA_DIR, "free.log"),
		);
		expect(resolveSafeDataFile("subdir/file.log", "free.log")).toBe(
			join(PI_DATA_DIR, "free.log"),
		);
	});

	it("rejects paths containing backslashes", () => {
		expect(resolveSafeDataFile("..\\windows\\system32\\evil.exe", "free.log")).toBe(
			join(PI_DATA_DIR, "free.log"),
		);
	});

	it("rejects paths containing null bytes", () => {
		expect(resolveSafeDataFile("file\u0000.log", "free.log")).toBe(
			join(PI_DATA_DIR, "free.log"),
		);
	});

	it("rejects empty-after-trim values", () => {
		expect(resolveSafeDataFile("   ", "free.log")).toBe(
			join(PI_DATA_DIR, "free.log"),
		);
	});

	it("rejects dot-only filenames", () => {
		expect(resolveSafeDataFile(".", "free.log")).toBe(
			join(PI_DATA_DIR, "free.log"),
		);
		expect(resolveSafeDataFile("..", "free.log")).toBe(
			join(PI_DATA_DIR, "free.log"),
		);
	});

	it("rejects overly long filenames (>128 chars)", () => {
		const long = "a".repeat(200) + ".log";
		expect(resolveSafeDataFile(long, "free.log")).toBe(
			join(PI_DATA_DIR, "free.log"),
		);
	});

	it("result is always inside PI_DATA_DIR", () => {
		const inputs = [
			"normal.log",
			"with spaces.log",
			"with-dashes.log",
			"with_underscores.log",
			"file.tar.gz",
		];
		for (const input of inputs) {
			const result = resolveSafeDataFile(input, "default.log");
			expect(result.startsWith(PI_DATA_DIR + sep)).toBe(true);
		}
	});
});
