#!/usr/bin/env node
/**
 * Execute pi-ai's entry points from an installed tree whose walk-up chain is
 * shadowed by a stale pi-ai copy.
 *
 * Regression detector for #581: a long-ago `npm install` had left an old
 * `@earendil-works/pi-ai` in a node_modules directory above the pi-free
 * install (right package name, allowed version, but an `exports` map that
 * predates the allow-listed entries). Node resolved that copy for the
 * loader's bare-specifier fast path and threw
 *
 *   Error: Package subpath './compat' is not defined by "exports" in
 *   .../node_modules/@earendil-works/pi-ai/package.json imported from
 *   .../pi-free/dist/lib/pi-ai-loader.js
 *
 * which the loader did not recognize as "pi-ai not found here", so the disk
 * fallback never ran and every provider stream died at first use.
 *
 * Every existing smoke passed on that machine: they run against a healthy
 * tree, so the shadowing chain was never exercised. This one builds the
 * hostile layout deliberately —
 *
 *   <fixture>/node_modules/@earendil-works/pi-ai   stale: no "./compat" export
 *   <fixture>/node_modules/pi-free/dist            the built package under test
 *   <fixture>/host/node_modules/@earendil-works/pi-ai   the real copy
 *   <fixture>/host/dist/cli.js                     argv[1] → host-entry probe
 *
 * — copies the package under test into it WITHOUT dist/vendor (so the
 * vendored last-resort bundle cannot paper over a broken disk fallback),
 * and runs the same `loadPiAiEntry` production streams use. Recovery must
 * load the real copy's entries, proven by sentinel export values the stale
 * copy does not carry.
 *
 * Usage:
 *   node scripts/smoke-pi-ai-shadowed.mjs [pi-free-package-dir]
 *     (default: the current directory — the repo root after `npm run build`)
 */
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const packageDir = resolve(process.argv[2] ?? ".");

// Validate the CLI-supplied directory before touching the filesystem beneath
// it (same shape as smoke-pi-ai-entries.mjs).
// NOSONAR (jssecurity:S8707): local read-only smoke test over an
// operator-supplied tree — no privilege boundary; the fixture it writes lives
// under the OS temp dir and is removed on exit.
let packageStat;
try {
	packageStat = statSync(packageDir); // NOSONAR -- see justification above
} catch {
	packageStat = undefined;
}
if (!packageStat?.isDirectory()) {
	console.error(
		`[pi-ai-shadowed] FAIL: not a package directory: ${packageDir}`,
	);
	process.exit(1);
}
const distDir = join(packageDir, "dist");
if (!existsSync(join(distDir, "lib", "pi-ai-loader.js"))) {
	console.error(
		`[pi-ai-shadowed] FAIL: loader not found: ${join(distDir, "lib", "pi-ai-loader.js")} — run npm run build first.`,
	);
	process.exit(1);
}

/** Sentinel export values that only the real (host) copy carries. */
const HOST_COMPAT_SENTINEL = "compat-from-real-pi-ai";
const HOST_PROVIDERS_SENTINEL = "providers-from-real-pi-ai";

