/**
 * Startup Timing — lightweight observability for pi-free's startup impact.
 *
 * Provides a small mark/measure API (monotonic `performance.now()` based) to
 * time the phases of `piFreeEntry` and, importantly, per-provider setup
 * duration. Produces a structured startup summary (total startup time,
 * per-provider timings sorted slowest-first, cache vs network counts, and
 * failures) that is logged once at the end of startup and surfaced via the
 * `/free-startup` command.
 *
 * Timing origin: the clock starts when THIS MODULE is first evaluated
 * (`MODULE_LOAD_ORIGIN`, captured at module scope). `index.ts` imports
 * `./lib/startup-timing.ts` before every provider module, and ES modules
 * evaluate imports depth-first in declaration order, so the origin precedes
 * the entire static module graph (all provider imports) as well as
 * `piFreeEntry`. `totalMs` therefore covers module-graph execution plus the
 * entry factory — the full cost pi-free adds to Pi's boot, not just the
 * factory. On extension reload the module is not re-evaluated, so the origin
 * remains the FIRST module load; see {@link beginStartup}.
 *
 * Design constraints:
 * - Zero/negligible overhead: everything is in-memory arithmetic on a
 *   monotonic clock. No I/O happens here.
 * - Best-effort: every public entry point swallows its own errors so a timing
 *   bug can never break or stall startup.
 * - No new runtime deps, no build step.
 */

import { createLogger } from "./logger.ts";

const _logger = createLogger("startup-timing");

/**
 * Monotonic timestamp of this module's first evaluation — the true start of
 * pi-free's impact on Pi boot (see file header). Captured at module scope so
 * it precedes the evaluation of every module imported after this one.
 */
const MODULE_LOAD_ORIGIN = performance.now();

// =============================================================================
// Types
// =============================================================================

export interface PhaseTiming {
	/** Phase name (e.g. "providers", "global-handlers"). */
	name: string;
	/** Wall-clock duration in milliseconds. */
	durationMs: number;
}

export interface ProviderTiming {
	/** Provider name (derived from the setup function name). */
	provider: string;
	/** Wall-clock setup duration in milliseconds. */
	durationMs: number;
	/** Whether the provider setup resolved without throwing. */
	success: boolean;
	/** Error message when {@link success} is false. */
	error?: string;
}

export interface SessionStartTiming {
	label: string;
	durationMs: number;
	success: boolean;
}

export interface ProviderCacheNetworkTiming {
	provider: string;
	cacheHits: number;
	networkFetches: number;
	networkSuccesses: number;
	networkFailures: number;
	networkMsTotal: number;
	/** Native refreshes cancelled via context.signal (expected — counted, never logged as errors). */
	aborts: number;
	/** Native fetches that returned 0 models and retained the previous list. */
	emptyRetains: number;
	/** Native refreshes that completed and published models. */
	refreshOks: number;
	/** Times the catalog was restored from Pi's models store. */
	restoredCount: number;
	/** Age (ms) of the store entry at the last restore. */
	storeAgeMs?: number;
	/** Model count of the most recent successful native refresh. */
	lastRefreshModelCount?: number;
}

