import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const MAX_BYTES = 512;

// ── Fakes for the stream-teardown-loses-writes tests (issue #456) ──────────
//
// A real fs.WriteStream can't be forced to error a specific in-flight write
// deterministically without racing the OS, so these tests replace
// node:fs's createWriteStream with a controllable fake for one call. Every
// other node:fs export (including appendFileSync, used by the recovery path
// under test) stays real, so the recovery write actually lands on disk.

interface FakeWriteStream {
	on(event: string, handler: (err: Error) => void): FakeWriteStream;
	write(chunk: string, callback: (err?: Error | null) => void): boolean;
	end(callback?: () => void): void;
	destroy(): void;
}

/**
 * A write stream whose write() calls stay pending (callback withheld) until
 * destroy() fires them all with ERR_STREAM_DESTROYED — mirroring the real
 * Writable behavior when rotation's oldStream.end() or shutdown's
 * stream.destroy() tears down a stream with writes still in flight.
 */
function createFakeDestroyableStream(): FakeWriteStream {
	const errorHandlers: ((err: Error) => void)[] = [];
	const pendingCallbacks: ((err?: Error | null) => void)[] = [];
	let destroyed = false;
	const stream: FakeWriteStream = {
		on(event, handler) {
			if (event === "error") errorHandlers.push(handler);
			return stream;
		},
		write(_chunk, callback) {
			if (destroyed) {
				queueMicrotask(() =>
					callback(
						new Error(
							"ERR_STREAM_DESTROYED: Cannot call write after a stream was destroyed",
						),
					),
				);
				return false;
			}
			pendingCallbacks.push(callback);
			return true;
		},
		end(callback) {
			destroyed = true;
			if (callback) queueMicrotask(callback);
		},
		destroy() {
			if (destroyed) return;
			destroyed = true;
			const err = new Error(
				"ERR_STREAM_DESTROYED: Cannot call write after a stream was destroyed",
			);
			for (const callback of pendingCallbacks.splice(0)) callback(err);
			for (const handler of errorHandlers) handler(err);
		},
	};
	return stream;
}

let nextFakeStream: (() => FakeWriteStream) | null = null;
let failNextRecoveryAppend = false;

vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	return {
		...actual,
		createWriteStream: (
			...args: Parameters<typeof actual.createWriteStream>
		) => {
			if (nextFakeStream) {
				const factory = nextFakeStream;
				nextFakeStream = null;
				return factory() as unknown as ReturnType<
					typeof actual.createWriteStream
				>;
			}
			return actual.createWriteStream(...args);
		},
		appendFileSync: (
			...args: Parameters<typeof actual.appendFileSync>
		) => {
			if (failNextRecoveryAppend) {
				failNextRecoveryAppend = false;
				throw new Error("ENOSPC: no space left on device, write");
			}
			return actual.appendFileSync(...args);
		},
	};
});

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

describe("log writer recovers writes lost to stream teardown (#456)", () => {
	it("recovers a write whose stream is destroyed while the write is in flight", async () => {
		const home = await mkdtemp(join(tmpdir(), "pi-free-logger-destroy-test-"));
		try {
			vi.stubEnv("HOME", home);
			vi.stubEnv("USERPROFILE", home);
			vi.stubEnv("PI_FREE_LOG_PATH", "destroy.log");
			vi.stubEnv("PI_FREE_LOG_LEVEL", "debug");
			vi.stubEnv("PI_FREE_FILE_LOG", "true");
			vi.resetModules();

			const fakeStream = createFakeDestroyableStream();
			nextFakeStream = () => fakeStream;

			const { createLogger, getLogPath, getLogWriteFailures, getLastLogWriteError } =
				await import("../lib/logger.ts");
			const logger = createLogger("destroy-test");
			logger.info("in-flight-marker");

			// Let the async open-stream chain run so the write actually reaches
			// the fake stream; its callback is withheld (not yet "destroyed").
			await new Promise((resolve) => setTimeout(resolve, 100));

			// Tear the stream down with that write still in flight — exactly
			// what rotation's oldStream.end() and shutdown's stream.destroy()
			// do to the real stream in production.
			fakeStream.destroy();
			await new Promise((resolve) => setTimeout(resolve, 100));

			const content = await readFile(getLogPath(), "utf8").catch(() => "");
			expect(content).toContain("in-flight-marker");
			expect(getLogWriteFailures()).toBe(0);
			expect(getLastLogWriteError()).toBeNull();
		} finally {
			await removeHomeRetry(home);
		}
	});

	it("counts a write that is lost even after the recovery retry", async () => {
		const home = await mkdtemp(join(tmpdir(), "pi-free-logger-loss-test-"));
		try {
			vi.stubEnv("HOME", home);
			vi.stubEnv("USERPROFILE", home);
			vi.stubEnv("PI_FREE_LOG_PATH", "loss.log");
			vi.stubEnv("PI_FREE_LOG_LEVEL", "debug");
			vi.stubEnv("PI_FREE_FILE_LOG", "true");
			vi.resetModules();

			const fakeStream = createFakeDestroyableStream();
			nextFakeStream = () => fakeStream;

			const { createLogger, getLogWriteFailures, getLastLogWriteError } = await import(
				"../lib/logger.ts"
			);
			const logger = createLogger("loss-test");
			logger.info("unrecoverable-marker");

			await new Promise((resolve) => setTimeout(resolve, 100));

			// The recovery retry itself fails this time (e.g. disk full) — the
			// line is a genuine, bounded, counted loss, not a silent one.
			failNextRecoveryAppend = true;
			fakeStream.destroy();
			await new Promise((resolve) => setTimeout(resolve, 100));

			expect(getLogWriteFailures()).toBe(1);
			expect(getLastLogWriteError()).toMatch(/ENOSPC/);
		} finally {
			await removeHomeRetry(home);
		}
	});
});
