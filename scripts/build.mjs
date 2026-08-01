#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tsc = join(root, "node_modules", "typescript", "bin", "tsc");

execFileSync(process.execPath, [join(root, "scripts", "clean.mjs")], {
	cwd: root,
	stdio: "inherit",
});
execFileSync(process.execPath, [tsc, "-p", join(root, "tsconfig.build.json")], {
	cwd: root,
	stdio: "inherit",
});

const assetDir = join(root, "dist", "provider-failover");
mkdirSync(assetDir, { recursive: true });
copyFileSync(
	join(root, "provider-failover", "benchmarks.json"),
	join(assetDir, "benchmarks.json"),
);
console.log("Built dist/ and copied provider-failover/benchmarks.json");
