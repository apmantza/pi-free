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
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const packageDir = resolve(process.argv[2] ?? ".");

/**
 * Strip the user's home directory from logged paths (they carry the login
 * name, and this output is routinely pasted into public issue reports).
 * Best-effort exact-prefix match — anything else passes through untouched.
 */
function redactHome(text) {
	const home = homedir();
	if (typeof text !== "string" || !home || !text.startsWith(home)) {
		return text;
	}
	return `~${text.slice(home.length)}`;
}

// Validate the CLI-supplied directory before touching the filesystem
// beneath it: resolve() alone canonicalizes but does not establish that
// the caller gave us a package directory at all.
// NOSONAR justification (jssecurity:S8707 on the statSync below): this is
// a local read-only diagnostic — the operator points it at a tree and it
// reads that tree's package.json files, which the operator could `cat`
// themselves. No writes, no exec, no network, no privilege boundary, and
// output goes to the operator's own terminal, so path traversal here
// cannot reach anything unauthorized. The isDirectory gate below is the
// meaningful validation (typos fail fast with a clear message).
let packageStat;
try {
	packageStat = statSync(packageDir); // NOSONAR -- see justification above
} catch {
	packageStat = undefined;
}
if (!packageStat?.isDirectory()) {
	console.error(
		`[install-closure] FAIL: not a package directory: ${redactHome(packageDir)}`,
	);
	process.exit(1);
}

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
			`(${redactHome(entry)}). A missing pi-ai breaks every provider stream.`,
	);
	process.exit(1);
}

let piAiPkg;
try {
	// NOSONAR (jssecurity:S8707) -- same justification as above: read-only
	// diagnostic over an operator-supplied tree, no privilege boundary.
	piAiPkg = JSON.parse(readFileSync(join(piAiRoot, "package.json"), "utf8")); // NOSONAR
} catch (error) {
	console.error(
		`[install-closure] FAIL: cannot read pi-ai package.json in ${redactHome(piAiRoot)}: ${redactHome(error.message)}`,
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
 * True for an exports target Node can ESM-import: a plain path string or
 * a conditions object offering an `import`/`default` entry.
 */
function hasImportCondition(target) {
	if (typeof target === "string") return true;
	return (
		!!target &&
		typeof target === "object" &&
		(typeof target.import === "string" ||
			typeof target.default === "string")
	);
}

/**
 * True when the package at `depRoot` offers an ESM-importable `.` entry
 * (shallow-nested condition maps included), or — with no exports map at
 * all — a legacy main/index.js. Covers import-only packages whose
 * require() fails while import() works.
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
	if (hasImportCondition(rootEntry)) return true;
	if (rootEntry && typeof rootEntry === "object") {
		return Object.values(rootEntry).some(hasImportCondition);
	}
	return false;
}

if (missing.length > 0) {
	console.error(
		`[install-closure] FAIL: pi-ai@${piAiPkg.version ?? "?"} at ${redactHome(piAiRoot)} has ${missing.length} unresolvable runtime dependenc(ies):`,
	);
	for (const { name, want, error } of missing) {
		// NOSONAR (jssecurity:S8689) -- false positive: the logged values are
		// public npm metadata (dependency name + version range) plus a
		// home-redacted resolution error, printed for the operator only.
		// No credentials, tokens, or file contents ever reach the logs.
		console.error( // NOSONAR
			`  - ${name}@${redactHome(want)}: ${redactHome(error.split("\n")[0])}`,
		);
	}
	console.error(
		"[install-closure] The extension loads but crashes on first pi-ai use (#510). " +
			"Reinstall the host tree (fresh `pi install`) so npm repairs the subtree.",
	);
	process.exit(1);
}

const count = Object.keys(runtimeDeps).length;
console.log(
	`[install-closure] PASS: pi-ai@${piAiPkg.version ?? "?"} + ${count} runtime dep(s) resolve from ${redactHome(piAiRoot)}`,
);
