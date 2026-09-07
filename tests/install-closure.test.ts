/**
 * Regression tests for scripts/check-installed-closure.mjs (#510).
 *
 * The script itself is the assertion engine (exit 0/1 + stderr); these tests
 * drive it against fixture trees via spawnSync — no symlinks, no network, no
 * platform branches, so they run identically on every CI matrix OS:
 *
 *   - healthy repo tree      → exit 0 (real pi-ai + real transitive deps)
 *   - #510 shape             → exit 1 naming `typebox` (pi-ai present, dep
 *                              missing — the layout every load-only smoke
 *                              check passes while first real use crashes)
 *   - pi-ai absent entirely  → exit 1 naming pi-ai
 *   - no compiled entry      → exit 1 (misuse, e.g. unbuilt source checkout)
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = join(process.cwd(), "scripts", "check-installed-closure.mjs");

function runClosure(dir: string) {
	return spawnSync(process.execPath, [SCRIPT, dir], { encoding: "utf8" });
}

function makeTree(layout: {
	piAi?: { version: string; dependencies: Record<string, string> };
	entry?: boolean;
}): string {
	const base = mkdtempSync(join(tmpdir(), "pi-free-closure-"));
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
	// Fixture root is <tmp>/pi-free-closure-*/app — remove the whole sandbox.
	tempDirs.push(join(app, ".."));
	return app;
}

describe("check-installed-closure (#510)", () => {
	it("passes on the healthy repo tree", () => {
		const result = runClosure(process.cwd());
		expect(result.status).toBe(0);
		expect(result.stdout).toMatch(/\[install-closure\] PASS/);
	});

	it("fails naming typebox for the #510 shape (pi-ai without its dep)", () => {
		const app = track(
			makeTree({
				piAi: { version: "0.84.4", dependencies: { typebox: "1.3.7" } },
			}),
		);
		const result = runClosure(app);
		expect(result.status).toBe(1);
		expect(result.stderr).toMatch(/typebox/);
	});

	it("fails naming pi-ai when pi-ai is absent", () => {
		const app = track(makeTree({}));
		const result = runClosure(app);
		expect(result.status).toBe(1);
		expect(result.stderr).toMatch(/@earendil-works\/pi-ai/);
	});

	it("fails without a compiled entry", () => {
		const app = track(
			makeTree({
				entry: false,
				piAi: { version: "0.84.4", dependencies: {} },
			}),
		);
		const result = runClosure(app);
		expect(result.status).toBe(1);
		expect(result.stderr).toMatch(/compiled entry not found/);
	});
});
