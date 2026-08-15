import { beforeEach, describe, expect, it, vi } from "vitest";

const tempHome = "C:/tmp/pi-free-health-test";

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
});
