/**
 * Unit tests for lib/stale-ctx.ts — Pi's session-replacement guard helpers.
 */
import { describe, expect, it, vi } from "vitest";
import {
	isStaleContextError,
	safeNotify,
	safeSetStatus,
} from "../lib/stale-ctx.ts";

const STALE_MESSAGE =
	"This extension ctx is stale after session replacement or reload. Do not use a captured pi or command ctx after ctx.newSession(), ctx.fork(), ctx.switchSession(), or ctx.reload().";

describe("isStaleContextError", () => {
	it("matches Pi's exact guard message", () => {
		expect(isStaleContextError(new Error(STALE_MESSAGE))).toBe(true);
	});

	it("matches a message containing the distinctive fragment", () => {
		expect(
			isStaleContextError(
				new Error(`Extension error (...): ${STALE_MESSAGE} (extra)`),
			),
		).toBe(true);
	});

	it("follows the cause chain", () => {
		expect(
			isStaleContextError(
				new Error("wrapper", { cause: new Error(STALE_MESSAGE) }),
			),
		).toBe(true);
	});

	it("rejects unrelated errors", () => {
		expect(isStaleContextError(new Error("No API key for kilo/x"))).toBe(false);
		expect(isStaleContextError(new Error("stale cache entry"))).toBe(false);
	});

	it("rejects non-Error values", () => {
		expect(isStaleContextError(undefined)).toBe(false);
		expect(isStaleContextError(null)).toBe(false);
		expect(isStaleContextError("stale after session replacement")).toBe(false);
		expect(isStaleContextError({ message: STALE_MESSAGE })).toBe(false);
	});
});

describe("safeNotify", () => {
	it("passes through to ctx.ui.notify", () => {
		const notify = vi.fn();
		safeNotify({ ui: { notify, setStatus: vi.fn() } }, "hi", "info");
		expect(notify).toHaveBeenCalledWith("hi", "info");
	});

	it("swallows a stale-context throw (lazy ctx getter, like Pi's)", () => {
		const notify = vi.fn();
		const staleCtx = {
			get ui(): { notify: typeof notify; setStatus: () => void } {
				throw new Error(STALE_MESSAGE);
			},
		};
		expect(() => safeNotify(staleCtx, "hi", "warning")).not.toThrow();
		expect(notify).not.toHaveBeenCalled();
	});

	it("rethrows non-stale errors", () => {
		const boom = new Error("ui exploded");
		const ctx = {
			ui: {
				notify: () => {
					throw boom;
				},
				setStatus: vi.fn(),
			},
		};
		expect(() => safeNotify(ctx, "hi")).toThrow(boom);
	});
});

describe("safeSetStatus", () => {
	it("passes through to ctx.ui.setStatus", () => {
		const setStatus = vi.fn();
		safeSetStatus({ ui: { notify: vi.fn(), setStatus } }, "fallback", "x");
		expect(setStatus).toHaveBeenCalledWith("fallback", "x");
	});

	it("swallows a stale-context throw", () => {
		const setStatus = vi.fn();
		const staleCtx = {
			get ui(): { notify: () => void; setStatus: typeof setStatus } {
				throw new Error(STALE_MESSAGE);
			},
		};
		expect(() => safeSetStatus(staleCtx, "fallback", "x")).not.toThrow();
		expect(setStatus).not.toHaveBeenCalled();
	});

	it("rethrows non-stale errors", () => {
		const boom = new Error("status exploded");
		const ctx = {
			ui: {
				notify: vi.fn(),
				setStatus: () => {
					throw boom;
				},
			},
		};
		expect(() => safeSetStatus(ctx, "fallback", "x")).toThrow(boom);
	});
});
