/**
 * Unit tests for the pure settled-run decisions (arch lifecycle review).
 * These pin the exact verdicts the agent_settled handler acts on, so the
 * orchestration refactor in index.ts stays behavior-identical.
 */

import { describe, expect, it } from "vitest";
import {
	buildAutoContinueContent,
	classifySettledFailure,
	matchesScope,
} from "../lib/auto-fallback/settled-decision.ts";

describe("matchesScope", () => {
	it("restricts provider scope to the failing provider", () => {
		expect(matchesScope("kilo", "provider", "kilo", [])).toBe(true);
		expect(matchesScope("cline", "provider", "kilo", [])).toBe(false);
	});

	it("restricts whitelist scope to listed providers", () => {
		expect(matchesScope("kilo", "whitelist", "cline", ["kilo"])).toBe(true);
		expect(matchesScope("cline", "whitelist", "cline", ["kilo"])).toBe(false);
	});

	it("admits every provider in global scope", () => {
		expect(matchesScope("anything", "global", "kilo", [])).toBe(true);
	});
});

describe("classifySettledFailure", () => {
	const noStatus = () => undefined;

	it("returns null for clean runs and empty runs", () => {
		expect(
			classifySettledFailure(
				{ role: "assistant", stopReason: "stop" },
				"kilo",
				"m",
				noStatus,
			),
		).toBeNull();
		expect(classifySettledFailure(null, "kilo", "m", noStatus)).toBeNull();
	});

	it("classifies a recoverable error with message identity", () => {
		const failure = classifySettledFailure(
			{
				role: "assistant",
				provider: "kilo",
				model: "broken-model",
				stopReason: "error",
				errorMessage: "429 rate limited",
			},
			"kilo",
			"other-model",
			noStatus,
		);
		expect(failure).toMatchObject({
			provider: "kilo",
			modelId: "broken-model",
			key: "kilo/broken-model",
		});
		expect(failure?.reason).toBe("error");
	});

	it("falls back to the current model when the message lacks identity", () => {
		const failure = classifySettledFailure(
			{ role: "assistant", stopReason: "error", errorMessage: "500 boom" },
			"cline",
			"current-model",
			noStatus,
		);
		expect(failure).toMatchObject({
			provider: "cline",
			modelId: "current-model",
		});
	});

	it("returns null when identity is unresolvable", () => {
		expect(
			classifySettledFailure(
				{ role: "assistant", stopReason: "error", errorMessage: "500 boom" },
				undefined,
				undefined,
				noStatus,
			),
		).toBeNull();
	});

	it("treats a bare user abort as cancellation, not failure", () => {
		expect(
			classifySettledFailure(
				{ role: "assistant", stopReason: "aborted" },
				"kilo",
				"m",
				noStatus,
			),
		).toBeNull();
	});

	it("treats abort-after-5xx as a recoverable server kill", () => {
		const failure = classifySettledFailure(
			{
				role: "assistant",
				provider: "kilo",
				model: "m",
				stopReason: "aborted",
				// Must carry a classifiable error: a bare "aborted" with no
				// known class is user-initiated and returns null earlier.
				errorMessage: "429 rate limited",
			},
			"kilo",
			"m",
			() => 503,
		);
		expect(failure?.reason).toBe("abort+http:503");
	});

	it("treats abort-after-4xx as unrecoverable", () => {
		expect(
			classifySettledFailure(
				{
					role: "assistant",
					provider: "kilo",
					model: "m",
					stopReason: "aborted",
					errorMessage: "aborted",
				},
				"kilo",
				"m",
				() => 400,
			),
		).toBeNull();
	});
});

describe("buildAutoContinueContent", () => {
	it("returns null without a replayable prompt", () => {
		expect(buildAutoContinueContent(null)).toBeNull();
		expect(buildAutoContinueContent({ text: "" })).toBeNull();
	});

	it("replays text prompts as a plain string", () => {
		expect(buildAutoContinueContent({ text: "hello" })).toBe("hello");
	});

	it("keeps the multimodal shape for image-bearing prompts", () => {
		const images = [{ type: "image", data: "abc" }];
		expect(buildAutoContinueContent({ text: "look", images })).toEqual([
			{ type: "text", text: "look" },
			{ type: "image", data: "abc" },
		]);
	});
});
