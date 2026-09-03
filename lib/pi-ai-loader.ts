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
 *   1. Hoisted in the node_modules walk-up from this package.
 *   2. As a dependency of pi-coding-agent, found through the same walk-up
 *      (covers npm layouts that nest pi-ai under the agent's node_modules).
 *   3. Relative to the running pi host entry script (process.argv[1]). This
 *      covers hosted runs where pi-free's extension tree shares nothing with
 *      the host install — e.g. pi-free in ~/.pi/agent/npm while pi is a pnpm
 *      global install. The entry path is resolved through realpath first, so
 *      symlinked `bin` shims land in the real package tree; walking up from a
 *      symlink-resolved pi-coding-agent root also covers pnpm's virtual-store
 *      layout, where pi-ai sits as a sibling dependency.
 *   4. The agent npm dir under the user's home (~/.pi/agent/npm/node_modules).
 *   5. The global npm root on Windows (%APPDATA%\npm\node_modules).
 *   6. Relative to the Node executable (covers custom installs on other
 *      drives and version-manager layouts like nvm).
 *   7. The self-contained vendored bundle in dist/vendor (built by
 *      scripts/build.mjs). Last resort for Bun-compiled pi binaries
 *      (scoop/winget/standalone zip): Bun's compile mode disables bare-specifier
 *      resolution from external files entirely, so NO on-disk pi-ai layout can
 *      serve them — even a perfectly installed pi-ai fails on its own internal
 *      bare imports (typebox, openai, ...). The vendored bundle inlines every
 *      transitive dependency, keeping only node:* builtins external (#502).
 *      It is tried last because its pi-ai version is frozen at pi-free's build
 *      time, while any on-disk copy matches the running host.
 *
 * The fallback imports the resolved entry by absolute file path, so pi-ai's
 * own relative imports keep resolving against pi-ai's real location.
 */

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createLogger } from "./logger.ts";

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

/**
 * Vendored bundle file names inside `dist/vendor`, per allow-listed entry.
 * Built by scripts/build.mjs; absent in source checkouts and tests.
 */
const VENDORED_ENTRY_NAMES: Record<PiAiEntry, string> = {
	compat: "pi-ai-compat.js",
	"providers/all": "pi-ai-providers-all.js",
};

const vendoredLog = createLogger("pi-ai-loader");

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

/**
 * Optional overrides for {@link resolvePiAiPackageRoot}, used by tests to
 * simulate hosted layouts without touching real process state.
 */
interface ResolvePiAiRootOptions {
	/** Entry script of the running process. Defaults to `process.argv[1]`; pass `null` to simulate a hosted run with no usable entry path. */
	argv1?: string | null;
	/** Overrides `homedir()` for the `~/.pi/agent/npm` probe (tests). */
	homeDir?: string;
	/** Overrides `%APPDATA%` for the Windows global-root probe; `null` skips it (tests). */
	appData?: string | null;
	/** Overrides `process.execPath` for the executable-relative probe (tests). */
	execPath?: string;
}

const PI_AI_SEGMENTS = ["@earendil-works", "pi-ai"];
const AGENT_SEGMENTS = ["@earendil-works", "pi-coding-agent"];

/** realpath that degrades to the input path when the link cannot be resolved. */
function safeRealpath(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return path;
	}
}

/**
 * Lowest pi-ai version pi-free's peer dependency range starts at. Keep in
 * sync with the "@earendil-works/pi-ai" peerDependencies floor in
 * package.json.
 */
const MIN_PI_AI_VERSION = [0, 81, 0] as const;
/**
 * Guards every host-entry hit against loading an unrelated or ancient pi-ai
 * copy: the directory must contain a package.json naming @earendil-works/pi-ai
 * at or above the peer-dependency minimum. Loading a wrong-version pi-ai
 * would trade a clear ERR_MODULE_NOT_FOUND for subtle runtime breakage.
 */
function isUsablePiAiRoot(root: string): boolean {
	try {
		const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
			name?: unknown;
			version?: unknown;
		};
		if (pkg.name !== "@earendil-works/pi-ai") return false;
		const version = typeof pkg.version === "string" ? pkg.version : "";
		const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
		if (!match) return false;
		const candidate = [
			Number(match[1]),
			Number(match[2]),
			Number(match[3]),
		];
		for (let i = 0; i < MIN_PI_AI_VERSION.length; i++) {
			if (candidate[i] !== MIN_PI_AI_VERSION[i]) {
				return candidate[i] > MIN_PI_AI_VERSION[i];
			}
		}
		return true;
	} catch {
		return false;
	}
}

/**
 * Locates pi-ai relative to the running pi host's entry script. Handles the
 * hosted-layout failure mode where pi-free's extension tree shares no
 * node_modules with the host install: the entry path is realpath-resolved
 * (bin shims are usually symlinks), then both pi-ai directly and pi-ai as the
 * agent's own dependency are searched above it. Resolving the found agent
 * root through realpath additionally covers pnpm's virtual store, where the
 * top-level agent entry is a symlink and pi-ai lives only next to the real
 * package directory.
 */
