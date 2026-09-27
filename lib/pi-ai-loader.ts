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
 * Two failure kinds trigger the fallback. `ERR_MODULE_NOT_FOUND` means pi-ai
 * is absent from the chain; `ERR_PACKAGE_PATH_NOT_EXPORTED` for an
 * allow-listed subpath means a stale pi-ai copy (right name, allowed version,
 * exports predating the entry — e.g. a long-ago `npm install` in ~/node_modules
 * shadowing the walk-up from ~/.pi/agent/npm, #581) resolved instead of the
 * real one. Other subpaths are pi-ai's internal breakage and rethrow.
 *
 * Resolution is entry-aware: a candidate root must define the requested entry
 * in its exports map (or carry the known dist file), so a stale copy never
 * shadows a good one further down the probe order — the stale copy is skipped
 * and the search continues toward the vendored bundle.
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

const loaderLog = createLogger("pi-ai-loader");

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
	/**
	 * Allow-listed entry the resolved copy must serve (#581). A candidate
	 * root whose exports map predates the entry (stale shadowing copy) is
	 * skipped so the search continues to the next probe. Omitted for the
	 * legacy version-only verdict.
	 */
	entry?: PiAiEntry;
	/**
	 * Optional collector for the probe order: one {@link PiAiProbeRecord} per
	 * probe attempted, in the order the resolver evaluates them, with the
	 * rejection reason when a candidate was found but not usable. The doctor
	 * ({@link describePiAiResolution}) renders it and tests pin the documented
	 * order with it; production resolution passes nothing and pays nothing.
	 */
	trace?: PiAiProbeRecord[];
}

/** One probe's outcome, in the resolver's own order. */
export interface PiAiProbeRecord {
	/** Probe label, e.g. `walk-up`, `host-entry/direct`, `home-npm/hoisted`. */
	probe: string;
	outcome: "hit" | "miss" | "rejected";
	/** Absolute candidate root, when a directory was found at all. */
	root?: string;
	/** {@link describeRejection} reason, when the candidate was rejected. */
	reason?: string;
}

/** Records one probe outcome, or undefined when nobody is tracing. */
type ProbeRecorder = (probe: string, candidate: string | undefined) => void;

/**
 * Builds the probe recorder for one entry-aware search. Kept next to
 * {@link describeRejection} so the trace can never disagree with the guard
 * about why a candidate was refused.
 */
