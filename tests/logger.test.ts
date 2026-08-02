import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const MAX_BYTES = 512;

async function waitForLogFlush(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 250));
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
			const files = (await readdir(logDir))
				.filter((file) => file.startsWith("rotation.log"))
				.sort();
			expect(files.length).toBeGreaterThan(1);
			expect(files.length).toBeLessThanOrEqual(4);
			for (const file of files) {
				expect((await stat(join(logDir, file))).size).toBeLessThanOrEqual(
					MAX_BYTES,
				);
			}
			expect(await readFile(join(logDir, files[0]), "utf8")).toContain(
			"rotation-test",
		);
		} finally {
			await rm(home, { recursive: true, force: true });
		}
	});
});