function findViaHostEntry(argvPath: string | undefined): string | undefined {
	// Relative entry paths are rejected outright: a compiled-binary host (or
	// any launcher) can expose the first USER argument as argv[1], and walking
	// up from a CWD-relative path would let an unrelated project's node_modules
	// satisfy the lookup with an arbitrary pi-ai version. Real host entry
	// scripts are always absolute. Residual risk: a frozen/embedded host that
	// reports an absolute argv[1] in an unrelated tree still walks up from
	// there — the name+version guard bounds the damage to a
	// minimum-version-compatible foreign copy.
	if (!argvPath || !isAbsolute(argvPath)) return undefined;
	const entryDir = dirname(safeRealpath(argvPath));
	const direct = findPackageInNodeModules(entryDir, PI_AI_SEGMENTS);
	if (direct && isUsablePiAiRoot(direct)) return direct;
	const agentRoot = findPackageInNodeModules(entryDir, AGENT_SEGMENTS);
	if (!agentRoot) return undefined;
	const nested = findPackageInNodeModules(
		dirname(safeRealpath(agentRoot)),
		PI_AI_SEGMENTS,
	);
	return nested && isUsablePiAiRoot(nested) ? nested : undefined;
}

function probePackageRoot(candidate: string): string | undefined {
	return existsSync(join(candidate, "package.json")) ? candidate : undefined;
}

/**
 * Checks both pi-ai layouts inside a given node_modules root: hoisted at the
 * top level, or nested under pi-coding-agent (npm's Windows default).
 */
/**
 * Checks both pi-ai layouts inside a given node_modules root: hoisted at the
 * top level, or nested under pi-coding-agent (npm's Windows default). Every
 * hit is validated through {@link isUsablePiAiRoot} — these probes run last,
 * when nothing better was found, so a stale or foreign look-alike directory
 * must not be imported wholesale.
 */
function probePiAiInRoot(root: string): string | undefined {
	const direct = probePackageRoot(join(root, "@earendil-works", "pi-ai"));
	if (direct && isUsablePiAiRoot(direct)) return direct;
	const nested = probePackageRoot(
		join(
			root,
			"@earendil-works",
			"pi-coding-agent",
			"node_modules",
			"@earendil-works",
			"pi-ai",
		),
	);
	return nested && isUsablePiAiRoot(nested) ? nested : undefined;
}

/**
 * Locates the pi-ai package root when it is not reachable through this
 * package's own node_modules chain (the native fallback). `startDir` defaults
 * to this file's directory and is overridable for tests.
 */
export function resolvePiAiPackageRoot(
	startDir: string = THIS_FILE_DIR,
	options: ResolvePiAiRootOptions = {},
): string | undefined {
	// 1) pi-ai reachable through the standard walk-up (hoisted at or above
	//    the pi-free install, which is what native resolution would see).
	const direct = findPackageInNodeModules(startDir, PI_AI_SEGMENTS);
	if (direct && isUsablePiAiRoot(direct)) return direct;

	// 2) pi-ai as pi-coding-agent's own dependency. Finding the agent through
	//    the same walk-up, then searching upward from it, covers both the
	//    nested layout (agent/node_modules/pi-ai) and a hoisted-above-agent one
	//    in a single call.
	const agentRoot = findPackageInNodeModules(startDir, AGENT_SEGMENTS);
	if (agentRoot) {
		const nested = findPackageInNodeModules(agentRoot, PI_AI_SEGMENTS);
		if (nested && isUsablePiAiRoot(nested)) return nested;
	}

	// 3) Relative to the running pi host's entry script — the hosted-run
	//    fallback for installs where the extension tree and the host share
	//    nothing (see findViaHostEntry).
	const viaHost = findViaHostEntry(
		options.argv1 === undefined ? process.argv[1] : (options.argv1 ?? undefined),
	);
	if (viaHost) return viaHost;

	// 4) The agent npm dir under the user's home.
	const homeRoot = probePiAiInRoot(
		join(options.homeDir ?? homedir(), ".pi", "agent", "npm", "node_modules"),
	);
	if (homeRoot) return homeRoot;

	// 5) Global npm root on Windows (pi installed via `npm i -g`).
	const appData =
		options.appData === undefined ? process.env.APPDATA : options.appData;
	if (process.platform === "win32" && appData) {
		const globalRoot = probePiAiInRoot(join(appData, "npm", "node_modules"));
		if (globalRoot) return globalRoot;
	}

	// 6) Relative to the Node executable — covers global installs where the
	//    npm root differs from the default (custom Node installs on another
	//    drive, or version managers). Windows keeps node_modules next to the
	//    executable; POSIX prefixes keep it under <prefix>/lib/node_modules.
	const execDir = dirname(options.execPath ?? process.execPath);
	const execRoot =
		probePiAiInRoot(join(execDir, "node_modules")) ??
		probePiAiInRoot(join(execDir, "..", "lib", "node_modules"));
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
 * Substitutes a wildcard match into every string of an exports target. Targets
 * are commonly conditions objects (`{ types, import }`) whose values still
 * contain the `*`, e.g. pi-ai's `"./providers/*": { import: "./dist/providers/*.js" }`.
 */
function substituteStar(
	target: unknown,
	star: string,
): string | Record<string, unknown> | undefined {
	if (typeof target === "string") return target.replaceAll("*", star);
	if (target && typeof target === "object" && !Array.isArray(target)) {
		const result: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(target)) {
			result[key] = substituteStar(value, star);
		}
		return result;
	}
	return undefined;
}

