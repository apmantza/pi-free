#!/usr/bin/env node
/**
 * Assert a production install (`npm install --omit=dev`, the `pi install
 * git:…` path) has the expected peer shape. #447.
 *
 * Two things must both be true after `npm ci --omit=dev`:
 *   1. The OPTIONAL host-provided peers (`@earendil-works/pi-coding-agent`,
 *      `@earendil-works/pi-tui`) are NOT vendored. Neither is ever a value
 *      import in pi-free's own source (see scripts/lib/host-provided-deps.mjs
 *      for the grep evidence), so a local copy is pure waste: ~140 extra
 *      packages (aws-sdk-bedrock-runtime, google-genai, openai, chalk, diff,
 *      glob, …) downloaded, extracted, and install-scripted for nothing the
 *      shipped extension ever loads.
 *   2. The REQUIRED peer (`@earendil-works/pi-ai`) IS vendored. It is a real,
 *      static value import across ~30 provider files; its absence breaks the
 *      extension at the point a provider is used, not at install time, so a
 *      silent regression here would not show up until a user hits it. This
 *      check catches it immediately instead.
 *
 * USAGE
 *   node scripts/check-prod-install-shape.mjs            # check ./node_modules
 *   node scripts/check-prod-install-shape.mjs <root>      # check <root>/node_modules
 */
import { existsSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
	OPTIONAL_HOST_PROVIDED_PACKAGES,
	REQUIRED_HOST_PROVIDED_PACKAGES,
} from "./lib/host-provided-deps.mjs";

const scriptRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);
const root = path.resolve(process.argv[2] ?? scriptRoot);
const modules = path.join(root, "node_modules");

function packagePath(name) {
	return path.join(modules, ...name.split("/"));
}

if (!existsSync(modules)) {
	console.error(
		`[install-shape] ${modules} not found — run npm install --omit=dev first.`,
	);
	process.exit(1);
}

const vendoredOptional = OPTIONAL_HOST_PROVIDED_PACKAGES.filter((name) =>
	existsSync(packagePath(name)),
);
const missingRequired = REQUIRED_HOST_PROVIDED_PACKAGES.filter(
	(name) => !existsSync(packagePath(name)),
);

let failed = false;

if (vendoredOptional.length > 0) {
	failed = true;
	console.error(
		"[install-shape] FAILED: an optional host-provided peer was vendored " +
			"by the production install, which pi supplies from its own runtime " +
			"and pi-free never value-imports (#447):",
	);
	for (const name of vendoredOptional) console.error(`  - ${name}`);
	console.error(
		"Check peerDependenciesMeta.optional and package-lock.json — this " +
			"regression usually means the lockfile was regenerated without npm " +
			"honoring the optional flag, or a new source file started " +
			"value-importing one of these packages.",
	);
}

if (missingRequired.length > 0) {
	failed = true;
	console.error(
		"[install-shape] FAILED: a REQUIRED host-provided peer is missing from " +
			"the production install. pi-free value-imports it directly at the " +
			"top level of multiple provider files; its absence breaks those " +
			"providers at first use, not at install time:",
	);
	for (const name of missingRequired) console.error(`  - ${name}`);
}

if (failed) process.exit(1);

console.log(
	`[install-shape] OK: ${OPTIONAL_HOST_PROVIDED_PACKAGES.join(", ")} not vendored; ` +
		`${REQUIRED_HOST_PROVIDED_PACKAGES.join(", ")} present, as expected.`,
);
