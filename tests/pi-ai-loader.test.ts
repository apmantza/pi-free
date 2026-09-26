import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	findPackageInNodeModules,
	isPiAiNotFoundError,
	piAiRootDefinesEntry,
	resolvePiAiEntryFile,
	resolvePiAiPackageRoot,
	resolveVendoredPiAiEntryFile,
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
		const cli = join(
			base,
			"pnpm-global",
			"node_modules",
			"pi",
			"dist",
			"cli.js",
		);
		mkdirSync(dirname(cli), { recursive: true });

		expect(resolvePiAiPackageRoot(extensionTree, { argv1: cli })).toBe(
			hostPiAi,
		);
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

		expect(resolvePiAiPackageRoot(extensionTree, { argv1: shim })).toBe(
			hostPiAi,
		);
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
		const wrongName = join(
			base,
			"host",
			"node_modules",
			"@earendil-works",
			"pi-ai",
		);
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
		makePackage(
			join(base, "node_modules", "@earendil-works", "pi-coding-agent"),
		);
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

	it("selects a different root per entry when each copy serves only one (#581)", () => {
		// The invariant the loader's per-entry root cache preserves: a copy that
		// knows `compat` but predates `providers/all` must not pin the root for
		// the other entry — each entry keeps probing until it finds a copy that
		// defines it.
		const base = mkdtempSync(join(tmpdir(), "pi-free-loader-"));
		const compatOnly = join(base, "node_modules", "@earendil-works", "pi-ai");
		makePackage(compatOnly, {
			name: "@earendil-works/pi-ai",
			version: "0.84.2",
			exports: { ".": "./dist/index.js", "./compat": "./dist/compat.js" },
		});
		const providersOnly = join(
			base,
			"host",
			"node_modules",
			"@earendil-works",
			"pi-ai",
		);
		makePackage(providersOnly, {
			name: "@earendil-works/pi-ai",
			version: "0.87.1",
			exports: {
				".": "./dist/index.js",
				"./providers/*": "./dist/providers/*.js",
			},
		});
		const start = join(base, "node_modules", "pi-free", "dist", "lib");
		mkdirSync(start, { recursive: true });
		const cli = join(base, "host", "dist", "cli.js");
		mkdirSync(dirname(cli), { recursive: true });
		const isolated = {
			argv1: cli,
			homeDir: join(base, "no-home"),
			appData: join(base, "no-appdata"),
			execPath: join(base, "sys", "node"),
		} as const;

		expect(
			resolvePiAiPackageRoot(start, { ...isolated, entry: "compat" }),
		).toBe(compatOnly);
		expect(
			resolvePiAiPackageRoot(start, { ...isolated, entry: "providers/all" }),
		).toBe(providersOnly);
		// No entry: the legacy version-only verdict keeps the first hit.
		expect(resolvePiAiPackageRoot(start, isolated)).toBe(compatOnly);
	});

	it("skips a version-compatible pi-ai whose exports lack the requested entry (#581)", () => {
		// A stale pi-ai copy (right name, allowed version, pre-compat exports)
		// shadowing the walk-up chain, e.g. ~/node_modules from a long-ago
		// install. Entry-agnostic resolution keeps its legacy version-only
		// verdict; entry-aware resolution must skip it for the host copy.
		const base = mkdtempSync(join(tmpdir(), "pi-free-loader-"));
		const stale = join(base, "node_modules", "@earendil-works", "pi-ai");
		makePackage(stale, {
			name: "@earendil-works/pi-ai",
			version: "0.84.2",
			// Predates the allow-listed entries: no "./compat" key.
			exports: { ".": "./dist/index.js" },
		});
		const start = join(base, "node_modules", "pi-free", "dist", "lib");
		mkdirSync(start, { recursive: true });
		const hostPiAi = join(
			base,
			"host",
			"node_modules",
			"@earendil-works",
			"pi-ai",
		);
		makePackage(hostPiAi, PI_AI_EXPORTS);
		const cli = join(base, "host", "dist", "cli.js");
		mkdirSync(dirname(cli), { recursive: true });
		// Pin every environment probe so only the walk-up and host-entry
		// strategies can find anything.
		const isolated = {
			homeDir: join(base, "no-home"),
			appData: join(base, "no-appdata"),
			execPath: join(base, "sys", "node"),
		} as const;

		expect(resolvePiAiPackageRoot(start, { argv1: cli, ...isolated })).toBe(
			stale,
		);
		expect(
			resolvePiAiPackageRoot(start, {
				argv1: cli,
				entry: "compat",
				...isolated,
			}),
		).toBe(hostPiAi);
		expect(
			resolvePiAiPackageRoot(start, {
				argv1: cli,
				entry: "providers/all",
				...isolated,
			}),
		).toBe(hostPiAi);
	});

	it("prefers a hoisted pi-ai over a nested one", () => {
		const base = mkdtempSync(join(tmpdir(), "pi-free-loader-"));
		const hoisted = join(base, "node_modules", "@earendil-works", "pi-ai");
		makePackage(hoisted, PI_AI_EXPORTS);
		const start = join(base, "node_modules", "pi-free", "lib");
		mkdirSync(start, { recursive: true });
		const isolated = {
			argv1: null,
			homeDir: base,
			appData: join(base, "no-appdata"),
			execPath: join(base, "bin", "node.exe"),
		} as const;
		expect(resolvePiAiPackageRoot(start, isolated)).toBe(hoisted);
		// Entry-aware resolution agrees: the hoisted copy defines both entries,
		// so it wins the first probe either way.
		expect(
			resolvePiAiPackageRoot(start, { ...isolated, entry: "compat" }),
		).toBe(hoisted);
		expect(
			resolvePiAiPackageRoot(start, { ...isolated, entry: "providers/all" }),
		).toBe(hoisted);
	});
});

