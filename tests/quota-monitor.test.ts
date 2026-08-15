import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDir = mkdtempSync(join(tmpdir(), "pi-free-quota-monitor-test-"));

describe("quota-monitor response outcome counters (M2 + Mn3, #437)", () => {
	beforeEach(() => {
		// Isolate the file logger inside a temp home.
		process.env.HOME = tempDir;
		process.env.USERPROFILE = tempDir;
	});

	afterEach(() => {
		delete process.env.HOME;
		delete process.env.USERPROFILE;
	});

	it("counts 429 and 5xx responses per provider", async () => {
		const { processQuotaResponse, getResponseCounters } = await import(
			"../lib/quota-monitor.ts"
		);

		processQuotaResponse("gateway", 429, {});
		processQuotaResponse("gateway", 502, {});
		processQuotaResponse("gateway", 503, {});
		processQuotaResponse("other", 500, {});

		expect(getResponseCounters("gateway")).toMatchObject({
			rateLimited: 1,
			serverErrors: 2,
			authFailures: 0,
			quotaHeaderDrift: 0,
		});
		expect(getResponseCounters("other")?.serverErrors).toBe(1);
		// Untracked provider reports null.
		expect(getResponseCounters("never-seen")).toBeNull();
	});

	it("counts auth failures (401/403) per provider", async () => {
		const { processQuotaResponse, getResponseCounters } = await import(
			"../lib/quota-monitor.ts"
		);

		processQuotaResponse("cline", 401, {});
		processQuotaResponse("cline", 403, {});
		processQuotaResponse("cline", 401, {});

		expect(getResponseCounters("cline")).toMatchObject({
			authFailures: 3,
			rateLimited: 0,
			serverErrors: 0,
		});
	});

	it("counts quota-header drift when quota headers are present but unmatched (Mn3)", async () => {
		const { processQuotaResponse, getResponseCounters } = await import(
			"../lib/quota-monitor.ts"
		);

		// A remaining-only pair is present but does not match any known pair.
		processQuotaResponse("drift", 200, {
			"x-ratelimit-remaining": "5",
		});
		processQuotaResponse("drift", 200, {
			"x-ratelimit-limit": "100",
		});

		expect(getResponseCounters("drift")?.quotaHeaderDrift).toBe(2);
	});

	it("extracts quota on a matched pair and does not count drift", async () => {
		const { processQuotaResponse, getResponseCounters, getQuota } =
			await import("../lib/quota-monitor.ts");

		processQuotaResponse("ok", 200, {
			"x-ratelimit-remaining": "5",
			"x-ratelimit-limit": "100",
		});

		expect(getQuota("ok")?.percent).toBe(5);
		expect(getResponseCounters("ok")?.quotaHeaderDrift).toBe(0);
	});

	it("status classification is independent of the quota-header logic (M2)", async () => {
		const { processQuotaResponse, getResponseCounters, getQuota } =
			await import("../lib/quota-monitor.ts");

		// A 429 with a valid quota pair still counts the rate limit AND stores quota.
		processQuotaResponse("both", 429, {
			"ratelimit-remaining": "3",
			"ratelimit-limit": "10",
		});

		expect(getResponseCounters("both")?.rateLimited).toBe(1);
		expect(getQuota("both")?.percent).toBe(30);
	});
});
