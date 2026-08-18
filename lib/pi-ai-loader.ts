/**
 * Robust runtime loader for pi-ai's allow-listed entry points.
 *
 * pi-free is allowed to import pi-ai only through the entry points Pi
 * bundles/aliases for extensions (`@earendil-works/pi-ai/compat` and
 * `@earendil-works/pi-ai/providers/all`). In the compiled runtime pi-free
 * ships as plain ESM (`"type": "module"`), and Pi's extension loader (jiti)
 * passes such files straight to Node's native ESM loader — the alias Pi
 * registers for extensions is never applied. Native resolution therefore only
 * works when `@earendil-works/pi-ai` is physically present in the node_modules
 * chain above the pi-free install, which is not guaranteed (e.g. Windows
 * installs where npm nests pi-ai under pi-coding-agent's node_modules).
 *
 * In that case Node throws:
 *
 *   Error: Cannot find package '@earendil-works/pi-ai' imported from
 *   C:\Users\<user>\.pi\agent\npm\node_modules\pi-free\dist\lib\lazy-compat.js
 *
 * This loader keeps the bare-specifier import as the fast path (works on every
 * healthy install) and falls back to locating pi-ai's package root on disk via
 * the locations Pi itself installs pi-ai:
 *
 *   1. As a dependency of pi-coding-agent, found through a node_modules
 *      walk-up from this package (covers npm layouts that nest pi-ai).
 *   2. The agent npm dir under the user's home (~/.pi/agent/npm/node_modules).
 *   3. The global npm root on Windows (%APPDATA%\npm\node_modules).
 *   4. Relative to the Node executable (covers custom installs on other drives).
 *
 * The fallback imports the resolved entry by absolute file path, so pi-ai's
 * own relative imports keep resolving against pi-ai's real location.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** The pi-ai entry points pi-free is allowed to load at runtime. */
export type PiAiEntry = "compat" | "providers/all";

/** Bare specifiers used by the fast path, per allow-listed entry. */
const FAST_PATH_SPECIFIERS: Record<PiAiEntry, string> = {
	compat: "@earendil-works/pi-ai/compat",
	"providers/all": "@earendil-works/pi-ai/providers/all",
};

/** Subpath keys used against pi-ai's exports map. */
const EXPORT_SUBPATHS: Record<PiAiEntry, string> = {
	compat: "./compat",
	"providers/all": "./providers/all",
};

/** Known dist entry files, used only if pi-ai's exports map is unreadable. */
const PI_AI_ENTRY_FILES: Record<PiAiEntry, (root: string) => string> = {
	compat: (root) => join(root, "dist", "compat.js"),
	"providers/all": (root) => join(root, "dist", "providers", "all.js"),
};

const THIS_FILE_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * Mimics Node's package lookup: walks up from `startDir`, checking
 * `<dir>/node_modules/<relativePkgPath>` at each level, and returns the first
 * package directory whose package.json exists.
 */
export function findPackageInNodeModules(
	startDir: string,
	relativePkgPath: string[],
): string | undefined {
	let dir = startDir;
	for (;;) {
		const candidate = join(dir, "node_modules", ...relativePkgPath);
		if (existsSync(join(candidate, "package.json"))) return candidate;
		const parent = dirname(dir);
		if (parent === dir) return undefined;
		dir = parent;
	}
}

function probePackageRoot(candidate: string): string | undefined {
	return existsSync(join(candidate, "package.json")) ? candidate : undefined;
}

/**
 * Checks both pi-ai layouts inside a given node_modules root: hoisted at the
 * top level, or nested under pi-coding-agent (npm's Windows default).
 */
function probePiAiInRoot(root: string): string | undefined {
	return (
		probePackageRoot(join(root, "@earendil-works", "pi-ai")) ??
		probePackageRoot(
			join(
				root,
				"@earendil-works",
				"pi-coding-agent",
				"node_modules",
				"@earendil-works",
				"pi-ai",
			),
		)
	);
}

/**
 * Recursively searches for `<relativePkgPath>` inside any `node_modules`
 * directory reachable below `startDir`, up to `maxDepth` directory levels. This
 * catches layouts where pi-ai is nested several packages deep (e.g. Windows
 * installs that place pi-ai under pi-coding-agent's own node_modules, which a
 * plain walk-up can never reach).
 */
function findPackageNested(
	startDir: string,
	relativePkgPath: string[],
	maxDepth = 6,
): string | undefined {
	const stack: { dir: string; depth: number }[] = [
		{ dir: startDir, depth: 0 },
	];
	while (stack.length) {
		const { dir, depth } = stack.pop()!;
		const candidate = join(dir, "node_modules", ...relativePkgPath);
		if (existsSync(join(candidate, "package.json"))) return candidate;
		if (depth >= maxDepth) continue;
		// Descend into sibling packages' node_modules to keep searching.
		const nmDir = join(dir, "node_modules");
		if (!existsSync(nmDir)) continue;
		let entries: string[] = [];
		try {
			entries = readdirSync(nmDir);
		} catch {
			continue;
		}
		for (const entry of entries) {
			const child = join(nmDir, entry);
			try {
				if (statSync(child).isDirectory())
					stack.push({ dir: child, depth: depth + 1 });
			} catch {
				/* ignore unreadable entries */
			}
		}
	}
	return undefined;
}

