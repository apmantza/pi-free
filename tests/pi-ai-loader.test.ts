import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	findPackageInNodeModules,
	isPiAiNotFoundError,
	resolvePiAiEntryFile,
	resolvePiAiPackageRoot,
} from "../lib/pi-ai-loader.ts";

function makePackage(root: string, packageJson: object = { name: "pkg" }) {
	mkdirSync(root, { recursive: true });
	writeFileSync(join(root, "package.json"), JSON.stringify(packageJson));
}

/** Mirrors the real pi-ai exports shape (wildcard target as conditions object). */
const PI_AI_EXPORTS = {
	name: "@earendil-works/pi-ai",
	version: "0.84.2",
	exports: {
		".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
		"./compat": {
			types: "./dist/compat.d.ts",
			import: "./dist/compat.js",
		},
		"./providers/*": {
			types: "./dist/providers/*.d.ts",
			import: "./dist/providers/*.js",
		},
	},
};

describe("findPackageInNodeModules", () => {
	it("finds a package by walking up from a nested start dir", () => {
		const base = mkdtempSync(join(tmpdir(), "pi-free-loader-"));
		const pkg = join(base, "node_modules", "@earendil-works", "pi-ai");
		makePackage(pkg);
		const start = join(base, "node_modules", "pi-free", "dist", "lib");
		mkdirSync(start, { recursive: true });
		expect(findPackageInNodeModules(start, ["@earendil-works", "pi-ai"])).toBe(
			pkg,
		);
	});

	it("returns undefined when the package is nowhere above", () => {
		const base = mkdtempSync(join(tmpdir(), "pi-free-loader-"));
		expect(
			findPackageInNodeModules(base, ["@earendil-works", "pi-ai"]),
		).toBeUndefined();
	});
});