export interface StartupSummary {
	/** Unique id for this startup run. */
	runId: string;
	/** ISO timestamp of when startup began. */
	startedAt: string;
	/**
	 * Total wall-clock time in milliseconds, measured from first module load
	 * (includes the static module graph, e.g. provider imports) through
	 * startup finalization.
	 */
	totalMs: number;
	/**
	 * Milliseconds between first module load and `beginStartup()` — i.e. the
	 * static module-graph evaluation time that the old timing used to miss.
	 * On extension reload the module is not re-evaluated, so this also covers
	 * the time since the original load.
	 */
	moduleGraphMs: number;
	/**
	 * True when this run is an extension reload: the module is not
	 * re-evaluated, so totalMs/moduleGraphMs measure time since the FIRST
	 * module load, which may be long before this run.
	 */
	reloaded: boolean;
	/** Named phases in the order they completed. */
	phases: PhaseTiming[];
	/** Per-provider timings, sorted slowest-first. */
	providers: ProviderTiming[];
	/** Number of provider cache entries observed by legacy/dynamic loaders. */
	cacheHits: number;
	/** Number of provider model lists fetched from the network. */
	networkFetches: number;
	/** Total milliseconds spent in network model fetches (best-effort). */
	networkMsTotal: number;
	/** Names of providers whose setup failed. */
	failures: string[];
	/** Cache/network attribution by provider. */
	cacheNetwork: ProviderCacheNetworkTiming[];
	/** Session-start handler timings, including work after startup finalization. */
	sessionStartHandlers: SessionStartTiming[];
	/** Detached session-start tasks that completed after their handler returned. */
	detachedSessionWork: SessionStartTiming[];
	/** Labels of failed session-start handlers or detached tasks. */
	sessionStartFailures: string[];
}

interface StartupState {
	runId: string;
	startedAt: string;
	/**
	 * Monotonic start timestamp (performance.now()). Always
	 * {@link MODULE_LOAD_ORIGIN}, so the total includes module-graph
	 * evaluation.
	 */
	start: number;
	/** Elapsed ms from module load to beginStartup(). */
	moduleGraphMs: number;
	/**
	 * True when this run is an extension reload: the module is not
	 * re-evaluated, so the origin (and thus totalMs/moduleGraphMs) measures
	 * time since the FIRST module load, which may be long before this run.
	 */
	reloaded: boolean;
	/** Total elapsed ms, filled in on finalize. */
	totalMs: number;
	finalized: boolean;
	phases: PhaseTiming[];
	/** Open (started but not ended) phases, keyed by name. */
	openPhases: Map<string, number>;
	providers: ProviderTiming[];
	cacheHits: number;
	networkFetches: number;
	networkMsTotal: number;
	cacheNetwork: Map<string, ProviderCacheNetworkTiming>;
	sessionStartHandlers: SessionStartTiming[];
	detachedSessionWork: SessionStartTiming[];
	sessionStartFailures: string[];
}

// =============================================================================
// Internal helpers
// =============================================================================

function monotonicNow(): number {
	// performance.now() is monotonic and available on Node >= 16 globally.
	return performance.now();
}

function makeRunId(): string {
	// CSPRNG-backed (Sonar S2245: avoid Math.random()). The ID is only a log
	// correlation tag, so the first 8 hex chars of a UUID are ample.
	return crypto.randomUUID().slice(0, 8);
}

function freshState(): StartupState {
	return {
		runId: makeRunId(),
		startedAt: new Date().toISOString(),
		start: MODULE_LOAD_ORIGIN,
		moduleGraphMs: 0,
		reloaded: false,
		totalMs: 0,
		finalized: false,
		phases: [],
		openPhases: new Map(),
		providers: [],
		cacheHits: 0,
		networkFetches: 0,
		networkMsTotal: 0,
		cacheNetwork: new Map(),
		sessionStartHandlers: [],
		detachedSessionWork: [],
		sessionStartFailures: [],
	};
}

// Module-level state. Always present so recording before beginStartup() is a
// harmless no-op relative to module load rather than a crash.
let _state: StartupState = freshState();
/** Number of beginStartup() calls; >1 means extension reloads occurred. */
let _startupRuns = 0;

function round(ms: number): number {
	return Math.max(0, Math.round(ms));
}

// =============================================================================
// Public API — lifecycle
// =============================================================================

/**
 * Begin (or reset) a startup timing run. Call at the very top of
 * `piFreeEntry`. Safe to call multiple times (e.g. on extension reload) —
 * each call starts a fresh run.
 *
 * The run's clock origin is always {@link MODULE_LOAD_ORIGIN} — the first
 * evaluation of this module — NOT the moment this function is called, so
 * `totalMs` includes the static module graph (provider imports) that runs
 * before `piFreeEntry`. On extension reload the module is not re-evaluated,
 * so the origin stays the first module load and `moduleGraphMs`/`totalMs`
 * additionally cover the time since then.
 */
