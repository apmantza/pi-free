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
		console.error(
			`Cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`,
		);
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
	console.error(
		"\nRun `npm install` and commit the updated package-lock.json.",
	);
	process.exit(1);
}

// Platform completeness: `npm install` (unlike `npm ci`) re-resolves for
// the CURRENT platform and can silently prune other platforms' optional
// native packages from `packages` — breaking installs on the pruned OS
// (observed: all 19 @typescript/* natives dropped on Linux, Windows tsc
// dead with "Unable to resolve @typescript/typescript-win32-x64"). Assert
// every dependency name referenced by any installed package resolves to a
// packages entry — top-level for root deps, top-level or nested for the
// rest (deduplication legitimately relocates entries).
const packagePaths = Object.keys(lock.packages ?? {});
const missing = [];
for (const [parentPath, entry] of Object.entries(lock.packages ?? {})) {
	// Both maps: `dependencies` for hard deps, `optionalDependencies` for
	// platform natives (typescript lists its per-OS binaries there).
	const deps = { ...entry?.dependencies, ...entry?.optionalDependencies };
	for (const name of Object.keys(deps)) {
		const topLevel = `node_modules/${name}`;
		const nestedSuffix = `/node_modules/${name}`;
		const resolved =
			parentPath === ""
				? packagePaths.includes(topLevel)
				: packagePaths.some((p) => p === topLevel || p.endsWith(nestedSuffix));
		if (!resolved) {
			missing.push(
				`${parentPath || "<root>"} references ${name} (no packages entry)`,
			);
		}
	}
}

if (missing.length > 0) {
	console.error(
		"package-lock.json is missing packages entries (likely pruned by `npm install` on one platform):\n",
	);
	for (const item of missing) console.error(`  • ${item}`);
	console.error(
		"\nDo NOT fix with a bare `npm install` on one OS — that is what prunes\n" +
			"other platforms' optionals. Restore the dropped entries (e.g. from\n" +
			"git history) or regenerate the lock on the affected platform.",
	);
	process.exit(1);
}

console.log("package-lock.json is in sync with package.json ✓");
