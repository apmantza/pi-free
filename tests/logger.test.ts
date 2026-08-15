import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const MAX_BYTES = 512;

async function waitForLogFlush(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 250));
}

/**
 * Remove a sandbox home dir, retrying briefly: async log rotation can still
 * be writing files a moment after the flush window, and on Windows an rm
 * racing with that fails with ENOTEMPTY/EBUSY. Cleanup-only hardening.
 */
async function removeHomeRetry(dir: string): Promise<void> {
	for (let attempt = 0; attempt < 5; attempt++) {
		try {
			await rm(dir, { recursive: true, force: true, maxRetries: 2 });
			return;
		} catch {
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	}
	await rm(dir, { recursive: true, force: true });
}

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("logger file rotation", () => {
	it("rotates asynchronously without exceeding the configured size", async () => {
		const home = await mkdtemp(join(tmpdir(), "pi-free-logger-test-"));
		try {
			vi.stubEnv("HOME", home);
			vi.stubEnv("USERPROFILE", home);
			vi.stubEnv("PI_FREE_LOG_PATH", "rotation.log");
			vi.stubEnv("PI_FREE_LOG_MAX_BYTES", String(MAX_BYTES));
			vi.stubEnv("PI_FREE_LOG_LEVEL", "debug");
			vi.stubEnv("PI_FREE_FILE_LOG", "true");
			vi.resetModules();

			const { createLogger } = await import("../lib/logger.ts");
			const logger = createLogger("rotation-test");
			for (let index = 0; index < 100; index++) {
				logger.info("line", { index, payload: "x".repeat(40) });
			}
			await waitForLogFlush();

			const logDir = join(home, ".pi");
			// Async rotation may still be renaming files right after the flush;
			// wait for the directory listing to stabilize so the size/content
			// assertions never race a mid-check rename (ENOENT flake). The
			// stability loop narrows the window but does not close it — a
			// rotation chain can still run between the last listing and a stat —
			// so the per-file assertions tolerate a file that rotated away
			// mid-check (it was size-bounded when written).
			let files: string[] = [];
			for (let attempt = 0; attempt < 40; attempt += 1) {
				const current = (await readdir(logDir))
					.filter((file) => file.startsWith("rotation.log"))
					.sort();
				if (current.length > 0 && current.join(",") === files.join(",")) {
					files = current;
					break;
				}
				files = current;
				await new Promise((resolve) => setTimeout(resolve, 25));
			}
			expect(files.length).toBeGreaterThan(1);
			expect(files.length).toBeLessThanOrEqual(4);
			for (const file of files) {
				const size = await stat(join(logDir, file))
					.then((s) => s.size)
					.catch((err: NodeJS.ErrnoException) => {
						if (err.code === "ENOENT") return undefined; // rotated away mid-check
						throw err;
					});
				if (size !== undefined) {
					expect(size).toBeLessThanOrEqual(MAX_BYTES);
				}
			}
			expect(await readFile(join(logDir, files[0]), "utf8")).toContain(
				"rotation-test",
			);
		} finally {
			await removeHomeRetry(home);
		}
	});
});

describe("flushLogsSync", () => {
	it("writes buffered log lines to disk synchronously", async () => {
		const home = await mkdtemp(join(tmpdir(), "pi-free-logger-flush-test-"));
		try {
			vi.stubEnv("HOME", home);
			vi.stubEnv("USERPROFILE", home);
			vi.stubEnv("PI_FREE_LOG_PATH", "flush.log");
			vi.stubEnv("PI_FREE_LOG_LEVEL", "debug");
			vi.stubEnv("PI_FREE_FILE_LOG", "true");
			vi.resetModules();

			const { createLogger, flushLogsSync, getLogPath } = await import(
				"../lib/logger.ts"
			);
			const logger = createLogger("flush-test");
			logger.info("sync-flush-marker", { index: 1 });
			logger.info("sync-flush-marker", { index: 2 });

			// No async wait: flush must put every line on disk right now,
			// surviving a hard process.exit immediately afterwards.
			flushLogsSync();

			const content = await readFile(getLogPath(), "utf8");
			const matches = content.match(/sync-flush-marker/g) ?? [];
			expect(matches).toHaveLength(2);
			expect(content.indexOf('"index":1')).toBeLessThan(
				content.indexOf('"index":2'),
			);

			// Subsequent logging uses the synchronous path and still lands.
			logger.info("sync-flush-after");
			expect(await readFile(getLogPath(), "utf8")).toContain("sync-flush-after");
		} finally {
			await removeHomeRetry(home);
		}
	});
});