export function beginStartup(): void {
	try {
		_startupRuns += 1;
		_state = freshState();
		_state.reloaded = _startupRuns > 1;
		_state.moduleGraphMs = round(monotonicNow() - MODULE_LOAD_ORIGIN);
	} catch (err) {
		_logger.warn("beginStartup failed", {
			error: err instanceof Error ? err.message : String(err),
		});
	}
}

/**
 * Finalize the current run, freezing the total elapsed time. Call at the end
 * of `piFreeEntry`. Idempotent within a run.
 */
export function finalizeStartup(): void {
	try {
		if (_state.finalized) return;
		_state.totalMs = round(monotonicNow() - _state.start);
		_state.finalized = true;
	} catch (err) {
		_logger.warn("finalizeStartup failed", {
			error: err instanceof Error ? err.message : String(err),
		});
	}
}

/**
 * Begin a fresh session_start metrics window without discarding startup data.
 * Pi can reuse an extension module across sessions, so these arrays must not
 * accumulate indefinitely or make `/free-startup` report an old session.
 */
export function beginSessionStart(): void {
	try {
		_state.sessionStartHandlers = [];
		_state.detachedSessionWork = [];
		_state.sessionStartFailures = [];
	} catch (err) {
		_logger.warn("beginSessionStart failed", {
			error: err instanceof Error ? err.message : String(err),
		});
	}
}

// =============================================================================
// Public API — phases
// =============================================================================

/**
 * Start a named phase. Pair with {@link endPhase} to time an async span.
 */
export function startPhase(name: string): void {
	try {
		_state.openPhases.set(name, monotonicNow());
	} catch {
		// best-effort
	}
}

/**
 * End a named phase started by {@link startPhase} and record its duration.
 * Ending an unstarted phase is a no-op.
 */
export function endPhase(name: string): void {
	try {
		const start = _state.openPhases.get(name);
		if (start === undefined) return;
		_state.openPhases.delete(name);
		_state.phases.push({ name, durationMs: round(monotonicNow() - start) });
	} catch {
		// best-effort
	}
}

/**
 * Time a synchronous function as a named phase and return its result.
 * The function's return value is passed through unchanged.
 */
export function measurePhase<T>(name: string, fn: () => T): T {
	startPhase(name);
	try {
		return fn();
	} finally {
		endPhase(name);
	}
}

// =============================================================================
// Public API — per-provider timing
// =============================================================================

/**
 * Time an async provider setup. Records wall-clock duration and
 * success/failure, then rethrows any error so callers (e.g.
 * `Promise.allSettled`) observe identical behavior to an unwrapped call.
 *
 * @param provider - Provider name for reporting.
 * @param work - A thunk returning the provider setup promise.
 */
export async function timeProvider<T>(
	provider: string,
	work: () => Promise<T>,
): Promise<T> {
	const start = monotonicNow();
	try {
		const result = await work();
		recordProvider(provider, round(monotonicNow() - start), true);
		return result;
	} catch (err) {
		recordProvider(provider, round(monotonicNow() - start), false, err);
		throw err;
	}
}

function recordProvider(
	provider: string,
	durationMs: number,
	success: boolean,
	err?: unknown,
): void {
	try {
		_state.providers.push({
			provider,
			durationMs,
			success,
			...(success
				? {}
				: { error: err instanceof Error ? err.message : String(err) }),
		});
	} catch {
		// best-effort
	}
}

// =============================================================================
// Public API — cache vs network (best-effort)
// =============================================================================

/**
 * Record that a provider's model list was served from the disk cache.
 */
