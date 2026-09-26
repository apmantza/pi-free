/**
 * Regression: test code must be runnable inside a worker thread.
 *
 * Shipped defect (#583, found while shipping #582): the advisory mutation lane
 * runs every test through `@stryker-mutator/vitest-runner`, which hardcodes
 * `pool: 'threads'` with `maxWorkers: 1` (dist/src/vitest-test-runner.js,
 * `#getVitestPoolConfig`) and exposes no pool option in its schema. The normal
 * suite never sees the difference — vitest's default pool is `forks`
 * (`resolved.pool ??= "forks"`), where these calls are fine — so a
 * worker-hostile call is green everywhere until the module it covers happens to
 * enter the mutated set. Then the lane dies in its dry run, before a single
 * mutant is tested:
 *
 *   ERROR DryRunExecutor One or more tests failed in the initial test run:
 *     resolvePiAiPackageRoot rejects a relative argv1 ...
 *       process.chdir() is not supported in workers
 *   ConfigError: There were failed tests in the initial test run.
 *
 * The historical instance was a `process.chdir()` used to model a CWD-relative
 * `argv[1]` — a perfectly reasonable-looking test. Recurrence: any future test
 * (or runtime module a test loads) calling one of these APIs in the scanned
 * surface reds the mutation lane for an unrelated change.
 *
 * Probed in a worker thread (node 22, `node:worker_threads`):
 *   process.chdir/setuid/setgid/setgroups/initgroups, process.umask(arg)
 *     -> throw ERR_WORKER_UNSUPPORTED_OPERATION
 *   process.umask() (getter), process.on("exit"|"SIGINT"), env/argv writes
 *     -> fine, not flagged
 *
 * `process.exit()` is deliberately NOT flagged: it terminates the worker rather
 * than throwing (a different failure mode), and this tree uses it legitimately
 * in CLI scripts that run as child processes (`scripts/stryker-diff.ts`).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { blankNonCode } from "./helpers/blanked-source.ts";

const REPO_ROOT = join(__dirname, "..");

/**
 * Everything a vitest run can load in-process: the tests themselves, the
 * runtime modules they import (which execute inside the same worker while
 * mutated), and the script modules three tests import directly.
 */
const SCANNED_ROOTS = ["tests", "lib", "providers"];
const SCANNED_ROOT_FILES = [
	"index.ts",
	"config.ts",
	"constants.ts",
	"provider-helper.ts",
];

/**
 * The hostile calls. Prose immunity comes from {@link blankNonCode}, which is
 * what the mutations on this guard actually attack, so the patterns stay plain
 * rather than requiring an argument: `process.chdir()` with no argument is a
 * type error in real code, so the variant adds no detection. `umask` is the
 * exception — a bare `process.umask()` is the *getter*, legal safe code that
 * must not be flagged.
 */
