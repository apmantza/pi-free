/**
 * Pins the `-coverage` parser against **real TLC output**.
 *
 * The samples below are copied verbatim from
 * `node scripts/check-tlc.mjs --coverage` on this tree (TLC v1.7.4): the
 * definition table is TLC's own format, and a parser that drifts from it fails
 * silently — the coverage mode would just print nothing, and a silently empty
 * coverage report is indistinguishable from "no problem here".
 */
import { describe, expect, it } from "vitest";
import {
	formatCoverageReport,
	parseTlcCoverage,
	zeroFireActions,
} from "../scripts/lib/tlc-coverage.mjs";

/** Verbatim table for `ToggleA`, including the never-fired action. */
const TOGGLE_A = [
	"<Init line 54, col 1 to line 54, col 4 of module Toggle>: 1:1",
	"<Restart line 70, col 1 to line 70, col 7 of module Toggle>: 1:1",
	"<FetchStart line 84, col 1 to line 84, col 10 of module Toggle>: 8:8",
	"<FetchComplete line 94, col 1 to line 94, col 13 of module Toggle>: 2:8",
	"<FetchAborted line 107, col 1 to line 107, col 12 of module Toggle>: 0:8",
	"<Toggle line 117, col 1 to line 117, col 6 of module Toggle>: 5:16",
	"<TypeOK line 137, col 1 to line 137, col 6 of module Toggle>",
	"<ViewDisplayAgree line 156, col 1 to line 156, col 16 of module Toggle>",
	"<FullDisplayNeedsFetch line 162, col 1 to line 162, col 21 of module Toggle>",
	"<FlaggedHonesty line 199, col 1 to line 199, col 14 of module Toggle>",
].join("\n");

/** Verbatim lines from a `SessionB` run, to prove the parser is not Toggle-only. */
const SESSION_B = [
	"<Init line 32, col 1 to line 32, col 4 of module Session>: 1:1",
	"<Load line 40, col 1 to line 40, col 4 of module Session>: 9:12",
	"<SessionStart line 47, col 1 to line 47, col 12 of module Session>: 2:3",
	"<Reload line 58, col 1 to line 58, col 6 of module Session>: 2:14",
	"<TypeOK line 70, col 1 to line 70, col 6 of module Session>",
	"<ScopeComplete line 79, col 1 to line 79, col 13 of module Session>",
].join("\n");

describe("parseTlcCoverage", () => {
	it("separates counted actions from uncounted invariants", () => {
		const parsed = parseTlcCoverage(TOGGLE_A);

		expect(parsed.actions.map((a) => a.name)).toEqual([
			"Init",
			"Restart",
			"FetchStart",
			"FetchComplete",
			"FetchAborted",
			"Toggle",
		]);
		expect(parsed.predicates.map((p) => p.name)).toEqual([
			"TypeOK",
			"ViewDisplayAgree",
			"FullDisplayNeedsFetch",
			"FlaggedHonesty",
		]);
		// The pair is preserved as printed, not reconciled: the semantics are
		// TLC's, and this parser must not invent an interpretation.
		expect(parsed.actions.find((a) => a.name === "FetchComplete")).toEqual({
			name: "FetchComplete",
			module: "Toggle",
			fired: 2,
			total: 8,
		});
	});

	it("parses a second module's table identically", () => {
		const parsed = parseTlcCoverage(SESSION_B);
		expect(parsed.actions.map((a) => `${a.module}.${a.name}`)).toEqual([
			"Session.Init",
			"Session.Load",
			"Session.SessionStart",
			"Session.Reload",
		]);
		expect(parsed.predicates.map((p) => p.name)).toEqual([
			"TypeOK",
			"ScopeComplete",
		]);
	});

	it("ignores TLC's surrounding diagnostics", () => {
		const noisy = [
			"TLC2 Version 2.19 of 08 August 2024 (rev: 5a5d1b2)",
			"Running breadth-first search Model-Checking with fp 34 and seed 1",
			"",
			"Progress( 3): 42 states generated, 17 distinct states found, 0 states left on queue.",
			TOGGLE_A,
			"42 states generated, 17 distinct states found, 0 states left on queue.",
			"Finished in 00s at (2026-09-27 03:07:39)",
		].join("\n");
		expect(parseTlcCoverage(noisy)).toEqual(parseTlcCoverage(TOGGLE_A));
	});

	it("returns empty results for input with no table (never throws)", () => {
		// What a run that printed no table (or only diagnostics) must do:
		// report nothing rather than throw, so the coverage mode degrades to a
		// short report instead of failing a toolchain-free plan.
		expect(parseTlcCoverage("")).toEqual({ actions: [], predicates: [] });
		expect(parseTlcCoverage("no table here\n")).toEqual({
			actions: [],
			predicates: [],
		});
	});
});

describe("zeroFireActions", () => {
	it("names the actions that never fired", () => {
		expect(
			zeroFireActions(parseTlcCoverage(TOGGLE_A)).map((a) => a.name),
		).toEqual(["FetchAborted"]);
	});

	it("is empty for a config where every action fired", () => {
		expect(zeroFireActions(parseTlcCoverage(SESSION_B))).toEqual([]);
	});
});

describe("formatCoverageReport", () => {
	it("marks never-fired actions and prints the read-don't-gate caveat", () => {
		const lines = formatCoverageReport(parseTlcCoverage(TOGGLE_A), {
			config: "ToggleA",
		});
		const report = lines.join("\n");

		expect(report).toContain("coverage ToggleA: 6 action(s)");
		expect(report).toContain("Toggle.FetchAborted: 0:8  <- never fired");
		expect(report).toContain("Toggle.FetchComplete: 2:8");
		expect(report).not.toContain("Toggle.FetchComplete: 2:8  <- never fired");
		// The caveat is load-bearing: ToggleA's zero is inert-in-this-config,
		// not a dead guard, and a reader must not gate on it.
		expect(report).toContain("Read the spec before concluding anything");
		expect(report).toContain("invariants/operators (no count): TypeOK");
	});

	it("omits the zero caveat when everything fired", () => {
		const report = formatCoverageReport(parseTlcCoverage(SESSION_B), {
			config: "SessionB",
		}).join("\n");
		expect(report).toContain("coverage SessionB: 4 action(s)");
		expect(report).not.toContain("never fired");
	});
});