function cacheNetworkEntry(provider: string): ProviderCacheNetworkTiming {
	let entry = _state.cacheNetwork.get(provider);
	if (!entry) {
		entry = {
			provider,
			cacheHits: 0,
			networkFetches: 0,
			networkSuccesses: 0,
			networkFailures: 0,
			networkMsTotal: 0,
			aborts: 0,
			emptyRetains: 0,
			refreshOks: 0,
			restoredCount: 0,
		};
		_state.cacheNetwork.set(provider, entry);
	}
	return entry;
}

export function recordCacheHit(provider?: string): void {
	try {
		_state.cacheHits += 1;
		if (provider) cacheNetworkEntry(provider).cacheHits += 1;
	} catch {
		// best-effort
	}
}

/** Record an attempted provider model-list network fetch, including failures. */
export function recordNetworkFetch(
	provider?: string,
	durationMs?: number,
	success = true,
): void {
	try {
		_state.networkFetches += 1;
		const duration =
			typeof durationMs === "number" && Number.isFinite(durationMs)
				? Math.max(0, durationMs)
				: 0;
		_state.networkMsTotal += duration;
		if (provider) {
			const entry = cacheNetworkEntry(provider);
			entry.networkFetches += 1;
			entry.networkMsTotal += duration;
			if (success) entry.networkSuccesses += 1;
			else entry.networkFailures += 1;
		}
	} catch {
		// best-effort
	}
}

// =============================================================================
// Public API — native refresh outcomes (M1, #437)
// =============================================================================

/** Record that a native refresh was cancelled by an aborted signal. */
export function recordNativeAbort(provider: string): void {
	try {
		cacheNetworkEntry(provider).aborts += 1;
	} catch {
		// best-effort
	}
}

/** Record that a native fetch returned 0 models and the previous list was retained. */
export function recordNativeEmptyRetain(provider: string): void {
	try {
		cacheNetworkEntry(provider).emptyRetains += 1;
	} catch {
		// best-effort
	}
}

/** Record a successful native refresh that published `modelCount` models. */
export function recordNativeRefreshOk(
	provider: string,
	modelCount: number,
): void {
	try {
		const entry = cacheNetworkEntry(provider);
		entry.refreshOks += 1;
		entry.lastRefreshModelCount = modelCount;
	} catch {
		// best-effort
	}
}

/** Record a catalog restore from Pi's models store, with the store entry age. */
export function recordNativeRestored(
	provider: string,
	storeAgeMs?: number,
): void {
	try {
		const entry = cacheNetworkEntry(provider);
		entry.restoredCount += 1;
		if (
			typeof storeAgeMs === "number" &&
			Number.isFinite(storeAgeMs) &&
			storeAgeMs > 0 // checkedAt=0 (corrupt entry) must not read as ~20k days
		) {
			entry.storeAgeMs = Math.round(storeAgeMs);
		}
	} catch {
		// best-effort
	}
}

/** Age threshold (ms) above which a restored store entry is flagged stale (M1 surface). */
export const STALE_STORE_FLAG_MS = 7 * 24 * 60 * 60 * 1000; // 7d — matches native-provider's warn threshold

function formatStoreAge(ageMs: number): string {
	const hours = Math.round(ageMs / (60 * 60 * 1000));
	if (hours >= 48) return `${Math.round(hours / 24)}d old`;
	return `${hours}h old`;
}

/**
 * Concise per-provider native-outcome flags (aborts, empty retains, stale
 * stores) for surfacing in `/free-startup` and `/pi-free-health`. Credential
 * free by construction — counters and ages only. (M1, #437)
 */
export function nativeRefreshFlags(s: StartupSummary): string[] {
	const flags: string[] = [];
	for (const entry of s.cacheNetwork) {
		const parts: string[] = [];
		if (entry.aborts > 0) {
			parts.push(`${entry.aborts} abort${entry.aborts > 1 ? "s" : ""}`);
		}
		if (entry.emptyRetains > 0) {
			parts.push(
				`${entry.emptyRetains} empty-retain${entry.emptyRetains > 1 ? "s" : ""}`,
			);
		}
		if (
			typeof entry.storeAgeMs === "number" &&
			entry.storeAgeMs >= STALE_STORE_FLAG_MS
		) {
			parts.push(`store ${formatStoreAge(entry.storeAgeMs)}`);
		}
		if (parts.length > 0) flags.push(`${entry.provider}: ${parts.join(", ")}`);
	}
	return flags;
}

