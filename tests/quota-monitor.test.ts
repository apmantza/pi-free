import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
		const { processQuotaResponse, getResponseCounters } =
			await import("../lib/quota-monitor.ts");

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
		const { processQuotaResponse, getResponseCounters } =
			await import("../lib/quota-monitor.ts");

		processQuotaResponse("cline", 401, {});
		processQuotaResponse("cline", 403, {});
		processQuotaResponse("cline", 401, {});

		expect(getResponseCounters("cline")).toMatchObject({
			authFailures: 3,
			rateLimited: 0,
			serverErrors: 0,
		});
	});

	it("counts quota-header drift only when both halves are present but unmatched (Mn3)", async () => {
		const { processQuotaResponse, getResponseCounters } =
			await import("../lib/quota-monitor.ts");

		// Half-pairs (remaining-only or limit-only) are legitimate signals from
		// providers that send one half — NOT format drift (reviewer fix).
		processQuotaResponse("drift", 200, {
			"x-ratelimit-remaining": "5",
		});
		processQuotaResponse("drift", 200, {
			"x-ratelimit-limit": "100",
		});
		expect(getResponseCounters("drift")?.quotaHeaderDrift).toBe(0);

		// Both halves present but in a format no known pair matches → drift.
		processQuotaResponse("drift", 200, {
			"ratelimit-remaining-custom": "5",
			"ratelimit-limit-custom": "100",
		});
		expect(getResponseCounters("drift")?.quotaHeaderDrift).toBe(1);
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

	// AMD Token Lab (#671) reports a monthly dollar budget and a per-minute
	// request cap under its own header names; unmatched, the status bar stayed
	// empty and every response counted as header drift. Headers verbatim from a
	// live response (2026-11-14), budget partly spent.
	it("reads AMD Token Lab's dollar budget and shows it in dollars", async () => {
		const { processQuotaResponse, getResponseCounters, formatQuotaStatus } =
			await import("../lib/quota-monitor.ts");

		processQuotaResponse("amd-tokenlab", 200, {
			"x-ratelimit-limit-user-budget-usd": "10.000000",
			"x-ratelimit-limit-user-rpm": "20",
			"x-ratelimit-remaining-user-budget-usd": "2.500000",
			"x-ratelimit-remaining-user-rpm": "19",
			"x-ratelimit-reset-user-budget-usd": "1797186152",
			"x-ratelimit-used-user-budget-usd": "7.500000",
		});

		expect(formatQuotaStatus("amd-tokenlab")).toBe(
			"⚡ amd-tokenlab: $2.50/$10.00 (25%)",
		);
		expect(getResponseCounters("amd-tokenlab")?.quotaHeaderDrift).toBe(0);
	});

	it("falls back to AMD Token Lab's per-minute request cap without a budget", async () => {
		const { processQuotaResponse, formatQuotaStatus } =
			await import("../lib/quota-monitor.ts");

		processQuotaResponse("amd-tokenlab-rpm", 200, {
			"x-ratelimit-limit-user-rpm": "20",
			"x-ratelimit-remaining-user-rpm": "19",
		});

		expect(formatQuotaStatus("amd-tokenlab-rpm")).toBe(
			"amd-tokenlab-rpm: 19/20 (95%)",
		);
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

	// #690: Venice reports the account balance (USD and DIEM) on inference
	// responses beside its per-minute request window, and the balance is what
	// gates every request (402 at zero). Unread, the status bar showed only
	// the refilling request window. Header names from docs.venice.ai (Response
	// Headers Reference; values are strings); amounts are illustrative, as no
	// keyed response was captured.
	it("shows Venice's balance in place of its request window", async () => {
		const { processQuotaResponse, formatQuotaStatus, getResponseCounters } =
			await import("../lib/quota-monitor.ts");

		processQuotaResponse("venice", 200, {
			"x-ratelimit-limit-requests": "500",
			"x-ratelimit-remaining-requests": "499",
			"X-Venice-Balance-USD": "4.2061",
			"X-Venice-Balance-DIEM": "12.5",
		});

		expect(formatQuotaStatus("venice")).toBe(
			"venice: $4.21 + 12.50 DIEM balance",
		);
		expect(getResponseCounters("venice")?.quotaHeaderDrift).toBe(0);
	});

	// A balance has no limit, so no percentage or warning icon is invented.
	it("shows a lone USD balance without a percentage", async () => {
		const { processQuotaResponse, formatQuotaStatus } =
			await import("../lib/quota-monitor.ts");

		processQuotaResponse("venice-usd", 200, { "x-venice-balance-usd": "0.03" });

		expect(formatQuotaStatus("venice-usd")).toBe("venice-usd: $0.03 balance");
	});

	// A balance is a snapshot from the last response: like a request window
	// it is not shown once older than five minutes.
	it("stops showing a balance older than five minutes", async () => {
		const { processQuotaResponse, formatQuotaStatus } =
			await import("../lib/quota-monitor.ts");
		vi.useFakeTimers({ toFake: ["Date"] });
		try {
			processQuotaResponse("venice-old", 200, {
				"x-venice-balance-usd": "7",
			});
			vi.setSystemTime(Date.now() + 5 * 60 * 1000 + 1);
			expect(formatQuotaStatus("venice-old")).toBeUndefined();
		} finally {
			vi.useRealTimers();
		}
	});
});
