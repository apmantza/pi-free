#!/usr/bin/env node
/**
 * Fail if package-lock.json's root dependency specs drift from package.json.
 *
 * This is intentionally deterministic: it compares spec strings only, not
 * resolved transitive versions. Fix failures with `npm install` and commit the
 * updated lockfile.
 */
import * as fs from "node:fs";

function readJson(file) {
	try {
		return JSON.parse(fs.readFileSync(file, "utf-8"));
	} catch (error) {
		console.error(`Cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`);
		process.exit(1);
	}
}

const pkg = readJson("package.json");
const lock = readJson("package-lock.json");
const root = lock.packages?.[""] ?? {};

const SECTIONS = [
	"dependencies",
	"devDependencies",
	"optionalDependencies",
	"peerDependencies",
];

const problems = [];
for (const section of SECTIONS) {
	const pkgDeps = pkg[section] ?? {};
	const lockDeps = root[section] ?? {};

	for (const [name, spec] of Object.entries(pkgDeps)) {
		if (lockDeps[name] !== spec) {
			problems.push(
				`${section}.${name}: package.json="${spec}" lock="${lockDeps[name] ?? "(missing)"}"`,
			);
		}
	}

	for (const name of Object.keys(lockDeps)) {
		if (!(name in pkgDeps)) {
			problems.push(`${section}.${name}: in lock but not package.json`);
		}
	}
}

if (problems.length > 0) {
	console.error("package-lock.json is out of sync with package.json:\n");
	for (const problem of problems) console.error(`  • ${problem}`);
	console.error("\nRun `npm install` and commit the updated package-lock.json.");
	process.exit(1);
}

console.log("package-lock.json is in sync with package.json ✓");
