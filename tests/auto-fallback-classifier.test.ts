/**
 * Tests for lib/auto-fallback/classifier.ts
 *
 * Covers HTTP status classification, errorMessage regex classification,
 * and the abort refinement heuristic (Q23 = B).
 */

import { describe, expect, it } from "vitest";
import {
	classifyAbort,
	classifyAssistantFailure,
	classifyErrorMessage,
	classifyHttpStatus,
} from "../lib/auto-fallback/classifier.ts";

describe("classifyHttpStatus", () => {
	it("marks 429 / 5xx as recoverable", () => {
		expect(classifyHttpStatus(429)).toBe("recoverable");
		expect(classifyHttpStatus(402)).toBe("recoverable");
		expect(classifyHttpStatus(408)).toBe("recoverable");
		expect(classifyHttpStatus(500)).toBe("recoverable");
		expect(classifyHttpStatus(502)).toBe("recoverable");
		expect(classifyHttpStatus(503)).toBe("recoverable");
		expect(classifyHttpStatus(504)).toBe("recoverable");
		expect(classifyHttpStatus(529)).toBe("recoverable"); // Anthropic overloaded
	});

	it("marks auth + bad-request as unrecoverable", () => {
		expect(classifyHttpStatus(400)).toBe("unrecoverable");
		expect(classifyHttpStatus(401)).toBe("unrecoverable");
		expect(classifyHttpStatus(403)).toBe("unrecoverable");
		expect(classifyHttpStatus(404)).toBe("unrecoverable");
		expect(classifyHttpStatus(422)).toBe("unrecoverable");
	});

	it("marks unknown status as 'unknown' (treated as recoverable by callers)", () => {
		expect(classifyHttpStatus(418)).toBe("unrecoverable"); // listed
		expect(classifyHttpStatus(599)).toBe("unknown");
		expect(classifyHttpStatus(0)).toBe("unknown");
	});
});

describe("classifyErrorMessage", () => {
	it("matches quota/limit messages as recoverable", () => {
		expect(classifyErrorMessage("insufficient_quota: balance is 0")).toBe(
			"recoverable",
		);
		expect(classifyErrorMessage("Quota exceeded for free tier")).toBe(
			"recoverable",
		);
		expect(classifyErrorMessage("Monthly usage limit reached")).toBe(
			"recoverable",
		);
		expect(classifyErrorMessage("available balance: 0")).toBe(
			"recoverable",
		);
		expect(classifyErrorMessage("Out of budget")).toBe("recoverable");
	});

	it("matches transient errors as recoverable", () => {
		expect(classifyErrorMessage("429 rate limit hit")).toBe("recoverable");
		expect(classifyErrorMessage("Server overloaded, try again")).toBe(
			"recoverable",
		);
		expect(classifyErrorMessage("fetch failed (ENOTFOUND)")).toBe(
			"recoverable",
		);
		expect(classifyErrorMessage("socket hang up")).toBe("recoverable");
		expect(classifyErrorMessage("Request timed out")).toBe("recoverable");
	});

	it("matches fatal patterns as unrecoverable", () => {
		expect(classifyErrorMessage("Invalid API key")).toBe("unrecoverable");
		expect(classifyErrorMessage("Permission denied")).toBe("unrecoverable");
		expect(
			classifyErrorMessage("context_length_exceeded: max is 8192"),
		).toBe("unrecoverable");
		expect(classifyErrorMessage("model_not_found")).toBe("unrecoverable");
	});

	it("returns null for empty or unrecognized messages", () => {
		expect(classifyErrorMessage("")).toBe(null);
		expect(classifyErrorMessage(undefined)).toBe(null);
		expect(classifyErrorMessage("an unspecified transient hiccup")).toBe(
			null,
		);
	});
});

describe("classifyAssistantFailure", () => {
	it("only acts on stopReason 'error' or 'aborted'", () => {
		expect(classifyAssistantFailure("stop", "anything")).toBe(null);
		expect(classifyAssistantFailure("length", "anything")).toBe(null);
		expect(classifyAssistantFailure("toolUse", "anything")).toBe(null);
		expect(classifyAssistantFailure("deferred", "anything")).toBe(null);
	});

	it("returns null for aborted without any signal (Q23 default)", () => {
		expect(classifyAssistantFailure("aborted", undefined)).toBe(null);
		expect(classifyAssistantFailure("aborted", "no signal here")).toBe(null);
	});

	it("returns the kind for error + recoverable message", () => {
		expect(
			classifyAssistantFailure("error", "rate limit exceeded"),
		).toBe("recoverable");
	});

	it("returns the kind for error + unrecoverable message", () => {
		expect(
			classifyAssistantFailure("error", "Invalid API key"),
		).toBe("unrecoverable");
	});
});

describe("classifyAbort", () => {
	it("returns null when no last status", () => {
		expect(classifyAbort(undefined)).toBe(null);
	});

	it("treats 5xx as recoverable", () => {
		expect(classifyAbort(500)).toBe("recoverable");
		expect(classifyAbort(502)).toBe("recoverable");
		expect(classifyAbort(503)).toBe("recoverable");
	});

	it("treats 4xx as unrecoverable", () => {
		expect(classifyAbort(400)).toBe("unrecoverable");
		expect(classifyAbort(429)).toBe("unrecoverable");
	});

	it("treats 2xx as null (user-initiated)", () => {
		expect(classifyAbort(200)).toBe(null);
	});
});