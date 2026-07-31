import { beforeEach, describe, expect, it } from "vitest";

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
});
