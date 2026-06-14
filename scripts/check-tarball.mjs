#!/usr/bin/env node
/**
 * Verify the npm tarball contains the files pi needs and excludes common
 * accidental/secrets/debug artifacts.
 */
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function fail(message) {
	console.error(`ERROR: ${message}`);
	process.exit(1);
}

function resolveTar() {
	for (const p of [
		process.platform === "win32" ? String.raw`C:\Windows\System32\tar.exe` : "",
		"/usr/bin/tar",
		"/bin/tar",
		"/usr/local/bin/tar",
	]) {
		if (p && existsSync(p)) return p;
	}
	throw new Error("Could not find tar in known system locations");
}

function findTarball() {
	const explicit = process.argv[2];
	if (explicit) return explicit;
	const files = readdirSync(".").filter((entry) =>
		/^pi-free-.+\.tgz$/.test(entry),
	);
	if (files.length !== 1) {
		fail(`expected exactly one pi-free-*.tgz tarball, found ${files.length}`);
	}
	return files[0];
}

function assertSafeTarEntries(entries) {
	for (const entry of entries) {
		if (
			entry.startsWith("/") ||
			entry.includes("../") ||
			entry.includes("..\\") ||
			!entry.startsWith("package/")
		) {
			fail(`unsafe tarball entry path: ${entry}`);
		}
	}
}

function listTarball(tarball) {
	return execFileSync(resolveTar(), ["-tzf", tarball], { encoding: "utf8" })
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
}

function extractTarball(tarball) {
	const dir = mkdtempSync(join(tmpdir(), "pi-free-tarball-"));
	execFileSync(resolveTar(), ["-xzf", tarball, "-C", dir]);
	return dir;
}

const tarball = findTarball();
if (!existsSync(tarball)) fail(`tarball not found: ${tarball}`);

console.log(`Checking tarball: ${tarball}`);
const entries = listTarball(tarball);
assertSafeTarEntries(entries);
const entrySet = new Set(entries);

const required = [
	"package/package.json",
	"package/index.ts",
	"package/config.ts",
	"package/constants.ts",
	"package/provider-helper.ts",
	"package/README.md",
	"package/CHANGELOG.md",
	"package/LICENSE",
	"package/scripts/check-extensions.mjs",
];

for (const file of required) {
	if (!entrySet.has(file)) fail(`required file missing from tarball: ${file}`);
	console.log(`OK: ${file}`);
}

const forbiddenPatterns = [
	/^package\/(?:node_modules|tests|\.github|\.pi|\.claude|\.pisessionsummaries)\//,
	/^package\/dist\//,
	/^package\/.+\.log$/,
	/^package\/.+\.tsbuildinfo$/,
	/^package\/.+\.tgz$/,
	/^package\/.+\.env(?:\..*)?$/,
	/^package\/(?:\.env(?:\..*)?|npm-debug\.log|yarn-error\.log)$/,
	/^package\/scripts\/(?!check-extensions\.mjs$).+/,
];

const forbidden = entries.filter((entry) =>
	forbiddenPatterns.some((pattern) => pattern.test(entry)),
);
if (forbidden.length > 0) {
	console.error("Forbidden files found in tarball:");
	for (const entry of forbidden) console.error(`  • ${entry}`);
	process.exit(1);
}
console.log("No forbidden tarball artifacts found ✓");

const extractDir = extractTarball(tarball);
try {
	const packageDir = join(extractDir, "package");
	const pkg = JSON.parse(
		readFileSync(join(packageDir, "package.json"), "utf8"),
	);
	const extensions = pkg.pi?.extensions ?? [];
	if (!Array.isArray(extensions) || extensions.length === 0) {
		fail("package.json has no pi.extensions entries");
	}
	for (const extension of extensions) {
		const normalized = String(extension).replace(/^\.\//, "");
		if (!entrySet.has(`package/${normalized}`)) {
			fail(`pi.extensions entry missing from tarball: ${extension}`);
		}
		console.log(`OK: pi.extensions -> ${extension}`);
	}
	if (pkg.main) {
		const normalized = String(pkg.main).replace(/^\.\//, "");
		if (!entrySet.has(`package/${normalized}`)) {
			fail(`package.json main points to missing file: ${pkg.main}`);
		}
		console.log(`OK: main -> ${pkg.main}`);
	}
} finally {
	rmSync(extractDir, { recursive: true, force: true });
}

console.log("Tarball verification OK ✓");
