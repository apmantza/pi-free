#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const localTsc = join(root, "node_modules", "typescript", "bin", "tsc");
const buildConfig = join(root, "tsconfig.build.json");

execFileSync(process.execPath, [join(root, "scripts", "clean.mjs")], {
	cwd: root,
	stdio: "inherit",
});
// Git-based Pi installs run `npm install --omit=dev`, so the local compiler is
// intentionally absent during `prepare`. Match pi-lens's production-install
// strategy: use the pinned local compiler when available, otherwise fetch the
// exact compiler transiently with npx instead of asking users to repair the
// checkout manually.
if (existsSync(localTsc)) {
	execFileSync(process.execPath, [localTsc, "-p", buildConfig], {
		cwd: root,
		stdio: "inherit",
	});
} else {
	const npxArgs = [
		"--yes",
		"-p",
		"typescript@7.0.2",
		"tsc",
		"-p",
		buildConfig,
	];
	const npxCandidates = [
		process.env.npm_execpath
			? join(dirname(process.env.npm_execpath), "npx-cli.js")
			: undefined,
		join(dirname(process.execPath), "node_modules", "npm", "bin", "npx-cli.js"),
	].filter((candidate) => candidate && existsSync(candidate));
	if (npxCandidates[0]) {
		execFileSync(process.execPath, [npxCandidates[0], ...npxArgs], {
			cwd: root,
			stdio: "inherit",
		});
	} else {
		const npx = process.platform === "win32" ? "npx.cmd" : "npx";
		execFileSync(npx, npxArgs, {
			cwd: root,
			stdio: "inherit",
			shell: process.platform === "win32",
		});
	}
}

const assetDir = join(root, "dist", "provider-failover");
mkdirSync(assetDir, { recursive: true });
copyFileSync(
	join(root, "provider-failover", "benchmarks.json"),
	join(assetDir, "benchmarks.json"),
);
console.log("Built dist/ and copied provider-failover/benchmarks.json");
