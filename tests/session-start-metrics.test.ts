import { beforeEach, describe, expect, it } from "vitest";

describe("session-start-metrics", () => {
	beforeEach(async () => {
		const { beginStartup } = await import("../lib/startup-timing.ts");
		beginStartup();
	});

	it("records handler return and detached completion without awaiting the task", async () => {
		const { getStartupSummary } = await import("../lib/startup-timing.ts");
		const { wrapSessionStartHandler } = await import(
			"../lib/session-start-metrics.ts"
		);
		let resolveTask!: () => void;
		const task = new Promise<void>((resolve) => {
			resolveTask = resolve;
		});

		const handler = wrapSessionStartHandler(
			"provider-refresh",
			() => task,
			{ detached: true },
		);
		await handler();

		expect(getStartupSummary().sessionStartHandlers).toEqual([
			expect.objectContaining({ label: "provider-refresh", success: true }),
		]);
		expect(getStartupSummary().detachedSessionWork).toHaveLength(0);

		resolveTask();
		await Promise.resolve();
		await Promise.resolve();
		expect(getStartupSummary().detachedSessionWork).toEqual([
			expect.objectContaining({
				label: "provider-refresh-detached",
				success: true,
			}),
		]);
	});
});
