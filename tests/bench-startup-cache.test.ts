import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { freshenProviderCache } from "../scripts/bench-startup-cache.ts";

const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

function cachePaths(): { src: string; dest: string } {
	const dir = mkdtempSync(join(tmpdir(), "pi-free-bench-cache-test-"));
	tempDirs.push(dir);
	return { src: join(dir, "source.json"), dest: join(dir, "fresh.json") };
}

describe("freshenProviderCache", () => {
	it("reports malformed JSON with the source path", () => {
		const { src, dest } = cachePaths();
		writeFileSync(src, "{not-json");

		expect(() => freshenProviderCache(src, dest)).toThrow(
			`Failed to parse provider cache ${src}`,
		);
	});

	it("rejects a cache without a providers object", () => {
		const { src, dest } = cachePaths();
		writeFileSync(src, JSON.stringify({ providers: [] }));

		expect(() => freshenProviderCache(src, dest)).toThrow(
			`Invalid provider cache ${src}: expected an object with a providers object`,
		);
	});

	it("refreshes each provider timestamp while copying the cache", () => {
		const { src, dest } = cachePaths();
		writeFileSync(
			src,
			JSON.stringify({
				providers: {
					alpha: { fetchedAt: "old", models: [] },
					beta: { fetchedAt: "old", models: [] },
				},
			}),
		);

		expect(freshenProviderCache(src, dest)).toBe(2);
		const fresh = JSON.parse(readFileSync(dest, "utf-8")) as {
			providers: Record<string, { fetchedAt: string }>;
		};
		for (const provider of Object.values(fresh.providers)) {
			expect(provider.fetchedAt).not.toBe("old");
			expect(Number.isNaN(Date.parse(provider.fetchedAt))).toBe(false);
		}
	});
});
