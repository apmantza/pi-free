/**
 * Pins the peer-dependency declaration shape a production
 * (`npm install --omit=dev`) install relies on. #447.
 *
 * pi-free declares three peers: `@earendil-works/pi-ai`,
 * `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`. Only pi-ai is
 * a real value import anywhere in pi-free's own source — the other two are
 * either type-only (`pi-coding-agent`) or entirely unreferenced (`pi-tui`).
 * Without `peerDependenciesMeta.optional`, npm auto-installs ALL THREE for
 * every `npm install --omit=dev` (the `pi install git:...` path), vendoring
 * ~140 packages (aws-sdk-bedrock-runtime, google-genai, openai, chalk, diff,
 * glob, …) that the shipped extension never loads. See
 * scripts/lib/host-provided-deps.mjs for the full rationale and the grep
 * evidence behind the pi-ai/pi-coding-agent split.
 *
 * This test pins the DECLARATION; scripts/check-prod-install-shape.mjs pins
 * the INSTALLED RESULT in CI, which is what a real install actually leaves on
 * disk.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	OPTIONAL_HOST_PROVIDED_PACKAGES,
	REQUIRED_HOST_PROVIDED_PACKAGES,
} from "../scripts/lib/host-provided-deps.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
	peerDependencies?: Record<string, string>;
	peerDependenciesMeta?: Record<string, { optional?: boolean }>;
	devDependencies?: Record<string, string>;
};

describe("peer-dependency shape guards production vendoring (#447)", () => {
	const peers = pkg.peerDependencies ?? {};
	const peerMeta = pkg.peerDependenciesMeta ?? {};
	const devDeps = pkg.devDependencies ?? {};

	it("lists at least one optional and one required host-provided peer to guard", () => {
		// Guards the guard: emptying either list would make the per-package
		// assertions below vacuously pass.
		expect(OPTIONAL_HOST_PROVIDED_PACKAGES.length).toBeGreaterThan(0);
		expect(REQUIRED_HOST_PROVIDED_PACKAGES.length).toBeGreaterThan(0);
	});

	for (const name of OPTIONAL_HOST_PROVIDED_PACKAGES) {
		it(`${name} is declared as a peerDependency`, () => {
			expect(Object.hasOwn(peers, name), `${name} missing from peerDependencies`).toBe(
				true,
			);
		});

		it(`${name} is marked peerDependenciesMeta.optional`, () => {
			// Without this, npm 7+ auto-installs the peer under `--omit=dev`
			// regardless of whether anything actually uses it (#447).
			expect(
				peerMeta[name]?.optional,
				`${name} must be peerDependenciesMeta.optional so a production ` +
					"install does not vendor it",
			).toBe(true);
		});
	}

	for (const name of REQUIRED_HOST_PROVIDED_PACKAGES) {
		it(`${name} stays a REQUIRED (non-optional) peer`, () => {
			expect(Object.hasOwn(peers, name), `${name} missing from peerDependencies`).toBe(
				true,
			);
			// pi-free value-imports this at the top level of ~30 provider files;
			// marking it optional was tried during the #447 investigation and
			// immediately broke `vitest run` (4 files: "Cannot find package
			// '@earendil-works/pi-ai'"). It must never gain an optional:true entry.
			expect(
				peerMeta[name]?.optional,
				`${name} must NOT be optional — it is a real runtime value import`,
			).not.toBe(true);
		});
	}

	it("pins @earendil-works/pi-coding-agent as a devDependency for full installs", () => {
		// tsc --noEmit (the "Lint & type-check" job, and local development) needs
		// pi-coding-agent's real types to check the ~30 files that
		// `import type` from it. Without this devDependency, a full `npm ci`
		// (no --omit=dev) would ALSO stop installing it once it is an optional
		// peer, breaking that type-check — verified directly: removing it caused
		// `npm run lint` to fail with 30+ TS2307 "Cannot find module" errors.
		expect(
			Object.hasOwn(devDeps, "@earendil-works/pi-coding-agent"),
			"@earendil-works/pi-coding-agent must be a devDependency",
		).toBe(true);
	});

	it("does not add @earendil-works/pi-tui as a devDependency", () => {
		// Nothing in pi-free's source imports pi-tui, not even as a type — grep
		// confirms zero references outside package.json/docs. Adding a
		// devDependency for it would be dead weight; if this ever needs to
		// change, a real import should justify it.
		expect(Object.hasOwn(devDeps, "@earendil-works/pi-tui")).toBe(false);
	});
});
