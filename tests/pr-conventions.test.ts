import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// Exercise the PR-convention scripts through their real CLI surface
// (argv + exit codes), the same way install-closure.test.ts drives its
// script. No static .mjs import: CLI coverage includes arg handling and
// the GITHUB_EVENT_PATH fallback the unit surface would miss.
function runScript(script: string, args: string[] = [], env = {}) {
	const result = spawnSync(process.execPath, [script, ...args], {
		encoding: "utf8",
		env: { ...process.env, ...env },
	});
	return {
		status: result.status,
		stdout: result.stdout,
		stderr: result.stderr,
	};
}

describe("check-pr-title", () => {
	const script = new URL("../scripts/check-pr-title.mjs", import.meta.url)
		.pathname;

	it("accepts a prefixed title with an issue ref", () => {
		const result = runScript(script, ["fix(restore): skip artifacts (#519)"]);
		expect(result.status).toBe(0);
		expect(result.stdout).toContain("PR title ok");
	});

	it("rejects a missing prefix", () => {
		const result = runScript(script, ["restore fix (#519)"]);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("conventional prefix");
	});

	it("rejects a missing issue ref", () => {
		const result = runScript(script, ["ci(hygiene): oxfmt + oxlint + knip"]);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("#123");
	});

	it("accepts every allowed prefix", () => {
		for (const prefix of [
			"feat",
			"fix",
			"chore",
			"docs",
			"refactor",
			"test",
			"ci",
			"perf",
		]) {
			expect(runScript(script, [`${prefix}: something (#1)`]).status).toBe(0);
		}
	});
});

describe("check-pr-body", () => {
	const script = new URL("../scripts/check-pr-body.mjs", import.meta.url)
		.pathname;

	it("accepts a body with a section", () => {
		const result = runScript(script, ["## What\n\nDid the thing."]);
		expect(result.status).toBe(0);
		expect(result.stdout).toContain("PR body ok");
	});

	it("rejects an empty body", () => {
		const result = runScript(script, ["   "]);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("empty");
	});

	it("rejects prose without a section heading", () => {
		const result = runScript(script, ["Did the thing, trust me."]);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("## section");
	});

	it("ignores ## inside fenced code blocks", () => {
		const result = runScript(script, ["```\n## not a section\n```"]);
		expect(result.status).toBe(1);
	});
});