/**
 * Locates the pi-ai package root when it is not reachable through this
 * package's own node_modules chain (the native fallback). `startDir` defaults
 * to this file's directory and is overridable for tests.
 */
export function resolvePiAiPackageRoot(
	startDir: string = THIS_FILE_DIR,
): string | undefined {
	const PI_AI = ["@earendil-works", "pi-ai"];
	const AGENT = ["@earendil-works", "pi-coding-agent"];

	// 1) pi-ai reachable through the standard walk-up (hoisted at or above
	//    the pi-free install, which is what native resolution would see).
	const direct = findPackageInNodeModules(startDir, PI_AI);
	if (direct) return direct;

	// 2) pi-ai as pi-coding-agent's own dependency. Finding the agent through
	//    the same walk-up, then searching upward from it, covers both the
	//    nested layout (agent/node_modules/pi-ai) and a hoisted-above-agent one
	//    in a single call.
	const agentRoot = findPackageInNodeModules(startDir, AGENT);
	if (agentRoot) {
		const nested = findPackageInNodeModules(agentRoot, PI_AI);
		if (nested) return nested;
	}

	// 3) Bounded recursive descent — catches any deeper nesting regardless of
	//    which package pi-ai ends up under.
	const nestedDeep = findPackageNested(startDir, PI_AI);
	if (nestedDeep) return nestedDeep;

	// 4) The agent npm dir under the user's home.
	const homeRoot = probePiAiInRoot(
		join(homedir(), ".pi", "agent", "npm", "node_modules"),
	);
	if (homeRoot) return homeRoot;

	// 5) Global npm root on Windows (pi installed via `npm i -g`).
	if (process.platform === "win32" && process.env.APPDATA) {
		const globalRoot = probePiAiInRoot(
			join(process.env.APPDATA, "npm", "node_modules"),
		);
		if (globalRoot) return globalRoot;
	}

	// 6) Relative to the Node executable — covers global installs where npm
	//    root differs from %APPDATA%\npm (e.g. custom Node installs on a
	//    different drive, or nvm-managed versions).
	const execRoot = probePiAiInRoot(join(dirname(process.execPath), "node_modules"));
	if (execRoot) return execRoot;

	return undefined;
}

/** Unwraps an exports target (string | { import } | { default } | nested). */
function unwrapExportTarget(
	target: string | Record<string, unknown> | undefined,
): string | undefined {
	if (typeof target === "string") return target;
	if (target && typeof target === "object") {
		const obj = target as Record<string, unknown>;
		if (typeof obj.import === "string") return obj.import;
		if (typeof obj.default === "string") return obj.default;
		for (const value of Object.values(obj)) {
			const nested = unwrapExportTarget(
				value as string | Record<string, unknown> | undefined,
			);
			if (nested) return nested;
		}
	}
	return undefined;
}

/**
 * Resolves an allow-listed entry to the file path inside a pi-ai package root,
 * honoring pi-ai's `exports` map (including wildcard subpaths).
 */
export function resolvePiAiEntryFile(
	root: string,
	entry: PiAiEntry,
): string | undefined {
	const subpath = EXPORT_SUBPATHS[entry];
	try {
		const exportsField = JSON.parse(
			readFileSync(join(root, "package.json"), "utf8"),
		).exports;
		if (
			exportsField &&
			typeof exportsField === "object" &&
			!Array.isArray(exportsField)
		) {
			const map = exportsField as Record<string, unknown>;
			let target = map[subpath];
			if (target === undefined) {
				// wildcard patterns, e.g. "./providers/*"
				for (const [key, value] of Object.entries(map)) {
					const starIndex = key.indexOf("*");
					if (starIndex === -1) continue;
					const prefix = key.slice(0, starIndex);
					const suffix = key.slice(starIndex + 1);
					if (
						!subpath.startsWith(prefix) ||
						!subpath.endsWith(suffix)
					)
						continue;
					const star = subpath.slice(
						prefix.length,
						subpath.length - suffix.length,
					);
					target =
						typeof value === "string"
							? value.replace("*", star)
							: value;
					break;
				}
			}
			const file = unwrapExportTarget(
				target as string | Record<string, unknown> | undefined,
			);
			if (file) return join(root, file);
		}
	} catch {
		// fall through to the known dist layout
	}
	return PI_AI_ENTRY_FILES[entry](root);
}

let resolvedPiAiRoot: string | undefined;
let resolvedPiAiRootAttempted = false;

/**
 * Loads an allow-listed pi-ai entry point, caching the resolved package root
 * so repeated fallbacks (e.g. provider stream setup) do not re-probe the disk.
 */
export async function loadPiAiEntry<T = unknown>(entry: PiAiEntry): Promise<T> {
	// Fast path: the bare specifier, exactly like the previous lazy imports.
	// Works whenever pi-ai is installed alongside pi-free (hoisted/peer).
	try {
		return (await import(FAST_PATH_SPECIFIERS[entry])) as T;
	} catch (error) {
		// Cold path: locate pi-ai on disk and import the entry file by path.
		if (!resolvedPiAiRootAttempted) {
			resolvedPiAiRoot = resolvePiAiPackageRoot();
			resolvedPiAiRootAttempted = true;
		}
		const root = resolvedPiAiRoot;
		if (!root) throw error; // keep the original "Cannot find package ..." error
		const entryFile = resolvePiAiEntryFile(root, entry);
		if (!entryFile) throw error;
		return (await import(pathToFileURL(entryFile).href)) as T;
	}
}