describe("resolvePiAiPackageRoot", () => {
	it("finds pi-ai relative to the running pi host entry script", () => {
		// Hosted layout where pi-free's extension tree shares nothing with the
		// host install (issue #448): pi-free in one tree, pi + pi-ai in another.
		const base = mkdtempSync(join(tmpdir(), "pi-free-loader-"));
		const extensionTree = join(base, "agent-npm", "node_modules", "pi-free");
		makePackage(join(extensionTree));
		const hostPiAi = join(
			base,
			"pnpm-global",
			"node_modules",
			"@earendil-works",
			"pi-ai",
		);
		makePackage(hostPiAi, PI_AI_EXPORTS);
		const cli = join(base, "pnpm-global", "node_modules", "pi", "dist", "cli.js");
		mkdirSync(dirname(cli), { recursive: true });

		expect(resolvePiAiPackageRoot(extensionTree, { argv1: cli })).toBe(hostPiAi);
	});

	it("finds pi-ai through a pnpm virtual-store layout via the host entry", () => {
		// pnpm layout: pi-ai is not in any top-level node_modules; it lives as a
		// sibling of the real (symlink-target) agent package inside .pnpm.
		const base = mkdtempSync(join(tmpdir(), "pi-free-loader-"));
		const extensionTree = join(base, "agent-npm", "node_modules", "pi-free");
		makePackage(extensionTree);
		const virtualAgent = join(
			base,
			"pnpm-global",
			"node_modules",
			".pnpm",
			"@earendil-works+pi-coding-agent@0.84.2",
			"node_modules",
			"@earendil-works",
			"pi-coding-agent",
		);
		makePackage(virtualAgent);
		const virtualPiAi = join(
			dirname(dirname(virtualAgent)),
			"@earendil-works",
			"pi-ai",
		);
		makePackage(virtualPiAi, PI_AI_EXPORTS);
		// Entry script inside the real agent package (what a resolved bin shim
		// points at).
		const cli = join(virtualAgent, "dist", "cli.js");
		mkdirSync(dirname(cli), { recursive: true });

		expect(resolvePiAiPackageRoot(extensionTree, { argv1: cli })).toBe(
			virtualPiAi,
		);
	});

	it("finds pi-ai above a symlinked bin shim via realpath", () => {
		const base = mkdtempSync(join(tmpdir(), "pi-free-loader-"));
		const extensionTree = join(base, "agent-npm", "node_modules", "pi-free");
		makePackage(extensionTree);
		const hostPiAi = join(
			base,
			"global",
			"node_modules",
			"@earendil-works",
			"pi-ai",
		);
		makePackage(hostPiAi, PI_AI_EXPORTS);
		const cli = join(base, "global", "node_modules", "pi", "dist", "cli.js");
		mkdirSync(dirname(cli), { recursive: true });
		writeFileSync(cli, "#!/usr/bin/env node\n");
		const shim = join(base, "bin-dir", "pi");
		try {
			mkdirSync(dirname(shim), { recursive: true });
			symlinkSync(cli, shim, "file");
		} catch {
			// Symlinks may be unavailable (Windows without privileges) — the
			// realpath behavior is still covered indirectly by the other tests.
			return;
		}

		expect(resolvePiAiPackageRoot(extensionTree, { argv1: shim })).toBe(hostPiAi);
	});

	it("rejects a relative argv1 even when the CWD tree contains pi-ai", () => {
		// Compiled-binary hosts can expose the first USER argument as argv[1].
		// Walking up from a CWD-relative path must never let an unrelated
		// project's node_modules satisfy the lookup.
		const proj = mkdtempSync(join(tmpdir(), "pi-free-loader-"));
		makePackage(join(proj, "node_modules", "@earendil-works", "pi-ai"), {
			...PI_AI_EXPORTS,
			version: "0.1.0",
		});
		// The extension tree lives OUTSIDE the project, like ~/.pi/agent/npm.
		const extensionTree = mkdtempSync(join(tmpdir(), "pi-free-loader-ext-"));
		const cwd = join(proj, "src");
		mkdirSync(cwd, { recursive: true });
		// A separate empty system tree so the executable-relative probe cannot
		// walk into either tree.
		const sysTree = mkdtempSync(join(tmpdir(), "pi-free-loader-sys-"));
		const originalCwd = process.cwd();
		process.chdir(cwd);
		try {
			expect(
				resolvePiAiPackageRoot(extensionTree, {
					argv1: "foo.ts",
					homeDir: proj,
					appData: join(proj, "no-appdata"),
					execPath: join(sysTree, "bin", "node.exe"),
				}),
			).toBeUndefined();
		} finally {
			process.chdir(originalCwd);
		}
	});

	it("rejects host-entry hits whose package is not a usable pi-ai", () => {
		const base = mkdtempSync(join(tmpdir(), "pi-free-loader-"));
		const extensionTree = join(base, "agent-npm", "node_modules", "pi-free");
		makePackage(extensionTree);
		const cli = join(base, "host", "dist", "cli.js");
		mkdirSync(dirname(cli), { recursive: true });
		// Pin every environment probe so only the host-entry strategy can find
		// anything, regardless of what is installed on this machine.
		const isolated = {
			homeDir: base,
			appData: join(base, "no-appdata"),
			execPath: join(base, "sys", "bin", "node.exe"),
		} as const;

		// Wrong package name in a correctly-named directory.
		const wrongName = join(base, "host", "node_modules", "@earendil-works", "pi-ai");
		makePackage(wrongName, { ...PI_AI_EXPORTS, name: "some-other-package" });
		expect(
			resolvePiAiPackageRoot(extensionTree, { argv1: cli, ...isolated }),
		).toBeUndefined();

		// Version below the peer-dependency minimum.
		makePackage(wrongName, { ...PI_AI_EXPORTS, version: "0.80.9" });
		expect(
			resolvePiAiPackageRoot(extensionTree, { argv1: cli, ...isolated }),
		).toBeUndefined();

		// A usable version passes.
		makePackage(wrongName, { ...PI_AI_EXPORTS, version: "0.81.0" });
		expect(
			resolvePiAiPackageRoot(extensionTree, { argv1: cli, ...isolated }),
		).toBe(wrongName);
	});

	it("ignores a missing or unusable argv1 and keeps searching other roots", () => {
		const base = mkdtempSync(join(tmpdir(), "pi-free-loader-"));
		// Pin every environment probe to empty fixture locations so the result
		// does not depend on what is installed on the test machine.
		const isolated = {
			argv1: null,
			homeDir: base,
			appData: join(base, "no-appdata"),
			execPath: join(base, "bin", "node.exe"),
		} as const;
		expect(resolvePiAiPackageRoot(base, isolated)).toBeUndefined();
		expect(
			resolvePiAiPackageRoot(base, {
				...isolated,
				argv1: join(base, "does-not-exist"),
			}),
		).toBeUndefined();
	});

	it("finds pi-ai nested under pi-coding-agent's own node_modules", () => {
		const base = mkdtempSync(join(tmpdir(), "pi-free-loader-"));
		const nested = join(
			base,
			"node_modules",
			"@earendil-works",
			"pi-coding-agent",
			"node_modules",
			"@earendil-works",
			"pi-ai",
		);
		makePackage(nested, PI_AI_EXPORTS);
		makePackage(join(base, "node_modules", "@earendil-works", "pi-coding-agent"));
		const start = join(base, "node_modules", "pi-free", "lib");
		mkdirSync(start, { recursive: true });
		expect(
			resolvePiAiPackageRoot(start, {
				argv1: null,
				homeDir: base,
				appData: join(base, "no-appdata"),
				execPath: join(base, "bin", "node.exe"),
			}),
		).toBe(nested);
	});

	it("prefers a hoisted pi-ai over a nested one", () => {
		const base = mkdtempSync(join(tmpdir(), "pi-free-loader-"));
		const hoisted = join(base, "node_modules", "@earendil-works", "pi-ai");
		makePackage(hoisted, PI_AI_EXPORTS);
		const start = join(base, "node_modules", "pi-free", "lib");
		mkdirSync(start, { recursive: true });
		expect(
			resolvePiAiPackageRoot(start, {
				argv1: null,
				homeDir: base,
				appData: join(base, "no-appdata"),
				execPath: join(base, "bin", "node.exe"),
			}),
		).toBe(hoisted);
	});
});