export function recordSessionStartHandler(
	label: string,
	durationMs: number,
	success: boolean,
): void {
	try {
		_state.sessionStartHandlers.push({
			label,
			durationMs: round(durationMs),
			success,
		});
		if (!success) _state.sessionStartFailures.push(label);
	} catch {
		// best-effort
	}
}

export function recordDetachedSessionWork(
	label: string,
	durationMs: number,
	success: boolean,
): void {
	try {
		_state.detachedSessionWork.push({
			label,
			durationMs: round(durationMs),
			success,
		});
		if (!success) _state.sessionStartFailures.push(label);
	} catch {
		// best-effort
	}
}

// =============================================================================
// Public API — summary
// =============================================================================

/**
 * Build a structured summary of the current (or most recent) startup run.
 * Provider timings are sorted slowest-first.
 */
export function getStartupSummary(): StartupSummary {
	const totalMs = _state.finalized
		? _state.totalMs
		: round(monotonicNow() - _state.start);

	const providers = [..._state.providers].sort(
		(a, b) => b.durationMs - a.durationMs,
	);

	return {
		runId: _state.runId,
		startedAt: _state.startedAt,
		totalMs,
		moduleGraphMs: _state.moduleGraphMs,
		reloaded: _state.reloaded,
		phases: [..._state.phases],
		providers,
		cacheHits: _state.cacheHits,
		networkFetches: _state.networkFetches,
		networkMsTotal: round(_state.networkMsTotal),
		failures: _state.providers.filter((p) => !p.success).map((p) => p.provider),
		cacheNetwork: [..._state.cacheNetwork.values()].map((entry) => ({
			...entry,
			networkMsTotal: round(entry.networkMsTotal),
		})),
		sessionStartHandlers: [..._state.sessionStartHandlers].sort(
			(a, b) => b.durationMs - a.durationMs,
		),
		detachedSessionWork: [..._state.detachedSessionWork].sort(
			(a, b) => b.durationMs - a.durationMs,
		),
		sessionStartFailures: [..._state.sessionStartFailures],
	};
}

/**
 * Format the current startup summary as a human-readable, column-aligned
 * string suitable for `ctx.ui.notify`. Mirrors the style of `/free-providers`
 * and `/free-telemetry`.
 */
/** Render the phase block (slowest-first). Empty array when no phases. */
function renderPhaseLines(phases: PhaseTiming[]): string[] {
	if (phases.length === 0) {
		return [];
	}
	const sorted = [...phases].sort((a, b) => b.durationMs - a.durationMs);
	const lines = ["Phases:"];
	for (const p of sorted) {
		lines.push(`  ${p.name.padEnd(20)} ${String(p.durationMs).padStart(6)}ms`);
	}
	lines.push("");
	return lines;
}

/** Render the per-provider block (slowest-first, capped). Empty when none. */
function renderProviderLines(
	providers: ProviderTiming[],
	maxProviders: number,
): string[] {
	if (providers.length === 0) {
		return [];
	}
	const lines = ["Providers (slowest first):"];
	for (const p of providers.slice(0, maxProviders)) {
		const name =
			p.provider.length > 24 ? p.provider.slice(0, 21) + "..." : p.provider;
		const status = p.success ? "ok" : "FAILED";
		lines.push(
			`  ${name.padEnd(24)} ${String(p.durationMs).padStart(6)}ms  ${status}`,
		);
	}
	if (providers.length > maxProviders) {
		lines.push(`  …and ${providers.length - maxProviders} more`);
	}
	lines.push("");
	return lines;
}

