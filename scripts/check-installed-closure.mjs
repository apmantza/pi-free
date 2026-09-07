#!/usr/bin/env node
/**
 * Verify pi-ai's runtime dependency closure resolves from an installed tree.
 *
 * Regression detector for #510: pi-ai was physically present in
 * `~/.pi/agent/npm/node_modules`, but its own internal `typebox` import
 * failed there — a sick install tree that every load-only smoke check
 * (bare entry import, extension-loader load, RPC `get_commands`) passes,
 * because the crash only fires when pi-ai's real entry executes.
 *
 * This check mirrors what Node sees when pi-ai's own files import their
 * bare-specifier dependencies: for each of pi-ai's runtime `dependencies`
 * it resolves the package from pi-ai's location (Node's walk-up), failing
 * loudly on the first unresolvable one. OS-agnostic by construction —
 * `createRequire` + `path.join`, no shell, no platform probes.
 *
 * Usage:
 *   node scripts/check-installed-closure.mjs [pi-free-package-dir]
 *     (default: the current directory — the repo root after `npm run build`)
 *
 * In CI's install-test job the argument is the global install dir, so the
 * check runs against the exact tree `pi install` produced, on every matrix
 * OS. It also doubles as a user-facing diagnostic: point it at any suspect
 * pi-free install and it names the missing package.
 */
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const packageDir = resolve(process.argv[2] ?? ".");

const entry = join(packageDir, "dist", "index.js");
if (!existsSync(entry)) {
	console.error(
		`[install-closure] FAIL: compiled entry not found: ${entry} — run npm run build first.`,
	);
	process.exit(1);
}

/**
 * Mimics Node's package lookup: walks up from `startDir`, checking
 * `<dir>/node_modules/<...segments>` at each level. path.join keeps this
 * correct on POSIX and Windows without any platform branch.
 */
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
		"[install-closure] FAIL: @earendil-works/pi-ai is not resolvable from the installed tree " +
			`(${entry}). A missing pi-ai breaks every provider stream.`,
	);
	process.exit(1);
}

let piAiPkg;
try {
	piAiPkg = JSON.parse(readFileSync(join(piAiRoot, "package.json"), "utf8"));
} catch (error) {
	console.error(
		`[install-closure] FAIL: cannot read pi-ai package.json in ${piAiRoot}: ${error.message}`,
	);
	process.exit(1);
}

// Runtime dependencies only: peer/dev/optional deps are the host's business,
// but `dependencies` must resolve from pi-ai's own location or its internal
// bare imports (typebox, openai, …) crash at first use — the #510 shape.
//
// Resolved with createRequire bound to pi-ai's package.json: real Node
// walk-up semantics from pi-ai's location (unlike import.meta.resolve,
// whose parent argument is ignored on some Node builds, silently scoping
// the check to the script's own tree instead). createRequire alone
// false-positives on import-only packages such as
// @earendil-works/pi-telemetry (exports map with an `import` condition but
// no CJS main), so a require failure falls through to a physical
// present-and-ESM-importable check before the dep is reported missing.
const runtimeDeps = piAiPkg.dependencies ?? {};
const requireFromPiAi = createRequire(
	pathToFileURL(join(piAiRoot, "package.json")).href,
);
const missing = [];
for (const name of Object.keys(runtimeDeps)) {
	try {
		requireFromPiAi.resolve(name);
	} catch (requireError) {
		// Possibly import-only (see above) — verify physically before crying
		// wolf. Anything genuinely absent from the walk-up stays missing.
		const depRoot = findPackageUp(piAiRoot, name.split("/"));
		if (depRoot && hasImportableEntry(depRoot)) continue;
		missing.push({
			name,
			want: runtimeDeps[name],
			error: requireError.message,
		});
	}
}

/**
 * True when the package at `depRoot` offers an ESM-importable `.` entry:
 * a string export, an `import`/`default` condition (shallow-nested maps
 * included), or — with no exports map at all — a legacy main/index.js.
 * Covers import-only packages whose require() fails while import() works.
 */
function hasImportableEntry(depRoot) {
	let pkg;
	try {
		pkg = JSON.parse(readFileSync(join(depRoot, "package.json"), "utf8"));
	} catch {
		return false;
	}
	const exportsField = pkg.exports;
	if (exportsField === undefined) {
		return typeof pkg.main === "string" || existsSync(join(depRoot, "index.js"));
	}
	const rootEntry =
		typeof exportsField === "string" ? exportsField : exportsField["."];
	if (typeof rootEntry === "string") return true;
	if (rootEntry && typeof rootEntry === "object") {
		if (
			typeof rootEntry.import === "string" ||
			typeof rootEntry.default === "string"
		) {
			return true;
		}
		for (const value of Object.values(rootEntry)) {
			if (typeof value === "string") return true;
			if (
				value &&
				typeof value === "object" &&
				(typeof value.import === "string" || typeof value.default === "string")
			) {
				return true;
			}
		}
	}
	return false;
}

if (missing.length > 0) {
	console.error(
		`[install-closure] FAIL: pi-ai@${piAiPkg.version ?? "?"} at ${piAiRoot} has ${missing.length} unresolvable runtime dependenc(ies):`,
	);
	for (const { name, want, error } of missing) {
		console.error(`  - ${name}@${want}: ${error.split("\n")[0]}`);
	}
	console.error(
		"[install-closure] The extension loads but crashes on first pi-ai use (#510). " +
			"Reinstall the host tree (fresh `pi install`) so npm repairs the subtree.",
	);
	process.exit(1);
}

const count = Object.keys(runtimeDeps).length;
console.log(
	`[install-closure] PASS: pi-ai@${piAiPkg.version ?? "?"} + ${count} runtime dep(s) resolve from ${piAiRoot}`,
);