function makeProbeRecorder(
	trace: PiAiProbeRecord[] | undefined,
	entry: PiAiEntry | undefined,
): ProbeRecorder | undefined {
	if (!trace) return undefined;
	return (probe, candidate) => {
		if (candidate === undefined) {
			trace.push({ probe, outcome: "miss" });
			return;
		}
		const reason = describeRejection(candidate, entry);
		trace.push(
			reason === undefined
				? { probe, outcome: "hit", root: candidate }
				: { probe, outcome: "rejected", root: candidate, reason },
		);
	};
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

/** Package name a directory must carry to count as a pi-ai copy. */
const PI_AI_PACKAGE_NAME = "@earendil-works/pi-ai";

/** Parsed identity of a directory that may be a pi-ai package root. */
interface PiAiPackageInfo {
	version: string;
}

/**
 * Reads `<root>/package.json` as a pi-ai package. Undefined when the file is
 * missing, unparseable, or not pi-ai at all (the name is the first thing a
 * look-alike directory gets wrong). Used by both the usability guard and the
 * doctor, so the two can never disagree about what they are looking at.
 */
function readPiAiPackageInfo(root: string): PiAiPackageInfo | undefined {
	try {
		const pkg = JSON.parse(
			readFileSync(join(root, "package.json"), "utf8"),
		) as {
			name?: unknown;
			version?: unknown;
		};
		if (pkg.name !== PI_AI_PACKAGE_NAME) return undefined;
		return { version: typeof pkg.version === "string" ? pkg.version : "" };
	} catch {
		return undefined;
	}
}

/**
 * True when `version` is at or above the `floor` triple. An unparseable
 * version compares false — the safe direction for a guard that gates loading
 * an unknown pi-ai copy.
 */
function versionAtLeast(version: string, floor: readonly number[]): boolean {
	const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
	if (!match) return false;
	// Destructure with safe defaults: match success proves all three groups
	// participated, but the default keeps garbage fail-safe (NaN compares
	// false below, rejecting the root).
	const [, major = "", minor = "", patch = ""] = match;
	const candidate = [Number(major), Number(minor), Number(patch)];
	for (let i = 0; i < floor.length; i++) {
		// NaN (unparseable) compares false below, rejecting the root — the safe
		// direction. Want-default only satisfies the compiler (floor is a
		// complete triple in practice).
		const have = candidate[i] ?? Number.NaN;
		const want = floor[i] ?? 0;
		if (have !== want) return have > want;
	}
	return true;
}

/**
 * Why a directory is not a usable pi-ai copy for `entry`, or undefined when it
 * is usable. The single source of truth behind {@link isCandidatePiAiRoot},
 * and the reason the doctor renders: a bare
 * "not found" is what made #581 take a support thread to diagnose, while
 * "exports do not define ./compat" names the defect.
 *
 * Credential-free by construction: package name, version, and subpath only.
 */
function describeRejection(
	root: string,
	entry?: PiAiEntry,
): string | undefined {
	const info = readPiAiPackageInfo(root);
	if (!info) return `not a ${PI_AI_PACKAGE_NAME} package`;
	if (!versionAtLeast(info.version, MIN_PI_AI_VERSION)) {
		return `version ${info.version || "unknown"} is below ${MIN_PI_AI_VERSION.join(".")}`;
	}
	if (entry && !piAiRootDefinesEntry(root, entry)) {
		return `exports do not define "${EXPORT_SUBPATHS[entry]}"`;
	}
	return undefined;
}

/**
 * A candidate root qualifies for `entry` when it is a usable pi-ai copy AND
 * defines the requested entry. Without `entry` this is the legacy
 * version-only verdict (what the removed `isUsablePiAiRoot` guard asked). The
 * entry check keeps a stale shadowing copy (#581: right name, allowed
 * version, exports predating the entry) from winning an early probe over a
 * good copy further down the order.
 */
function isCandidatePiAiRoot(root: string, entry?: PiAiEntry): boolean {
	return describeRejection(root, entry) === undefined;
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
function findViaHostEntry(
	argvPath: string | undefined,
	entry?: PiAiEntry,
	note?: ProbeRecorder,
): string | undefined {
	// Relative entry paths are rejected outright: a compiled-binary host (or
	// any launcher) can expose the first USER argument as argv[1], and walking
	// up from a CWD-relative path would let an unrelated project's node_modules
	// satisfy the lookup with an arbitrary pi-ai version. Real host entry
	// scripts are always absolute. Residual risk: a frozen/embedded host that
	// reports an absolute argv[1] in an unrelated tree still walks up from
	// there — the name+version guard bounds the damage to a
	// minimum-version-compatible foreign copy.
	if (!argvPath || !isAbsolute(argvPath)) {
		note?.("host-entry", undefined);
		return undefined;
	}
	const entryDir = dirname(safeRealpath(argvPath));
	const direct = findPackageInNodeModules(entryDir, PI_AI_SEGMENTS);
	note?.("host-entry/direct", direct);
	if (direct && isCandidatePiAiRoot(direct, entry)) return direct;
	const agentRoot = findPackageInNodeModules(entryDir, AGENT_SEGMENTS);
	if (!agentRoot) {
		note?.("host-entry/agent-nested", undefined);
		return undefined;
	}
	const nested = findPackageInNodeModules(
		dirname(safeRealpath(agentRoot)),
		PI_AI_SEGMENTS,
	);
	note?.("host-entry/agent-nested", nested);
	return nested && isCandidatePiAiRoot(nested, entry) ? nested : undefined;
}

function probePackageRoot(candidate: string): string | undefined {
	return existsSync(join(candidate, "package.json")) ? candidate : undefined;
}

/**
 * Checks both pi-ai layouts inside a given node_modules root: hoisted at the
 * top level, or nested under pi-coding-agent (npm's Windows default). Every
 * hit is validated through {@link isCandidatePiAiRoot} — these probes run last,
 * when nothing better was found, so a stale or foreign look-alike directory
 * must not be imported wholesale. `label` prefixes the trace entries so the
 * doctor can tell the home-npm probe from the executable-relative one.
 */
function probePiAiInRoot(
	root: string,
	entry?: PiAiEntry,
	note?: ProbeRecorder,
	label = "",
): string | undefined {
	const prefix = label ? `${label}/` : "";
	const direct = probePackageRoot(join(root, "@earendil-works", "pi-ai"));
	note?.(`${prefix}hoisted`, direct);
	if (direct && isCandidatePiAiRoot(direct, entry)) return direct;
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
	note?.(`${prefix}agent-nested`, nested);
	return nested && isCandidatePiAiRoot(nested, entry) ? nested : undefined;
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
	const { entry } = options;
	const note = makeProbeRecorder(options.trace, entry);
	// 1) pi-ai reachable through the standard walk-up (hoisted at or above
	//    the pi-free install, which is what native resolution would see).
	const direct = findPackageInNodeModules(startDir, PI_AI_SEGMENTS);
	note?.("walk-up", direct);
	if (direct && isCandidatePiAiRoot(direct, entry)) return direct;

	// 2) pi-ai as pi-coding-agent's own dependency. Finding the agent through
	//    the same walk-up, then searching upward from it, covers both the
	//    nested layout (agent/node_modules/pi-ai) and a hoisted-above-agent one
	//    in a single call.
	const agentRoot = findPackageInNodeModules(startDir, AGENT_SEGMENTS);
	if (agentRoot) {
		const nested = findPackageInNodeModules(agentRoot, PI_AI_SEGMENTS);
		note?.("agent-nested", nested);
		if (nested && isCandidatePiAiRoot(nested, entry)) return nested;
	} else {
		note?.("agent-nested", undefined);
	}

	// 3) Relative to the running pi host's entry script — the hosted-run
	//    fallback for installs where the extension tree and the host share
	//    nothing (see findViaHostEntry).
	const viaHost = findViaHostEntry(
		options.argv1 === undefined
			? process.argv[1]
			: (options.argv1 ?? undefined),
		entry,
		note,
	);
	if (viaHost) return viaHost;

	// 4) The agent npm dir under the user's home.
	const homeRoot = probePiAiInRoot(
		join(options.homeDir ?? homedir(), ".pi", "agent", "npm", "node_modules"),
		entry,
		note,
		"home-npm",
	);
	if (homeRoot) return homeRoot;

	// 5) Global npm root on Windows (pi installed via `npm i -g`).
	const appData =
		options.appData === undefined ? process.env.APPDATA : options.appData;
	if (process.platform === "win32" && appData) {
		const globalRoot = probePiAiInRoot(
			join(appData, "npm", "node_modules"),
			entry,
			note,
			"win-appdata",
		);
		if (globalRoot) return globalRoot;
	}

	// 6) Relative to the Node executable — covers global installs where the
	//    npm root differs from the default (custom Node installs on another
	//    drive, or version managers). Windows keeps node_modules next to the
	//    executable; POSIX prefixes keep it under <prefix>/lib/node_modules.
	const execDir = dirname(options.execPath ?? process.execPath);
	const execRoot =
		probePiAiInRoot(join(execDir, "node_modules"), entry, note, "exec") ??
		probePiAiInRoot(
			join(execDir, "..", "lib", "node_modules"),
			entry,
			note,
			"exec-lib",
		);
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
 * Looks up the exports target for an allow-listed subpath, honoring wildcard
 * keys (pi-ai's `"./providers/*"`). Returns undefined when the map defines no
 * matching subpath — the signal that this copy predates the entry (#581).
 */
function findExportTarget(
	map: Record<string, unknown>,
	subpath: string,
): string | Record<string, unknown> | undefined {
	const direct = map[subpath] as string | Record<string, unknown> | undefined;
	if (direct !== undefined) return direct;
	for (const [key, value] of Object.entries(map)) {
		const starIndex = key.indexOf("*");
		if (starIndex === -1) continue;
		const prefix = key.slice(0, starIndex);
		const suffix = key.slice(starIndex + 1);
		if (!subpath.startsWith(prefix) || !subpath.endsWith(suffix)) continue;
		const star = subpath.slice(prefix.length, subpath.length - suffix.length);
		return substituteStar(value, star);
	}
	return undefined;
}

/**
 * True when a pi-ai package root defines an allow-listed entry. Unlike
 * {@link resolvePiAiEntryFile} this does NOT require the target file to exist
 * — it answers "does this copy know the entry at all", which is the question
 * the entry-aware root search asks. When the exports map is unreadable it
 * degrades to the known dist layout on disk.
 */
export function piAiRootDefinesEntry(root: string, entry: PiAiEntry): boolean {
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
			if (
				findExportTarget(exportsField as Record<string, unknown>, subpath) !==
				undefined
			)
				return true;
		}
	} catch {
		// Unreadable package.json: fall through to the known dist layout.
	}
	return existsSync(PI_AI_ENTRY_FILES[entry](root));
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
			const target = findExportTarget(
				exportsField as Record<string, unknown>,
				subpath,
			);
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

const resolvedPiAiRoots = new Map<PiAiEntry, string>();

/** One copy's identity and entry coverage, as the doctor renders it. */
export interface PiAiCopySummary {
	/** Absolute package root, or null when no copy is reachable this way. */
	root: string | null;
	version: string | null;
	/** Per allow-listed entry: does this copy's exports map define it? */
	defines: Record<PiAiEntry, boolean>;
}

/** How one allow-listed entry is reachable, and by which probe. */
export interface PiAiEntryResolution {
	/** Entry-aware root that serves this entry, or null. */
	root: string | null;
	/** Version of that root, or null. */
	version: string | null;
	/** Absolute entry file: on disk, or from the vendored bundle. */
	file: string | null;
	source: "on-disk" | "vendored" | null;
	/** Probe label that produced `root`, or null when none did. */
	via: string | null;
	/** The full entry-aware probe order for this entry. */
	probes: PiAiProbeRecord[];
}

/**
 * The doctor's snapshot: what the runtime resolves, and what the bare
 * specifier would have resolved instead. Credential-free — paths, versions and
 * booleans only — so `/pi-free-health` can render it and the telemetry file can
 * persist it without leaking anything.
 */
export interface PiAiResolutionSnapshot {
	/**
	 * What Node's own bare-specifier import reaches: a non-entry-aware walk-up
	 * from this module. This is the copy that produced
	 * `ERR_PACKAGE_PATH_NOT_EXPORTED` in #581, which is why it is reported
	 * separately from the entry-aware result.
	 */
	fastPath: PiAiCopySummary;
	/** Entry-aware resolution, per allow-listed entry. */
	entries: Record<PiAiEntry, PiAiEntryResolution>;
	/** Session loads that fell off the fast path, deduped and bounded. */
	events: PiAiResolutionEvent[];
	/** `dist/vendor` last-resort bundles present (Bun-compiled hosts need them). */
	vendored: boolean;
	/**
	 * The fast-path copy exists but cannot serve an entry the loader needs —
	 * the stale/shadowing shape from #581, whether or not a fallback recovers.
	 */
	shadowed: boolean;
}

/**
 * Describe the current pi-ai resolution state for a diagnostic surface.
 *
 * Filesystem-only: it never imports pi-ai, so calling it cannot trigger the
 * ~1.5s compat load this loader exists to defer (convention 16). The cost is a
 * handful of `existsSync` calls plus at most a few small `package.json` reads,
 * measured in the sub-millisecond range.
 */
export function describePiAiResolution(): PiAiResolutionSnapshot {
	/** Identity + entry coverage of one copy (no probing). */
	const summarise = (root: string | undefined): PiAiCopySummary => ({
		root: root ?? null,
		version: root ? (readPiAiPackageInfo(root)?.version ?? null) : null,
		defines: {
			compat: root !== undefined && piAiRootDefinesEntry(root, "compat"),
			"providers/all":
				root !== undefined && piAiRootDefinesEntry(root, "providers/all"),
		},
	});

	// The fast path is deliberately entry-agnostic: it mirrors the bare
	// specifier, which knows nothing about pi-free's allow-list.
	const fastPath = summarise(
		findPackageInNodeModules(THIS_FILE_DIR, PI_AI_SEGMENTS),
	);
	return {
		fastPath,
		entries: {
			compat: describeEntryResolution("compat"),
			"providers/all": describeEntryResolution("providers/all"),
		},
		events: getPiAiResolutionEvents(),
		vendored: resolveVendoredPiAiEntryFile("compat") !== undefined,
		shadowed:
			fastPath.root !== null &&
			(!fastPath.defines.compat || !fastPath.defines["providers/all"]),
	};
}

/**
 * Entry-aware resolution for one allow-listed entry, with its probe trace.
 * Runs the same search the loader runs, so a diagnostic can never describe a
 * different copy than the runtime would load.
 */
function describeEntryResolution(entry: PiAiEntry): PiAiEntryResolution {
	const probes: PiAiProbeRecord[] = [];
	const root = resolvePiAiPackageRoot(THIS_FILE_DIR, { entry, trace: probes });
	const onDisk = root ? resolvePiAiEntryFile(root, entry) : undefined;
	const vendored = onDisk ? undefined : resolveVendoredPiAiEntryFile(entry);
	let source: PiAiEntryResolution["source"] = null;
	if (onDisk) source = "on-disk";
	else if (vendored) source = "vendored";
	return {
		root: root ?? null,
		version: root ? (readPiAiPackageInfo(root)?.version ?? null) : null,
		file: onDisk ?? vendored ?? null,
		source,
		via: probes.find((record) => record.outcome === "hit")?.probe ?? null,
		probes,
	};
}

/** One pi-ai load that fell off the fast path, and how it recovered. */
export interface PiAiResolutionEvent {
	at: string;
	entry: PiAiEntry;
	/** `ERR_MODULE_NOT_FOUND`, `ERR_PACKAGE_PATH_NOT_EXPORTED`, or `unknown`. */
	code: string;
	/** Bare-specifier copy that failed, when one was reachable. */
	fastPathRoot: string | null;
	/** Whether the load recovered, and from where. */
	recovered: "on-disk" | "vendored" | "none";
	/** Entry-aware root used for the recovery, when it came from disk. */
	resolvedRoot: string | null;
	/** File actually imported (entry file or vendored bundle), when any. */
	resolvedFile: string | null;
}

const PI_AI_EVENT_CAP = 8;
const _resolutionEvents: PiAiResolutionEvent[] = [];

/**
 * Records one distinct fast-path failure per session. Deduped on
 * (entry, code, recovered): a provider stream loop must not turn one degraded
 * environment into an unbounded ring or an unbounded log stream. Returns true
 * only for a newly recorded event, so callers can bind their log line to it.
 */
function recordResolutionEvent(event: PiAiResolutionEvent): boolean {
	const seen = _resolutionEvents.some(
		(existing) =>
			existing.entry === event.entry &&
			existing.code === event.code &&
			existing.recovered === event.recovered,
	);
	if (seen) return false;
	_resolutionEvents.push(event);
	if (_resolutionEvents.length > PI_AI_EVENT_CAP) {
		_resolutionEvents.splice(0, _resolutionEvents.length - PI_AI_EVENT_CAP);
	}
	return true;
}

/** Newest-last copy of the session's resolution events. */
function getPiAiResolutionEvents(): PiAiResolutionEvent[] {
	return [..._resolutionEvents];
}

/**
 * True when the fast-path import failed because pi-ai itself is missing or
 * does not serve the allow-listed entry. A failure inside pi-ai (a missing
 * transitive dep, a corrupt file, a missing non-allow-listed subpath) must NOT
 * trigger the disk fallback — it would mask the real error and could load a
 * second, possibly stale pi-ai copy into the process.
 */
export function isPiAiNotFoundError(error: unknown): boolean {
	if (typeof error !== "object" || error === null) return false;
	const code = (error as NodeJS.ErrnoException).code;
	const message = String((error as Error).message);
	if (code === "ERR_MODULE_NOT_FOUND") {
		// Match the quoted specifier, not the "imported from" path — a missing
		// transitive dep names its own package but carries pi-ai in the path.
		return /Cannot find (?:package|module) '@earendil-works\/pi-ai(?:\/[^']*)?'/.test(
			message,
		);
	}
	if (code === "ERR_PACKAGE_PATH_NOT_EXPORTED") {
		// #581: a stale pi-ai copy shadowing the resolution chain (right name,
		// allowed version, exports predating the entry — e.g. a long-ago install
		// in ~/node_modules above ~/.pi/agent/npm) resolves instead of the real
		// one and Node throws this instead of ERR_MODULE_NOT_FOUND. Only the
		// baseline allow-listed subpaths qualify: any other subpath is pi-ai's own
		// internal breakage and must surface rather than silently pick another
		// copy.
		return /^Package subpath '\.\/(?:compat|providers\/all)' is not defined by "exports" in .*@earendil-works[\\/]pi-ai[\\/]package\.json/.test(
			message,
		);
	}
	return false;
}

/**
 * Records a cold-path load outcome and logs it through the `pi-ai-loader`
 * namespace — the observability seam this loader already owns. Log volume is
 * bound to the event ring's dedupe: a stream loop that keeps re-entering the
 * cold path logs once per distinct failure, not once per call. A fast-path copy
 * that exists but was unusable is a `warn` (stale/shadowing, #581); a plain
 * absence is `info` (normal on Bun-compiled hosts, #502).
 */
function reportResolutionEvent(
	failure: Pick<PiAiResolutionEvent, "entry" | "code" | "fastPathRoot">,
	recovered: PiAiResolutionEvent["recovered"],
	resolvedRoot: string | null,
	resolvedFile: string | null,
): void {
	const event: PiAiResolutionEvent = {
		at: new Date().toISOString(),
		entry: failure.entry,
		code: failure.code,
		fastPathRoot: failure.fastPathRoot,
		recovered,
		resolvedRoot,
		resolvedFile,
	};
	if (!recordResolutionEvent(event)) return;
	const data = {
		entry: event.entry,
		code: event.code,
		fastPathRoot: event.fastPathRoot,
		recovered: event.recovered,
		resolvedRoot: event.resolvedRoot,
		resolvedFile: event.resolvedFile,
	};
	if (failure.fastPathRoot === null) {
		loaderLog.info("pi-ai fast path unavailable; used fallback", data);
		return;
	}
	loaderLog.warn("pi-ai fast-path copy is unusable; used fallback", data);
}

/**
 * Loads an allow-listed pi-ai entry point, caching the resolved package root
 * per entry so repeated fallbacks (e.g. provider stream setup) do not re-probe
 * the disk. Per-entry rather than global: resolution is entry-aware (#581), so
 * one subpath's root must not pin another's.
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
		const code = (error as NodeJS.ErrnoException).code ?? "unknown";
		// The bare-specifier copy is what failed, so it is the diagnostic — and
		// a copy that exists but cannot serve the entry is the #581 shape.
		const failedFastPath =
			findPackageInNodeModules(THIS_FILE_DIR, PI_AI_SEGMENTS) ?? null;
		let root = resolvedPiAiRoots.get(entry);
		if (root === undefined) {
			root = resolvePiAiPackageRoot(THIS_FILE_DIR, { entry });
			if (root !== undefined) resolvedPiAiRoots.set(entry, root);
		}
		if (root !== undefined) {
			const entryFile = resolvePiAiEntryFile(root, entry);
			if (entryFile) {
				reportResolutionEvent(
					{ entry, code, fastPathRoot: failedFastPath },
					"on-disk",
					root,
					entryFile,
				);
				return (await import(pathToFileURL(entryFile).href)) as T;
			}
		}
		// Last resort: the self-contained vendored bundle — the ONLY working
		// source under Bun-compiled pi binaries, which resolve no bare
		// specifiers from external files at all (#502).
		const vendored = resolveVendoredPiAiEntryFile(entry);
		if (vendored) {
			reportResolutionEvent(
				{ entry, code, fastPathRoot: failedFastPath },
				"vendored",
				null,
				vendored,
			);
			return (await import(pathToFileURL(vendored).href)) as T;
		}
		reportResolutionEvent(
			{ entry, code, fastPathRoot: failedFastPath },
			"none",
			null,
			null,
		);
		throw error; // keep the original "Cannot find package ..." error
	}
}
