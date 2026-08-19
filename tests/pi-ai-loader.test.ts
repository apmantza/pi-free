import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
		makePackage(nested);
		makePackage(join(base, "node_modules", "@earendil-works", "pi-coding-agent"));
		const start = join(base, "node_modules", "pi-free", "lib");
		mkdirSync(start, { recursive: true });
		expect(resolvePiAiPackageRoot(start)).toBe(nested);
	});

	it("prefers a hoisted pi-ai over a nested one", () => {
		const base = mkdtempSync(join(tmpdir(), "pi-free-loader-"));
		const hoisted = join(base, "node_modules", "@earendil-works", "pi-ai");
		makePackage(hoisted);
		const start = join(base, "node_modules", "pi-free", "lib");
		mkdirSync(start, { recursive: true });
		expect(resolvePiAiPackageRoot(start)).toBe(hoisted);
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
