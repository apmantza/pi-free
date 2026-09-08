/**
 * Regression tests for scripts/check-hoisting.mjs.
 *
 * The script itself is the assertion engine (exit 0/1 + stdout); these
 * tests drive it via spawnSync — no symlinks, no network, no platform
 * branches, so they run identically on every CI matrix OS:
 *
 *   - healthy repo tree   → exit 0 (pi-ai's deps resolve hoisted)
 *   - nested dep on pi-ai's walk-up → exit 1 naming the nested path
 *   - pi-ai absent entirely         → exit 1 naming pi-ai
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = join(process.cwd(), "scripts", "check-hoisting.mjs");

function runHoisting(dir: string) {
	return spawnSync(process.execPath, [SCRIPT, dir], { encoding: "utf8" });
}

function makeTree(layout: {
	piAi?: { version: string; dependencies: Record<string, string> };
	nested?: string[];
	entry?: boolean;
}): string {
	const base = mkdtempSync(join(tmpdir(), "pi-free-hoisting-"));
	const app = join(base, "app");
	if (layout.entry === false) {
		mkdirSync(app, { recursive: true });
	} else {
		mkdirSync(join(app, "dist"), { recursive: true });
		writeFileSync(join(app, "dist", "index.js"), "export {};\n");
	}
	if (layout.piAi) {
		const piAiDir = join(app, "node_modules", "@earendil-works", "pi-ai");
		mkdirSync(join(piAiDir, "dist"), { recursive: true });
		writeFileSync(
			join(piAiDir, "package.json"),
			JSON.stringify({
				name: "@earendil-works/pi-ai",
				version: layout.piAi.version,
				dependencies: layout.piAi.dependencies,
			}),
		);
		writeFileSync(join(piAiDir, "dist", "index.js"), "export {};\n");
		for (const name of layout.nested ?? []) {
			const nestedDir = join(piAiDir, "node_modules", ...name.split("/"));
			mkdirSync(nestedDir, { recursive: true });
			writeFileSync(
				join(nestedDir, "package.json"),
				JSON.stringify({ name, version: "1.0.0", main: "index.js" }),
			);
			writeFileSync(join(nestedDir, "index.js"), "module.exports = {};\n");
		}
	}
	return app;
}

const tempDirs: string[] = [];
afterEach(() => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
});
function track(app: string): string {
	tempDirs.push(join(app, ".."));
	return app;
}

describe("check-hoisting", () => {
	it("passes on the healthy repo tree", () => {
		const result = runHoisting(process.cwd());
		expect(result.status).toBe(0);
		expect(result.stdout).toMatch(/\[hoisting\] PASS/);
	});

	it("fails naming the nested copy", () => {
		const app = track(
			makeTree({
				piAi: { version: "0.84.4", dependencies: { typebox: "1.3.7" } },
				nested: ["typebox"],
			}),
		);
		const result = runHoisting(app);
		expect(result.status).toBe(1);
		expect(result.stderr).toMatch(/typebox resolves from nested/);
	});

	it("fails when pi-ai is absent", () => {
		const app = track(makeTree({}));
		const result = runHoisting(app);
		expect(result.status).toBe(1);
		expect(result.stderr).toMatch(/@earendil-works\/pi-ai/);
	});
});
