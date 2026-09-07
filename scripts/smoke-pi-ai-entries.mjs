#!/usr/bin/env node
/**
 * Execute pi-ai's real entry points from an installed tree.
 *
 * Companion to check-installed-closure.mjs for #510: the closure check
 * proves pi-ai's transitive imports *resolve*; this smoke proves the
 * entries actually *execute* end to end (a corrupt file or an
 * export-shape drift would pass resolution and fail here).
 *
 * It loads through the installed package's own `loadPiAiEntry` (the same
 * code path production streams use), so on a healthy tree it exercises the
 * fast path, and on a sick-but-resilient tree it exercises whatever
 * fallback the loader selects. No network, no model calls, no user files.
 *
 * Usage:
 *   node scripts/smoke-pi-ai-entries.mjs [pi-free-package-dir]
 *     (default: the current directory — the repo root after `npm run build`)
 */
import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const packageDir = resolve(process.argv[2] ?? ".");

// Validate the CLI-supplied directory before touching the filesystem
// beneath it (same shape as check-installed-closure.mjs).
// NOSONAR (jssecurity:S8707): local read-only smoke test over an
// operator-supplied tree — no writes, no exec, no network, no privilege
// boundary; output goes to the operator's own terminal.
let packageStat;
try {
	packageStat = statSync(packageDir); // NOSONAR -- see justification above
} catch {
	packageStat = undefined;
}
if (!packageStat?.isDirectory()) {
	console.error(`[pi-ai-entries] FAIL: not a package directory: ${packageDir}`);
	process.exit(1);
}
const loaderFile = join(packageDir, "dist", "lib", "pi-ai-loader.js");
if (!existsSync(loaderFile)) {
	console.error(
		`[pi-ai-entries] FAIL: loader not found: ${loaderFile} — run npm run build first.`,
	);
	process.exit(1);
}

const { loadPiAiEntry } = await import(pathToFileURL(loaderFile).href);
if (typeof loadPiAiEntry !== "function") {
	console.error(
		"[pi-ai-entries] FAIL: installed loader does not export loadPiAiEntry.",
	);
	process.exit(1);
}

function assertExports(entry, module, names) {
	const missing = names.filter((name) => module?.[name] === undefined);
	if (missing.length > 0) {
		console.error(
			`[pi-ai-entries] FAIL: "${entry}" loaded but missing export(s): ${missing.join(", ")}`,
		);
		process.exit(1);
	}
	console.log(`[pi-ai-entries] ok: "${entry}" (${names.join(", ")})`);
}

// The compat surface production streams consume (see lib/lazy-compat.ts and
// the vendored bundle's export list in scripts/build.mjs).
const compat = await loadPiAiEntry("compat");
assertExports("compat", compat, [
	"openAICompletionsApi",
	"anthropicMessagesApi",
	"openAIResponsesApi",
	"googleGenerativeAIApi",
]);

// The catalog surface model-metadata consumes.
const providersAll = await loadPiAiEntry("providers/all");
assertExports("providers/all", providersAll, ["getBuiltinProviders"]);

console.log(
	"[pi-ai-entries] PASS: pi-ai entries execute from the installed tree",
);
