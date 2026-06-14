/**
 * Verifies all relative imports in the published package resolve to real files.
 * Catches "Cannot find module" errors from missing files in the npm tarball.
 *
 * Usage:
 *   node scripts/check-extensions.mjs           # from source (uses npm pack --dry-run)
 *   node scripts/check-extensions.mjs <dir>     # from installed location
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const installDir = resolve(process.argv[2] ?? ".");
const fromSource = process.argv[2] == null;

function resolveNpmCli() {
	for (const p of [
		join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
		"/usr/lib/node_modules/npm/bin/npm-cli.js",
		"/usr/local/lib/node_modules/npm/bin/npm-cli.js",
		"/usr/share/nodejs/npm/bin/npm-cli.js",
	]) {
		if (existsSync(p)) return p;
	}
	throw new Error("Could not find npm-cli.js in known Node/npm locations");
}

function runNpmPackDryRun() {
	return execFileSync(
		process.execPath,
		[resolveNpmCli(), "pack", "--dry-run", "--json"],
		{ encoding: "utf8" },
	);
}

function parsePackFileList(out) {
	try {
		const packed = JSON.parse(out);
		return packed.flatMap((entry) =>
			(entry.files ?? []).map((file) => file.path).filter(Boolean),
		);
	} catch {
		return out
			.split("\n")
			.map((line) => line.match(/npm notice \S+\s+(.+)/)?.[1]?.trim())
			.filter(Boolean);
	}
}

function getFiles() {
	if (fromSource) {
		// Use npm pack --dry-run to inspect exactly what would be published.
		const out = runNpmPackDryRun();
		return parsePackFileList(out)
			.filter((f) => f && (f.endsWith(".ts") || f.endsWith(".mjs")))
			.map((f) => join(installDir, f));
	}
	// Installed location: walk all .ts/.mjs files
	const files = [];
	function walk(dir) {
		for (const entry of readdirSync(dir)) {
			const full = join(dir, entry);
			if (entry === "node_modules") continue;
			if (statSync(full).isDirectory()) walk(full);
			else if (entry.endsWith(".ts") || entry.endsWith(".mjs"))
				files.push(full);
		}
	}
	walk(installDir);
	return files;
}

function resolveImport(fromFile, importPath) {
	const base = join(dirname(fromFile), importPath);
	for (const candidate of [
		base,
		base.replace(/\.js$/, ".ts"), // .js → .ts (TypeScript ESM convention)
		base + ".ts",
		join(base, "index.ts"),
	]) {
		try {
			if (statSync(candidate).isFile()) return candidate;
		} catch {}
	}
	return null;
}

const files = getFiles();
console.log(`Checking ${files.length} file(s) in: ${installDir}\n`);

let totalImports = 0;
let failed = 0;
const seen = new Set();

for (const file of files) {
	const src = readFileSync(file, "utf8");
	const relFile = file.slice(installDir.length + 1).replaceAll("\\", "/");
	// Strip comments before matching imports
	const stripped = src
		.replaceAll(/\/\/[^\n]*/g, "")
		.replaceAll(/\/\*[\s\S]*?\*\//g, "");
	const importRe = /from\s+['"](\.[^'"]+)['"]/g;
	let match;
	while ((match = importRe.exec(stripped)) !== null) {
		const importPath = match[1];
		const key = `${relFile}:${importPath}`;
		if (seen.has(key)) continue;
		seen.add(key);
		totalImports++;
		if (!resolveImport(file, importPath)) {
			console.error(`  ✗ ${relFile}`);
			console.error(`      imports '${importPath}' → NOT FOUND`);
			failed++;
		}
	}
}

console.log(
	`Checked ${totalImports} relative import(s) across ${files.length} file(s).`,
);
console.log(
	failed === 0
		? `\nAll imports resolve OK ✓`
		: `\n${failed} import(s) could not be resolved ✗`,
);

process.exit(failed > 0 ? 1 : 0);