describe("resolvePiAiEntryFile", () => {
	it("resolves a direct exports key with a conditions object", () => {
		const base = mkdtempSync(join(tmpdir(), "pi-free-loader-"));
		const root = join(base, "pi-ai");
		makePackage(root, PI_AI_EXPORTS);
		const compatFile = join(root, "dist", "compat.js");
		mkdirSync(join(root, "dist"), { recursive: true });
		writeFileSync(compatFile, "export {};");
		expect(resolvePiAiEntryFile(root, "compat")).toBe(compatFile);
	});

	it("substitutes wildcards inside conditions objects", () => {
		const base = mkdtempSync(join(tmpdir(), "pi-free-loader-"));
		const root = join(base, "pi-ai");
		makePackage(root, PI_AI_EXPORTS);
		const allFile = join(root, "dist", "providers", "all.js");
		mkdirSync(join(root, "dist", "providers"), { recursive: true });
		writeFileSync(allFile, "export {};");
		const resolved = resolvePiAiEntryFile(root, "providers/all");
		expect(resolved).toBe(allFile);
		expect(resolved).not.toContain("*");
	});

	it("falls back to the known dist layout when exports is unreadable", () => {
		const base = mkdtempSync(join(tmpdir(), "pi-free-loader-"));
		const root = join(base, "pi-ai");
		makePackage(root);
		writeFileSync(join(root, "package.json"), "not json");
		const compatFile = join(root, "dist", "compat.js");
		mkdirSync(join(root, "dist"), { recursive: true });
		writeFileSync(compatFile, "export {};");
		expect(resolvePiAiEntryFile(root, "compat")).toBe(compatFile);
	});

	it("returns undefined when the resolved file does not exist on disk", () => {
		const base = mkdtempSync(join(tmpdir(), "pi-free-loader-"));
		const root = join(base, "pi-ai");
		makePackage(root, PI_AI_EXPORTS);
		expect(resolvePiAiEntryFile(root, "compat")).toBeUndefined();
		expect(resolvePiAiEntryFile(root, "providers/all")).toBeUndefined();
	});
});

describe("isPiAiNotFoundError", () => {
	function moduleNotFound(message: string) {
		const error = new Error(message) as NodeJS.ErrnoException;
		error.code = "ERR_MODULE_NOT_FOUND";
		return error;
	}

	it("matches pi-ai's own resolution failure", () => {
		expect(
			isPiAiNotFoundError(
				moduleNotFound(
					"Cannot find package '@earendil-works/pi-ai' imported from /x/lazy-compat.js",
				),
			),
		).toBe(true);
	});

	it("rejects a missing transitive dependency of pi-ai", () => {
		expect(
			isPiAiNotFoundError(
				moduleNotFound(
					"Cannot find package 'some-dep' imported from /x/node_modules/@earendil-works/pi-ai/dist/compat.js",
				),
			),
		).toBe(false);
	});

	it("rejects non-resolution errors", () => {
		expect(isPiAiNotFoundError(new SyntaxError("Unexpected token"))).toBe(false);
		expect(isPiAiNotFoundError(undefined)).toBe(false);
	});
});
