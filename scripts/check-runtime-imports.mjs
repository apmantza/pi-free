#!/usr/bin/env node
/**
 * Verify that published runtime code only imports pi-ai entry points exposed
 * through Pi's extension loader.
 *
 * Pi bundles/aliases a deliberately small set of pi-ai entry points for
 * extensions. Node can resolve other package exports (for example
 * `@earendil-works/pi-ai/api/openai-completions.lazy`), so a normal import or
 * TypeScript check does not catch this boundary.
 *
 * Usage:
 *   node scripts/check-runtime-imports.mjs             # ./dist
 *   node scripts/check-runtime-imports.mjs <package>  # package/dist
 */

import {
	existsSync,
	readdirSync,
	readFileSync,
	realpathSync,
	statSync,
} from "node:fs";
import { join, resolve } from "node:path";

function resolveDirectory(input) {
	const candidate = resolve(input);
	let directory;
	try {
		directory = realpathSync(candidate);
	} catch {
		throw new Error(`Runtime directory cannot be resolved: ${candidate}`);
	}
	if (!statSync(directory).isDirectory()) {
		throw new Error(`Runtime path is not a directory: ${directory}`);
	}
	return directory;
}

let packageDir;
try {
	packageDir = resolveDirectory(process.argv[2] ?? ".");
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
}
const distCandidate = join(packageDir, "dist");
const runtimeDir = resolveDirectory(
	existsSync(distCandidate) ? distCandidate : packageDir,
);
const allowedPiAiImports = new Set([
	"@earendil-works/pi-ai",
	"@earendil-works/pi-ai/compat",
	"@earendil-works/pi-ai/oauth",
	"@earendil-works/pi-ai/providers/all",
]);

function collectRuntimeFiles(dir) {
	const files = [];
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) {
			files.push(...collectRuntimeFiles(path));
		} else if (/\.(?:cjs|js|mjs)$/.test(entry)) {
			files.push(path);
		}
	}
	return files;
}

const files = collectRuntimeFiles(runtimeDir);
const violations = [];

// Published TypeScript output uses static ESM imports. Match both `from` and
// side-effect imports, while intentionally ignoring dynamic/template imports.
const importRe = /(?:\bfrom\s*|\bimport\s*)(["'])(@earendil-works\/pi-ai(?:\/[^"']+)?)\1/g;

for (const file of files) {
	// Generated output retains documentation comments; keep examples in those
	// comments from being mistaken for executable imports.
	const source = readFileSync(file, "utf8")
		.replaceAll(/\/\/[^\n]*/g, "")
		.replaceAll(/\/\*[\s\S]*?\*\//g, "");
	let match;
	while ((match = importRe.exec(source)) !== null) {
		const specifier = match[2];
		if (!allowedPiAiImports.has(specifier)) {
			violations.push({
				file: file.slice(runtimeDir.length + 1).replaceAll("\\", "/"),
				specifier,
			});
		}
	}
}

console.log(`Checked ${files.length} published runtime file(s) for Pi loader imports.`);
if (violations.length > 0) {
	console.error("Disallowed @earendil-works/pi-ai imports found:");
	for (const violation of violations) {
		console.error(`  ${violation.file}: ${violation.specifier}`);
	}
	console.error(
		"Use @earendil-works/pi-ai, /compat, /oauth, or /providers/all in runtime code.",
	);
	process.exit(1);
}

console.log("Pi extension-loader import policy OK");
