#!/usr/bin/env node
/**
 * Hoisting canary: fail when pi-ai resolves a runtime dependency from a
 * nested copy instead of the hoisted tree.
 *
 * npm sometimes nests duplicates (our own lockfile has nested `typebox`
 * under pi-coding-agent) — harmless until the nested copy goes missing or
 * stale, at which point pi-ai's internal imports break in ways the closure
 * check can only catch after the fact. Asserting the *resolved* location
 * is canonical fails at install time, with both paths named. Sibling
 * subtrees that pi-ai's walk-up never crosses are ignored.
 *
 * Companion to check-installed-closure.mjs (which proves resolvability):
 * this proves canonical placement. Both run in install-test on every OS.
 *
 * Usage:
 *   node scripts/check-hoisting.mjs [pi-free-package-dir]
 *     (default: the current directory)
 */
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const packageDir = resolve(process.argv[2] ?? ".");

function findPackageUp(startDir, segments) {
	let dir = startDir;
	for (;;) {
		const candidate = join(dir, "node_modules", ...segments);
		if (existsSync(join(candidate, "package.json"))) return candidate;
		const parent = dirname(dir);
		if (parent === dir) return undefined;
		dir = parent;
	}
}

const piAiRoot = findPackageUp(join(packageDir, "dist"), [
	"@earendil-works",
	"pi-ai",
]);
if (!piAiRoot) {
	console.error(
		"[hoisting] FAIL: @earendil-works/pi-ai is not resolvable from the installed tree.",
	);
	process.exit(1);
}

let piAiPkg;
try {
	piAiPkg = JSON.parse(readFileSync(join(piAiRoot, "package.json"), "utf8"));
} catch (error) {
	console.error(
		`[hoisting] FAIL: cannot read pi-ai package.json: ${error.message}`,
	);
	process.exit(1);
}

// piAiRoot is <root>/node_modules/<scope>/pi-ai: three levels up is the
// install root whose node_modules is the canonical hoisted location.
const topLevel = dirname(dirname(dirname(piAiRoot)));
const requireFromPiAi = createRequire(
	pathToFileURL(join(piAiRoot, "package.json")).href,
);
const offenders = [];
for (const name of Object.keys(piAiPkg.dependencies ?? {})) {
	const segments = name.split("/");
	const canonical = join(topLevel, "node_modules", ...segments);
	let resolvedRoot;
	try {
		const resolvedFile = requireFromPiAi.resolve(name);
		// Walk up from the resolved file to its package root.
		let dir = dirname(resolvedFile);
		for (;;) {
			if (existsSync(join(dir, "package.json"))) {
				const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
				if (pkg.name === name) {
					resolvedRoot = dir;
					break;
				}
			}
			const parent = dirname(dir);
			if (parent === dir) break;
			dir = parent;
		}
	} catch {
		// Unresolvable here is the closure check's jurisdiction, not this
		// script's (import-only packages also fail require.resolve) — skip.
		continue;
	}
	if (resolvedRoot && resolvedRoot !== canonical) {
		offenders.push(`${name} resolves from nested ${resolvedRoot}`);
	}
}

if (offenders.length > 0) {
	console.error(
		`[hoisting] FAIL: ${offenders.length} pi-ai runtime dep(s) resolve outside the hoisted tree:`,
	);
	for (const offender of offenders) console.error(`  - ${offender}`);
	process.exit(1);
}

console.log(
	`[hoisting] PASS: all pi-ai runtime deps resolve from ${join(topLevel, "node_modules")}`,
);
