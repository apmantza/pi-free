import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("action ring", () => {
	it("returns newest-first and caps at 20", async () => {
		vi.resetModules();
		const { recordAction, getRecentActions, clearActions } =
			await import("../lib/action-log.ts");
		clearActions();
		for (let i = 0; i < 25; i++) recordAction("toggle", `action-${i}`);
		const recent = getRecentActions();
		expect(recent).toHaveLength(20);
		expect(recent[0].summary).toBe("action-24");
		expect(recent[19].summary).toBe("action-5");
	});

	it("truncates long summaries for health rendering", async () => {
		vi.resetModules();
		const { recordAction, getRecentActions, clearActions } =
			await import("../lib/action-log.ts");
		clearActions();
		recordAction("restore", "x".repeat(300));
		expect(getRecentActions()[0].summary).toHaveLength(160);
	});

	it("attaches the ambient run id, null outside a run", async () => {
		vi.resetModules();
		const { recordAction, getRecentActions, clearActions } =
			await import("../lib/action-log.ts");
		const { withRunId, getActiveRunId } = await import("../lib/logger.ts");
		clearActions();
		expect(getActiveRunId()).toBeNull();
		recordAction("toggle", "outside");
		withRunId(() => {
			recordAction("toggle", "inside");
			expect(getActiveRunId()).toMatch(/^[0-9a-f]{8}$/);
		}, "deadbeef");
		expect(getActiveRunId()).toBeNull();
		const recent = getRecentActions();
		expect(recent[0].summary).toBe("inside");
		expect(recent[0].run).toBe("deadbeef");
		expect(recent[1].summary).toBe("outside");
		expect(recent[1].run).toBeNull();
	});

	it("tags file-log lines with the ambient run id", async () => {
		const home = await mkdtemp(join(tmpdir(), "pi-free-runid-test-"));
		vi.stubEnv("HOME", home);
		vi.stubEnv("USERPROFILE", home);
		vi.stubEnv("PI_FREE_LOG_PATH", "runid.log");
		vi.stubEnv("PI_FREE_LOG_LEVEL", "debug");
		vi.stubEnv("PI_FREE_FILE_LOG", "true");
		vi.resetModules();
		const { createLogger, withRunId, getLogPath } =
			await import("../lib/logger.ts");
		const { readFile } = await import("node:fs/promises");
		const log = createLogger("runid-test");
		log.info("outside run");
		withRunId(() => {
			log.info("inside run");
		}, "cafef00d");
		const { flushLogsSync } = await import("../lib/logger.ts");
		flushLogsSync();
		const content = await readFile(getLogPath(), "utf8");
		expect(content).toContain("outside run");
		expect(content).not.toMatch(/outside run.*"run"/);
		expect(content).toMatch(/inside run.*"run":"cafef00d"/);
	});
});