export function formatStartupSummary(maxProviders = 15): string {
	const s = getStartupSummary();
	const lines: string[] = [
		`⏱  Pi-Free Startup: ${s.totalMs}ms (run ${s.runId})`,
		`   Measured from first module load — includes module graph (${s.moduleGraphMs}ms) + entry factory` +
			(s.reloaded
				? " (RELOADED: origin is the first module load, so this total includes time since then)"
				: ""),
		"",
		...renderPhaseLines(s.phases),
		...renderProviderLines(s.providers, maxProviders),
		`Cache: ${s.cacheHits} entries / ${s.networkFetches} network fetches` +
			(s.networkMsTotal > 0 ? ` (${s.networkMsTotal}ms)` : ""),
	];

	if (s.cacheNetwork.length > 0) {
		lines.push("Cache/network by provider:");
		for (const entry of s.cacheNetwork) {
			lines.push(
				`  ${entry.provider}: cache ${entry.cacheHits}, network ${entry.networkFetches} (${entry.networkSuccesses} ok, ${entry.networkFailures} failed, ${entry.networkMsTotal}ms)`,
			);
			if (entry.restoredCount > 0 || entry.refreshOks > 0) {
				lines.push(
					`    native: restored ${entry.restoredCount}, refresh ok ${entry.refreshOks} (${entry.lastRefreshModelCount ?? 0} models)` +
						(typeof entry.storeAgeMs === "number"
							? `, store ${formatStoreAge(entry.storeAgeMs)}`
							: ""),
				);
			}
		}
		lines.push("");
	}

	const outcomeFlags = nativeRefreshFlags(s);
	if (outcomeFlags.length > 0) {
		lines.push("Native refresh flags:");
		for (const flag of outcomeFlags) lines.push(`  ${flag}`);
		lines.push("");
	}

	const renderSession = (title: string, timings: SessionStartTiming[]) => {
		if (timings.length === 0) return;
		lines.push(`${title}:`);
		for (const timing of timings.slice(0, maxProviders)) {
			lines.push(
				`  ${timing.label.padEnd(28)} ${String(timing.durationMs).padStart(6)}ms  ${timing.success ? "ok" : "FAILED"}`,
			);
		}
		lines.push("");
	};
	renderSession("Session_start handlers", s.sessionStartHandlers);
	renderSession("Detached session_start work", s.detachedSessionWork);

	if (s.failures.length > 0 || s.sessionStartFailures.length > 0) {
		lines.push(
			`Failures: ${[...s.failures, ...s.sessionStartFailures].join(", ")}`,
		);
	}

	return lines.join("\n");
}

/**
 * Log the startup summary: a single structured info line plus per-provider
 * debug detail. Called once at the end of `piFreeEntry`.
 */
export function logStartupSummary(): void {
	try {
		const s = getStartupSummary();
		_logger.info(
			`[pi-free] startup complete in ${s.totalMs}ms (from first module load; module graph ${s.moduleGraphMs}ms)`,
			{
				runId: s.runId,
				totalMs: s.totalMs,
				moduleGraphMs: s.moduleGraphMs,
				origin: "first-module-load",
				providers: s.providers.length,
				cacheHits: s.cacheHits,
				networkFetches: s.networkFetches,
				networkMsTotal: s.networkMsTotal,
				cacheNetwork: s.cacheNetwork,
				sessionStartHandlers: s.sessionStartHandlers,
				detachedSessionWork: s.detachedSessionWork,
				failures: [...s.failures, ...s.sessionStartFailures],
				slowest: s.providers.slice(0, 5).map((p) => ({
					provider: p.provider,
					durationMs: p.durationMs,
					success: p.success,
				})),
			},
		);

		// Per-provider debug detail (only written to ~/.pi/free.log by default).
		for (const p of s.providers) {
			_logger.debug(`[pi-free] provider setup: ${p.provider}`, {
				durationMs: p.durationMs,
				success: p.success,
				...(p.error ? { error: p.error } : {}),
			});
		}
	} catch (err) {
		_logger.warn("logStartupSummary failed", {
			error: err instanceof Error ? err.message : String(err),
		});
	}
}