const fixture = mkdtempSync(join(tmpdir(), "pi-free-shadowed-"));
// Remove the fixture on every exit path — including the process.exit(1)
// failures below, which skip `finally` blocks. Probe hygiene: a failing run
// must not leave a tree behind in the temp dir.
process.once("exit", () => rmSync(fixture, { recursive: true, force: true }));
try {
	const fixtureNodeModules = join(fixture, "node_modules");
	const installed = join(fixtureNodeModules, "pi-free");
	const staleRoot = join(fixtureNodeModules, "@earendil-works", "pi-ai");
	const hostRoot = join(
		fixture,
		"host",
		"node_modules",
		"@earendil-works",
		"pi-ai",
	);
	const hostCli = join(fixture, "host", "dist", "cli.js");

	// 1) The package under test, minus dist/vendor: the smoke must pass through
	//    the on-disk fallback, never through the vendored last-resort bundle.
	mkdirSync(installed, { recursive: true });
	cpSync(distDir, join(installed, "dist"), {
		recursive: true,
		filter: (source) =>
			!source.endsWith(`${join("dist", "vendor")}`) && !source.endsWith(".map"),
	});
	writeFileSync(
		join(installed, "package.json"),
		JSON.stringify(
			{ name: "pi-free", version: "0.0.0-shadowed-smoke", type: "module" },
			null,
			2,
		),
	);

	// 2) The stale copy: correct name, above the peer floor, exports map that
	//    predates "./compat" and "./providers/all" — the #581 shape.
	mkdirSync(join(staleRoot, "dist"), { recursive: true });
	writeFileSync(
		join(staleRoot, "package.json"),
		JSON.stringify(
			{
				name: "@earendil-works/pi-ai",
				version: "0.84.2",
				type: "module",
				exports: { ".": { import: "./dist/index.js" } },
			},
			null,
			2,
		),
	);
	writeFileSync(join(staleRoot, "dist", "index.js"), "export {};\n");

	// 3) The real copy, reachable only through the host entry script.
	mkdirSync(join(hostRoot, "dist", "providers"), { recursive: true });
	writeFileSync(
		join(hostRoot, "package.json"),
		JSON.stringify(
			{
				name: "@earendil-works/pi-ai",
				version: "0.87.1",
				type: "module",
				exports: {
					".": { import: "./dist/index.js" },
					"./compat": { import: "./dist/compat.js" },
					"./providers/*": { import: "./dist/providers/*.js" },
				},
			},
			null,
			2,
		),
	);
	writeFileSync(join(hostRoot, "dist", "index.js"), "export {};\n");
	writeFileSync(
		join(hostRoot, "dist", "compat.js"),
		`export const openAICompletionsApi = ${JSON.stringify(HOST_COMPAT_SENTINEL)};\n`,
	);
	writeFileSync(
		join(hostRoot, "dist", "providers", "all.js"),
		`export const getBuiltinProviders = ${JSON.stringify(HOST_PROVIDERS_SENTINEL)};\n`,
	);

	// 4) The host entry script: spawned as argv[1] so the loader's host-entry
	//    probe resolves relative to it, exactly as in a real hosted run.
	mkdirSync(join(fixture, "host", "dist"), { recursive: true });
	writeFileSync(
		hostCli,
		`const { loadPiAiEntry } = await import(${JSON.stringify(
			pathToFileURL(join(installed, "dist", "lib", "pi-ai-loader.js")).href,
		)});
const loaded = {};
for (const entry of ["compat", "providers/all"]) {
	try {
		const mod = await loadPiAiEntry(entry);
		loaded[entry] = mod?.openAICompletionsApi ?? mod?.getBuiltinProviders;
	} catch (error) {
		loaded[entry] = { error: error?.code ?? "unknown", message: String(error?.message ?? error) };
	}
}
process.stdout.write(JSON.stringify(loaded));
`,
	);

	// Absolute argv[1] is what the loader's host-entry probe requires, and a
	// relative one is rejected by design.
	const run = spawnSync(process.execPath, [hostCli], {
		cwd: fixture,
		encoding: "utf8",
	});
	if (run.error) {
		console.error(
			`[pi-ai-shadowed] FAIL: could not run the fixture host: ${run.error.message}`,
		);
		process.exit(1);
	}

	let loaded;
	try {
		loaded = JSON.parse(run.stdout);
	} catch {
		console.error(
			"[pi-ai-shadowed] FAIL: fixture host produced no result " +
				`(exit ${run.status}).\n${run.stderr}`,
		);
		process.exit(1);
	}

	let failed = false;
	for (const [entry, expected] of [
		["compat", HOST_COMPAT_SENTINEL],
		["providers/all", HOST_PROVIDERS_SENTINEL],
	]) {
		const got = loaded[entry];
		if (got === expected) {
			console.log(
				`[pi-ai-shadowed] ok: "${entry}" recovered from the real copy`,
			);
			continue;
		}
		failed = true;
		const detail =
			got && typeof got === "object" && "error" in got
				? `${got.error} :: ${got.message}`
				: `got ${JSON.stringify(got)}`;
		console.error(
			`[pi-ai-shadowed] FAIL: "${entry}" did not recover from a stale shadowing ` +
				`pi-ai copy — ${detail}`,
		);
	}
	if (failed) {
		console.error(
			"[pi-ai-shadowed] FAIL: the loader must skip an entry-less pi-ai copy " +
				"(#581) and keep probing toward the running host's own copy.",
		);
		process.exit(1);
	}

	console.log(
		"[pi-ai-shadowed] PASS: pi-ai entries load despite a stale shadowing copy",
	);
} catch (error) {
	console.error(
		`[pi-ai-shadowed] FAIL: unexpected error — ${error?.stack ?? error}`,
	);
	process.exit(1);
}