describe("piAiRootDefinesEntry", () => {
	it("is true when exports define the entry even if the file is absent", () => {
		const base = mkdtempSync(join(tmpdir(), "pi-free-loader-"));
		const root = join(base, "pi-ai");
		makePackage(root, PI_AI_EXPORTS);
		expect(piAiRootDefinesEntry(root, "compat")).toBe(true);
		expect(piAiRootDefinesEntry(root, "providers/all")).toBe(true);
	});

	it("is false when exports predate the entry (stale copy, #581)", () => {
		const base = mkdtempSync(join(tmpdir(), "pi-free-loader-"));
		const root = join(base, "pi-ai");
		makePackage(root, {
			name: "@earendil-works/pi-ai",
			version: "0.84.2",
			exports: { ".": "./dist/index.js" },
		});
		expect(piAiRootDefinesEntry(root, "compat")).toBe(false);
		expect(piAiRootDefinesEntry(root, "providers/all")).toBe(false);
	});

	it("falls back to the known dist file when exports are unreadable", () => {
		const base = mkdtempSync(join(tmpdir(), "pi-free-loader-"));
		const root = join(base, "pi-ai");
		makePackage(root);
		writeFileSync(join(root, "package.json"), "not json");
		const compatFile = join(root, "dist", "compat.js");
		mkdirSync(join(root, "dist"), { recursive: true });
		writeFileSync(compatFile, "export {};");
		expect(piAiRootDefinesEntry(root, "compat")).toBe(true);
		expect(piAiRootDefinesEntry(root, "providers/all")).toBe(false);
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
		expect(isPiAiNotFoundError(new SyntaxError("Unexpected token"))).toBe(
			false,
		);
		expect(isPiAiNotFoundError(undefined)).toBe(false);
	});

	it("matches Bun's ResolveMessage shape (Bun-compiled pi binaries, #502)", () => {
		// Bun compile mode disables bare-specifier resolution from external
		// files; its ResolveMessage carries Node's code but a "Cannot find
		// module ... from ..." message.
		expect(
			isPiAiNotFoundError(
				moduleNotFound(
					"Cannot find module '@earendil-works/pi-ai/compat' from 'C:\\Users\\x\\.pi\\agent\\npm\\node_modules\\pi-free\\dist\\lib\\pi-ai-loader.js'",
				),
			),
		).toBe(true);
	});

	// #581: a stale pi-ai copy shadowing the resolution chain (right name,
	// allowed version, exports predating the allow-listed entry) makes Node
	// throw ERR_PACKAGE_PATH_NOT_EXPORTED instead of ERR_MODULE_NOT_FOUND.
	// The loader must treat that as "pi-ai not found here" and fall back,
	// not crash with the raw resolution error.
	function notExported(message: string) {
		const error = new Error(message) as NodeJS.ErrnoException;
		error.code = "ERR_PACKAGE_PATH_NOT_EXPORTED";
		return error;
	}

	it("matches a missing allow-listed subpath in a shadowing pi-ai copy (#581)", () => {
		expect(
			isPiAiNotFoundError(
				notExported(
					`Package subpath './compat' is not defined by "exports" in /Users/user/node_modules/@earendil-works/pi-ai/package.json imported from /Users/user/.pi/agent/npm/node_modules/pi-free/dist/lib/pi-ai-loader.js`,
				),
			),
		).toBe(true);
		expect(
			isPiAiNotFoundError(
				notExported(
					`Package subpath './providers/all' is not defined by "exports" in C:\\Users\\user\\node_modules\\@earendil-works\\pi-ai\\package.json imported from C:\\Users\\user\\.pi\\agent\\npm\\node_modules\\pi-free\\dist\\lib\\pi-ai-loader.js`,
				),
			),
		).toBe(true);
	});

	it("rejects a missing non-allow-listed subpath (#581)", () => {
		// './api/...' is pi-ai's own internal breakage, not a stale copy — it
		// must surface instead of triggering the disk fallback.
		expect(
			isPiAiNotFoundError(
				notExported(
					`Package subpath './api/openai-completions' is not defined by "exports" in /Users/user/node_modules/@earendil-works/pi-ai/package.json imported from /Users/user/node_modules/@earendil-works/pi-ai/dist/compat.js`,
				),
			),
		).toBe(false);
	});

	it("rejects a not-exported error naming a different package (#581)", () => {
		expect(
			isPiAiNotFoundError(
				notExported(
					`Package subpath './compat' is not defined by "exports" in /x/node_modules/some-other-package/package.json imported from /x/lazy-compat.js`,
				),
			),
		).toBe(false);
	});
});

describe("resolveVendoredPiAiEntryFile", () => {
	it("returns the vendored bundle path when it exists next to the loader", () => {
		// Shipped layout: dist/lib/pi-ai-loader.js → dist/vendor/<bundle>.
		const base = mkdtempSync(join(tmpdir(), "pi-free-loader-"));
		const libDir = join(base, "dist", "lib");
		const vendorDir = join(base, "dist", "vendor");
		mkdirSync(libDir, { recursive: true });
		mkdirSync(vendorDir, { recursive: true });
		const bundle = join(vendorDir, "pi-ai-compat.js");
		writeFileSync(bundle, "export {};\n");
		expect(resolveVendoredPiAiEntryFile("compat", libDir)).toBe(bundle);
	});

	it("returns undefined in source checkouts where the bundle was never built", () => {
		const base = mkdtempSync(join(tmpdir(), "pi-free-loader-"));
		const libDir = join(base, "lib");
		mkdirSync(libDir, { recursive: true });
		expect(resolveVendoredPiAiEntryFile("compat", libDir)).toBeUndefined();
		expect(
			resolveVendoredPiAiEntryFile("providers/all", libDir),
		).toBeUndefined();
	});
});
