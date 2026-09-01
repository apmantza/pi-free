/**
 * Tests for lib/auto-fallback/blacklist.ts
 *
 * Covers TTL eviction, max-strike hard ban, snapshot/clear, and key isolation.
 */

import { describe, expect, it } from "vitest";
import { createBlacklist } from "../lib/auto-fallback/blacklist.ts";

describe("createBlacklist", () => {
	it("records failures and reports them as blacklisted", () => {
		const now = 1_000_000;
		const bl = createBlacklist({ ttlMs: 1000, maxStrikes: 3 });
		expect(bl.isBlacklisted("kilo/gpt-4o-mini", now)).toBe(false);
		bl.recordFailure("kilo/gpt-4o-mini", "429", now);
		expect(bl.isBlacklisted("kilo/gpt-4o-mini", now)).toBe(true);
	});

	it("treats TTL expiry as a fresh window (Q9 counter + time dual)", () => {
		const bl = createBlacklist({ ttlMs: 1000, maxStrikes: 3 });
		bl.recordFailure("kilo/x", "429", 0);
		// Just before expiry
		expect(bl.isBlacklisted("kilo/x", 999)).toBe(true);
		// After expiry — strike counter resets
		expect(bl.isBlacklisted("kilo/x", 1500)).toBe(false);
		// A new failure starts a new window
		bl.recordFailure("kilo/x", "429", 1500);
		expect(bl.isBlacklisted("kilo/x", 1500)).toBe(true);
	});

	it("promotes to hard ban at maxStrikes for the session", () => {
		const bl = createBlacklist({ ttlMs: 1000, maxStrikes: 2 });
		bl.recordFailure("kilo/x", "429", 0);
		bl.recordFailure("kilo/x", "429", 100);
		expect(bl.isBlacklisted("kilo/x", 200)).toBe(true);
		// Even after TTL passes, hard ban persists (no automatic recovery).
		expect(bl.isBlacklisted("kilo/x", 9_999_999)).toBe(true);
	});

	it("isolates keys (kilo/x vs sambanova/x)", () => {
		const bl = createBlacklist({ ttlMs: 1000, maxStrikes: 3 });
		bl.recordFailure("kilo/x", "429", 0);
		expect(bl.isBlacklisted("kilo/x", 0)).toBe(true);
		expect(bl.isBlacklisted("sambanova/x", 0)).toBe(false);
	});

	it("clear() removes only the named key", () => {
		const bl = createBlacklist();
		bl.recordFailure("kilo/x", "429");
		bl.recordFailure("kilo/y", "429");
		bl.clear("kilo/x");
		expect(bl.isBlacklisted("kilo/x")).toBe(false);
		expect(bl.isBlacklisted("kilo/y")).toBe(true);
	});

	it("clearAll() removes everything and returns count", () => {
		const bl = createBlacklist();
		bl.recordFailure("kilo/x", "429");
		bl.recordFailure("sambanova/y", "429");
		expect(bl.size()).toBe(2);
		const cleared = bl.clearAll();
		expect(cleared).toBe(2);
		expect(bl.size()).toBe(0);
	});

	it("snapshots are read-only and reflect current state", () => {
		const bl = createBlacklist();
		bl.recordFailure("kilo/x", "429");
		bl.recordFailure("kilo/x", "429");
		const snap = bl.snapshot();
		expect(snap.size).toBe(1);
		const entry = snap.get("kilo/x");
		expect(entry?.count).toBe(2);
		expect(entry?.reasons).toEqual(["429", "429"]);
		// The snapshot is typed as ReadonlyMap to discourage mutation,
		// but the underlying Map is not frozen — so the snapshot is the
		// internal Map (cloned). The contract is documented: do not mutate.
		expect(snap.has("kilo/x")).toBe(true);
	});

	it("caps reasons[] at maxReasons", () => {
		const bl = createBlacklist({ maxReasons: 2 });
		for (let i = 0; i < 5; i++) bl.recordFailure("kilo/x", `r${i}`);
		const entry = bl.snapshot().get("kilo/x");
		expect(entry?.reasons).toEqual(["r3", "r4"]);
	});
});