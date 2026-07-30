/**
 * Startup Timing — lightweight observability for pi-free's startup impact.
 *
 * Provides a small mark/measure API (monotonic `performance.now()` based) to
 * time the phases of `piFreeEntry` and, importantly, per-provider setup
 * duration. Produces a structured startup summary (total entry time,
 * per-provider timings sorted slowest-first, cache vs network counts, and
 * failures) that is logged once at the end of startup and surfaced via the
 * `/free-startup` command.
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

export interface StartupSummary {
	/** Unique id for this startup run. */
	runId: string;
	/** ISO timestamp of when startup began. */
	startedAt: string;
	/** Total wall-clock time of the timed startup, in milliseconds. */
	totalMs: number;
	/** Named phases in the order they completed. */
	phases: PhaseTiming[];
	/** Per-provider timings, sorted slowest-first. */
	providers: ProviderTiming[];
	/** Number of provider model lists served from the disk cache. */
	cacheHits: number;
	/** Number of provider model lists fetched from the network. */
	networkFetches: number;
	/** Total milliseconds spent in network model fetches (best-effort). */
	networkMsTotal: number;
	/** Names of providers whose setup failed. */
	failures: string[];
}

interface StartupState {
	runId: string;
	startedAt: string;
	/** Monotonic start timestamp (performance.now()). */
	start: number;
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
		start: monotonicNow(),
		totalMs: 0,
		finalized: false,
		phases: [],
		openPhases: new Map(),
		providers: [],
		cacheHits: 0,
		networkFetches: 0,
		networkMsTotal: 0,
	};
}

// Module-level state. Always present so recording before beginStartup() is a
// harmless no-op relative to module load rather than a crash.
let _state: StartupState = freshState();

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
 */
export function beginStartup(): void {
	try {
		_state = freshState();
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
export function recordCacheHit(_provider?: string): void {
	try {
		_state.cacheHits += 1;
	} catch {
		// best-effort
	}
}

/**
 * Record that a provider's model list was fetched from the network.
 * @param durationMs - Optional fetch duration in milliseconds.
 */
export function recordNetworkFetch(_provider?: string, durationMs?: number): void {
	try {
		_state.networkFetches += 1;
		if (typeof durationMs === "number" && Number.isFinite(durationMs)) {
			_state.networkMsTotal += Math.max(0, durationMs);
		}
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
		phases: [..._state.phases],
		providers,
		cacheHits: _state.cacheHits,
		networkFetches: _state.networkFetches,
		networkMsTotal: round(_state.networkMsTotal),
		failures: _state.providers.filter((p) => !p.success).map((p) => p.provider),
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
		"",
		...renderPhaseLines(s.phases),
		...renderProviderLines(s.providers, maxProviders),
		`Cache: ${s.cacheHits} hits / ${s.networkFetches} network fetches` +
			(s.networkMsTotal > 0 ? ` (${s.networkMsTotal}ms)` : ""),
	];

	if (s.failures.length > 0) {
		lines.push(`Failures: ${s.failures.join(", ")}`);
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
			`[pi-free] startup complete in ${s.totalMs}ms`,
			{
				runId: s.runId,
				totalMs: s.totalMs,
				providers: s.providers.length,
				cacheHits: s.cacheHits,
				networkFetches: s.networkFetches,
				networkMsTotal: s.networkMsTotal,
				failures: s.failures,
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
