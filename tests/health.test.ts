import { beforeEach, describe, expect, it, vi } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A literal "C:/tmp/..." HOME is a Windows path that POSIX hosts resolve
// relative to the cwd, so every test run left a stray, untracked `C:/` tree in
// the repository root. The real temp dir works on both.
const tempHome = join(tmpdir(), "pi-free-health-test");

beforeEach(async () => {
	process.env.HOME = tempHome;
	process.env.USERPROFILE = tempHome;
	const { beginStartup } = await import("../lib/startup-timing.ts");
	beginStartup();
});

describe("health report", () => {
	it("shows status, startup details, and the diagnostic log path", async () => {
		const { formatHealthReport } = await import("../lib/health.ts");
		const report = formatHealthReport();

		expect(report).toContain("Pi-Free health:");
		expect(report).toContain("Registered providers:");
		expect(report).toContain("Log file:");
		expect(report).toContain("Pi-Free Startup:");
	});

	it("flags empty stored catalogs after a completed refresh (Mn1)", async () => {
		const { registerWithGlobalToggle } = await import("../lib/registry.ts");
		const startup = await import("../lib/startup-timing.ts");
		const { formatHealthReport } = await import("../lib/health.ts");

		// Refresh completed but published 0 models.
		startup.recordNativeRefreshOk("empty-prov", 0);
		registerWithGlobalToggle(
			"empty-prov",
			{ all: [], free: [] },
			vi.fn(),
			false,
			{ native: true },
		);

		expect(formatHealthReport()).toContain(
			"empty-prov: empty after completed refresh (0 models)",
		);
	});

	it("does not flag providers with no refresh evidence (Mn1 false-alarm fix)", async () => {
		const { registerWithGlobalToggle } = await import("../lib/registry.ts");
		const { formatHealthReport } = await import("../lib/health.ts");

		// Registered but no cacheNetwork evidence at all — auth-required
		// providers Pi never refreshes (StepFun, TokenRouter, AnyAPI, B.AI,
		// OpenGateway, unconfigured Qoder) land here; flagging them would flip
		// previously-OK installs to WARN (reviewer Major finding).
		registerWithGlobalToggle(
			"never-prov",
			{ all: [], free: [] },
			vi.fn(),
			false,
			{ native: true },
		);

		const report = formatHealthReport();
		expect(report).not.toContain("never-prov");
	});

	it("flags providers whose refresh was attempted but never completed (Mn1)", async () => {
		const { registerWithGlobalToggle } = await import("../lib/registry.ts");
		const startup = await import("../lib/startup-timing.ts");
		const { formatHealthReport } = await import("../lib/health.ts");

		// Refresh evidence exists (an abort) but no successful refresh: this
		// is the meaningful "refresh never completed" signal.
		startup.recordNativeAbort("attempted-prov");
		registerWithGlobalToggle(
			"attempted-prov",
			{ all: [], free: [] },
			vi.fn(),
			false,
			{ native: true },
		);

		expect(formatHealthReport()).toContain(
			"attempted-prov: no models; refresh never completed",
		);
	});

	it("lists abort/empty-retain flags and stale store ages (M1)", async () => {
		const startup = await import("../lib/startup-timing.ts");
		const { formatHealthReport } = await import("../lib/health.ts");

		startup.recordNativeAbort("ab-prov");
		startup.recordNativeEmptyRetain("er-prov");
		startup.recordNativeRestored("old-prov", 8 * 24 * 60 * 60 * 1000); // 8 days > 7d flag

		const report = formatHealthReport();
		expect(report).toContain("ab-prov: 1 abort");
		expect(report).toContain("er-prov: 1 empty-retain");
		expect(report).toContain("old-prov: store 8d old");
	});

	it("aggregates auth-failure / rate-limit / 5xx response counters (M2, Mn3)", async () => {
		const quota = await import("../lib/quota-monitor.ts");
		const { formatHealthReport } = await import("../lib/health.ts");

		quota.processQuotaResponse("auth-prov", 401, {});
		quota.processQuotaResponse("auth-prov", 403, {});
		quota.processQuotaResponse("busy-prov", 429, {});
		quota.processQuotaResponse("down-prov", 503, {});
		quota.processQuotaResponse("drift-prov", 200, {
			"ratelimit-remaining-custom": "5",
			"ratelimit-limit-custom": "100",
		});

		const report = formatHealthReport();
		expect(report).toContain("auth-prov: 2 auth-fail (401/403)");
		expect(report).toContain("busy-prov: 1 rate-limited (429)");
		expect(report).toContain("down-prov: 1 server-error (5xx)");
		expect(report).toContain("drift-prov: 1 quota-header-drift");
	});

	// Issue #456: a write the log stream lost to teardown (rotation end,
	// shutdown destroy) must be readable from this surface, not just printed
	// once to stderr. logger.test.ts covers how the counter gets incremented;
	// this covers that health.ts actually reads and reports it.
	//
	// MUTATION: dropping the `logWriteFailures > 0 ? 1 : 0` term from
	// problemCount, or the `if (logWriteFailures > 0)` block that renders the
	// line, reds this test — the counter would be tracked but invisible here.
	it("surfaces log write failures and flips status to WARN (#456)", async () => {
		vi.resetModules();
		vi.doMock("../lib/logger.ts", async (importOriginal) => {
			const actual =
				await importOriginal<typeof import("../lib/logger.ts")>();
			return {
				...actual,
				getLogWriteFailures: () => 2,
				getLastLogWriteError: () => "ENOSPC: no space left on device",
			};
		});

		const { formatHealthReport } = await import("../lib/health.ts");
		const report = formatHealthReport();

		expect(report).toContain("Pi-Free health: WARN");
		expect(report).toContain(
			"Log write failures: 2 (sink:",
		);
		expect(report).toContain("last: ENOSPC: no space left on device");

		vi.doUnmock("../lib/logger.ts");
		vi.resetModules();
	});
});