const HOSTILE_CALLS: Array<{ name: string; pattern: RegExp }> = [
	{ name: "chdir", pattern: /process\.chdir\s*\(/g },
	{ name: "setuid", pattern: /process\.setuid\s*\(/g },
	{ name: "setgid", pattern: /process\.setgid\s*\(/g },
	{ name: "setgroups", pattern: /process\.setgroups\s*\(/g },
	{ name: "initgroups", pattern: /process\.initgroups\s*\(/g },
	{ name: "umask(setter)", pattern: /process\.umask\s*\(\s*[^)\s]/g },
];

function collectSourceFiles(dir: string): string[] {
	const files: string[] = [];
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return files; // a root that does not exist in this checkout
	}
	for (const entry of entries) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) {
			files.push(...collectSourceFiles(path));
		} else if (/\.(?:ts|mts|cts)$/.test(entry)) {
			files.push(path);
		}
	}
	return files;
}

/** 1-based line of a character offset, for an actionable failure message. */
function lineAt(source: string, index: number): number {
	return source.slice(0, index).split("\n").length;
}

/**
 * Hostile calls in one file, as actionable messages. Split out from the tree
 * walk so the prose-immunity direction is directly testable: a comment quoting
 * a hostile call must produce nothing, a real call must produce one message.
 */
function scanForHostileCalls(file: string, source: string): string[] {
	// Comments and literals are blanked first: pi-free's own source *quotes*
	// these calls in comments explaining why they are banned (see
	// tests/pi-ai-loader.test.ts), and a comment must never trip the scan.
	const code = blankNonCode(source);
	const violations: string[] = [];
	for (const { name, pattern } of HOSTILE_CALLS) {
		pattern.lastIndex = 0;
		for (const match of code.matchAll(pattern)) {
			violations.push(
				`${relative(REPO_ROOT, file)}:${lineAt(source, match.index)} process.${name} — ` +
					"worker threads throw ERR_WORKER_UNSUPPORTED_OPERATION here, " +
					"which reds the Stryker dry run for unrelated changes (#583)",
			);
		}
	}
	return violations;
}

describe("worker-thread safety of scanned source", () => {
	const files = [
		...SCANNED_ROOTS.flatMap((root) =>
			collectSourceFiles(join(REPO_ROOT, root)),
		),
		...SCANNED_ROOT_FILES.map((name) => join(REPO_ROOT, name)).filter(
			(path) => {
				try {
					return statSync(path).isFile();
				} catch {
					return false;
				}
			},
		),
	];

	it("scans a non-trivial number of files (guard is not vacuous)", () => {
		// If the roots ever stop resolving, the scan below passes for the wrong
		// reason. Pin a floor well under the real count.
		expect(files.length).toBeGreaterThan(50);
	});

	it("has no worker-hostile process call in test or runtime code", () => {
		const violations = files.flatMap((file) =>
			scanForHostileCalls(file, readFileSync(file, "utf-8")),
		);
		expect(violations).toEqual([]);
	});
});

describe("scanForHostileCalls", () => {
	const fake = join(REPO_ROOT, "tests", "synthetic.ts");

	it("reports a real hostile call with its line", () => {
		const source = [
			"const a = 1;",
			"process.chdir(cwd);",
			"process.umask(0o022);",
		].join("\n");
		expect(scanForHostileCalls(fake, source)).toEqual([
			expect.stringContaining("synthetic.ts:2 process.chdir"),
			expect.stringContaining("synthetic.ts:3 process.umask(setter)"),
		]);
	});

	it("never fires on prose quoting a hostile call", () => {
		// The self-excuse direction: a comment saying "do not call
		// process.chdir(cwd) here" must not fail the guard. The historical shape
		// (#582) was explained in comments in tests/pi-ai-loader.test.ts, which
		// is why the scan runs over blanked source.
		const source = [
			"// banned: process.chdir(cwd) - see #583",
			"/* process.umask(0o022) is not worker-safe */",
			'const s = "process.setuid(0)";',
			"const t = `process.setgid(0)`;",
		].join("\n");
		expect(scanForHostileCalls(fake, source)).toEqual([]);
	});

	it("does not flag the safe argument-less forms", () => {
		// `process.umask()` is the getter, and `process.chdir()` with no argument
		// is a type error — neither is real hostile code.
		const source = [
			"const a = process.umask();",
			"// process.chdir():",
			"const t = `x ${/* process.chdir() */ 1} y`;",
		].join("\n");
		expect(scanForHostileCalls(fake, source)).toEqual([]);
	});
});

describe("blankNonCode", () => {
	// Every case asserts length preservation: `blank` writes into a fixed-size
	// array, so an out-of-range span used to *grow* it silently — how the
	// interpolation bug first surfaced.
	const cases: Array<{
		name: string;
		source: string;
		visible?: string[];
		hidden?: string[];
	}> = [
		{
			name: "line and block comments",
			source:
				'// process.chdir("in-a-line-comment")\n/* process.chdir(block) */\nrealCode();',
			visible: ["realCode();"],
			hidden: ["chdir"],
		},
		{
			name: "string literals",
			source: 'const s = "process.chdir(in-a-string)"; keepMe();',
			visible: ["keepMe();"],
			hidden: ["chdir"],
		},
		{
			name: "template literal text",
			source: "const t = `process.chdir(in-a-template)`; keepMe();",
			visible: ["keepMe();"],
			hidden: ["chdir"],
		},
		{
			name: "template interpolation stays code",
			source: "const t = `text ${process.umask(0o022)} tail`;",
			visible: ["process.umask(0o022)"],
			hidden: ["text", "tail"],
		},
		{
			name: "nested template inside an interpolation",
			source: "const t = `a ${`b ${process.chdir(x)} c`} d`;",
			visible: ["process.chdir(x)"],
		},
		{
			name: "braces inside an interpolation do not close it early",
			source:
				"const t = `a ${JSON.stringify({ a: 1 })} b`;const y = process.chdir(z);",
			visible: ["JSON.stringify({ a: 1 })", "process.chdir(z)"],
		},
		{
			// The shape that breaks naive blankers: scripts/check-runtime-imports.mjs
			// matches (["']) inside a regex literal, so a quote-first scan would
			// swallow everything to the next quote — the code-hiding direction.
			name: "quote-bearing regex literal",
			source: `const re = /(["'])/g; const after = process.chdir(x);`,
			visible: ["process.chdir(x)"],
		},
		{
			name: "division is not a regex literal",
			source: "const r = a / b; const c = process.umask(0o022);",
			visible: ["process.umask(0o022)"],
		},
		{
			name: "unterminated string stops at the newline",
			source: `const broken = "oops\nprocess.chdir(x);`,
			visible: ["process.chdir(x);"],
		},
	];

	for (const { name, source, visible = [], hidden = [] } of cases) {
		it(name, () => {
			const code = blankNonCode(source);
			expect(code).toHaveLength(source.length);
			for (const needle of visible) expect(code).toContain(needle);
			for (const needle of hidden) expect(code).not.toContain(needle);
		});
	}

	it("keeps line structure so reported line numbers are true", () => {
		const source = "// a\n// b\nrealCode();\n";
		const code = blankNonCode(source);
		expect(code.split("\n")).toHaveLength(source.split("\n").length);
		expect(code.split("\n")[2]).toContain("realCode();");
	});
});
