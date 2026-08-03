#!/usr/bin/env node
/**
 * Load the compiled extension through Pi's real extension loader.
 *
 * A plain `node import` only exercises Node's package exports. Pi's loader
 * aliases a smaller set of packages for extensions, so this catches imports
 * that work in Node but fail at the extension boundary.
 *
 * Usage:
 *   node scripts/smoke-pi-loader.mjs                 # ./dist/index.js
 *   node scripts/smoke-pi-loader.mjs <entry.js>
 */

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const entry = resolve(process.argv[2] ?? "dist/index.js");
if (!existsSync(entry)) {
	console.error(`Extension entry not found: ${entry}`);
	process.exit(1);
}

const savedEnvironment = new Map();
function setTestEnvironment(name, value) {
	savedEnvironment.set(name, process.env[name]);
	process.env[name] = value;
}

// Keep the loader smoke isolated from a developer's Pi configuration and
// prevent the extension's buffered logger from leaving work after cleanup.
const testHome = mkdtempSync(join(tmpdir(), "pi-free-loader-"));
setTestEnvironment("HOME", testHome);
setTestEnvironment("PI_FREE_FILE_LOG", "false");

try {
	const piAgentEntry = fileURLToPath(
		import.meta.resolve("@earendil-works/pi-coding-agent"),
	);
	const loaderPath = join(
		dirname(piAgentEntry),
		"core",
		"extensions",
		"loader.js",
	);
	if (!existsSync(loaderPath)) {
		throw new Error(`Pi extension loader not found: ${loaderPath}`);
	}

	const { loadExtensions } = await import(pathToFileURL(loaderPath).href);
	if (typeof loadExtensions !== "function") {
		throw new Error("Installed Pi package does not expose loadExtensions");
	}

	const result = await loadExtensions([entry], process.cwd());
	if (result.errors.length > 0) {
		for (const error of result.errors) {
			console.error(`${error.path}: ${error.error}`);
		}
		process.exitCode = 1;
	} else if (result.extensions.length !== 1) {
		throw new Error(
			`Expected one loaded extension, received ${result.extensions.length}`,
		);
	} else {
		console.log(`Pi extension loader smoke passed: ${entry}`);
	}
} finally {
	rmSync(testHome, { recursive: true, force: true });
	for (const [name, value] of savedEnvironment) {
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
}