/**
 * Resolves an allow-listed entry to the file path inside a pi-ai package root,
 * honoring pi-ai's `exports` map (including wildcard subpaths). Returns
 * undefined when no candidate file exists on disk, so callers can surface the
 * original resolution error instead of a confusing file-path import failure.
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
			let target = map[subpath] as string | Record<string, unknown> | undefined;
			if (target === undefined) {
				// wildcard patterns, e.g. "./providers/*"
				for (const [key, value] of Object.entries(map)) {
					const starIndex = key.indexOf("*");
					if (starIndex === -1) continue;
					const prefix = key.slice(0, starIndex);
					const suffix = key.slice(starIndex + 1);
					if (!subpath.startsWith(prefix) || !subpath.endsWith(suffix)) continue;
					const star = subpath.slice(prefix.length, subpath.length - suffix.length);
					target = substituteStar(value, star);
					break;
				}
			}
			const file = unwrapExportTarget(target);
			if (file) {
				const resolved = join(root, file);
				if (existsSync(resolved)) return resolved;
			}
		}
	} catch {
		// fall through to the known dist layout
	}
	const fallback = PI_AI_ENTRY_FILES[entry](root);
	return existsSync(fallback) ? fallback : undefined;
}

/**
 * Resolves the vendored last-resort bundle for an entry, relative to this
 * file's directory (dist/lib → dist/vendor in the shipped package). Returns
 * undefined when the bundle was never built (source checkouts, tests), so
 * callers can surface the original resolution error instead. `baseDir` is
 * overridable for tests.
 */
export function resolveVendoredPiAiEntryFile(
	entry: PiAiEntry,
	baseDir: string = THIS_FILE_DIR,
): string | undefined {
	const file = join(baseDir, "..", "vendor", VENDORED_ENTRY_NAMES[entry]);
	return existsSync(file) ? file : undefined;
}

let resolvedPiAiRoot: string | undefined;
let resolvedPiAiRootAttempted = false;

/**
 * True only when the fast-path import failed because pi-ai itself is missing.
 * A failure inside pi-ai (a missing transitive dep, a corrupt file) must NOT
 * trigger the disk fallback — it would mask the real error and could load a
 * second, possibly stale pi-ai copy into the process.
 */
export function isPiAiNotFoundError(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		(error as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND" &&
		// Match the quoted specifier, not the "imported from" path — a missing
		// transitive dep names its own package but carries pi-ai in the path.
		/Cannot find (?:package|module) '@earendil-works\/pi-ai(?:\/[^']*)?'/.test(
			String((error as Error).message),
		)
	);
}

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
		if (!isPiAiNotFoundError(error)) throw error;
		// Cold path: locate pi-ai on disk and import the entry file by path.
		// A failed resolution is NOT cached: matching lazy-compat's policy that
		// a transient load error must not break every later stream, the next
		// call re-probes instead of rethrowing a stale miss forever.
		if (!resolvedPiAiRootAttempted) {
			resolvedPiAiRoot = resolvePiAiPackageRoot();
			resolvedPiAiRootAttempted = resolvedPiAiRoot !== undefined;
		}
		const root = resolvedPiAiRoot;
		if (root) {
			const entryFile = resolvePiAiEntryFile(root, entry);
			if (entryFile) return (await import(pathToFileURL(entryFile).href)) as T;
		}
		// Last resort: the self-contained vendored bundle — the ONLY working
		// source under Bun-compiled pi binaries, which resolve no bare
		// specifiers from external files at all (#502).
		const vendored = resolveVendoredPiAiEntryFile(entry);
		if (vendored) {
			vendoredLog.debug(
				`no resolvable pi-ai package on disk; using vendored bundle for "${entry}"`,
				{ vendored },
			);
			return (await import(pathToFileURL(vendored).href)) as T;
		}
		throw error; // keep the original "Cannot find package ..." error
	}
}
