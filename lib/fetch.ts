/**
 * Fetch primitives with retry, timeout, and deadline helpers.
 *
 * Split out of lib/util.ts (arch lifecycle review): this module owns
 * everything that touches the network. Model mapping/filtering lives
 * in lib/model-map.ts; lib/util.ts re-exports both so existing
 * importers are untouched.
 */

import { createLogger } from "./logger.ts";

// Kept as "util" so established `~/.pi/free.log` namespaces are unchanged.
const _logger = createLogger("util");

// =============================================================================
// Shared Utilities
// =============================================================================

/** Async sleep helper — avoids creating anonymous functions in loops */
export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Log a warning message for provider operations
 */
export function logWarning(
	provider: string,
	message: string,
	error?: unknown,
): void {
	_logger.warn(
		`[${provider}] ${message}`,
		error ? { error: String(error) } : undefined,
	);
}

/**
 * Fetch with timeout using AbortController
 */
export async function fetchWithTimeout(
	url: string,
	options: RequestInit,
	timeoutMs = 30000,
): Promise<Response> {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
	const upstreamSignal = options.signal;
	const abortFromUpstream = () => controller.abort(upstreamSignal?.reason);

	if (upstreamSignal?.aborted) {
		abortFromUpstream();
	} else {
		upstreamSignal?.addEventListener("abort", abortFromUpstream, {
			once: true,
		});
	}

	try {
		return await fetch(url, {
			...options,
			signal: controller.signal,
		});
	} finally {
		clearTimeout(timeoutId);
		upstreamSignal?.removeEventListener("abort", abortFromUpstream);
	}
}

/**
 * Upper bound for a single retry backoff sleep. Caps the exponential
 * growth so a degraded gateway cannot park the detached refresh lane
 * for tens of seconds per fetch (finding: arch lifecycle review).
 */
export const MAX_RETRY_BACKOFF_MS = 10_000;

/**
 * Jittered exponential backoff for `fetchWithRetry` (AWS "full jitter"
 * style): `random(0, min(base * 2^attempt, cap))`.
 *
 * The old linear `delayMs * (i + 1)` made concurrent refreshes — the three
 * built-in-tier catalog fetches plus every native provider refresh that
 * fires on the same session_start — retry in lockstep against the same
 * gateways after a blip (thundering herd). Full jitter decorrelates them
 * while keeping the expected sleep under the old linear value for the
 * first attempts. Pure and exported for unit testing.
 */
export function computeRetryBackoffMs(
	attempt: number,
	baseDelayMs: number,
	options: { capMs?: number; random?: () => number } = {},
): number {
	const { capMs = MAX_RETRY_BACKOFF_MS, random = Math.random } = options;
	const safeAttempt = Number.isFinite(attempt) && attempt > 0 ? attempt : 0;
	const safeBase =
		Number.isFinite(baseDelayMs) && baseDelayMs > 0 ? baseDelayMs : 0;
	const cap =
		Number.isFinite(capMs) && capMs > 0 ? Math.min(capMs, MAX_RETRY_BACKOFF_MS) : MAX_RETRY_BACKOFF_MS;
	return random() * Math.min(safeBase * 2 ** safeAttempt, cap);
}

/**
 * Fetch with retry logic and timeout
 */
export async function fetchWithRetry(
	url: string,
	options: RequestInit,
	retries = 3,
	delayMs = 1000,
	timeoutMs = 30000,
): Promise<Response> {
	let lastError: unknown;

	for (let i = 0; i < retries; i++) {
		try {
			const response = await fetchWithTimeout(url, options, timeoutMs);
			if (response.ok) return response;

			// If it's a rate limit, throw immediately
			if (response.status === 429) {
				throw new Error(`Rate limited (429)`);
			}

			// For server errors, retry with jittered exponential backoff.
			if (response.status >= 500) {
				lastError = new Error(`Server error ${response.status}`);
				if (i < retries - 1) {
					await sleep(computeRetryBackoffMs(i, delayMs));
					continue;
				}
				// Last retry exhausted - throw the error
				throw lastError;
			}

			return response; // Return non-ok but non-retryable responses
		} catch (error) {
			lastError = error;
		if (options.signal?.aborted) throw error;
		if (i < retries - 1) {
				await sleep(computeRetryBackoffMs(i, delayMs));
			}
		}
	}

	throw lastError;
}

/**
 * Race a promise against a wall-clock deadline.
 *
 * Used to bound how long startup model-list fetches may block the extension
 * factory. If the deadline fires first, the returned promise rejects with a
 * timeout error so callers fall back to their stale cache (or an empty list).
 *
 * The underlying promise is NOT cancelled — it keeps running until its own
 * internal timeout/abort closes the socket — but we stop waiting on it. This
 * is intentional: a model-list fetch that outlives the deadline simply has its
 * result discarded, and the next session_start retries. The timer is always
 * cleared on settlement so it never holds the event loop open.
 *
 * A non-positive or non-finite `timeoutMs` disables the deadline (passthrough).
 */
export function withFetchDeadline<T>(
	promise: Promise<T>,
	timeoutMs: number,
	label = "fetch",
): Promise<T> {
	if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;

	let timer: ReturnType<typeof setTimeout> | undefined;
	const deadline = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(
			() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
			timeoutMs,
		);
	});

	return Promise.race([promise, deadline]).finally(() => {
		if (timer !== undefined) clearTimeout(timer);
	}) as Promise<T>;
}

// =============================================================================
// Shared API Response Parsing
// =============================================================================

/**
 * Parse and validate model list API response
 * Shared between Kilo, OpenRouter, and other providers
 */
export async function parseModelResponse<T>(
	response: Response,
	providerName: string,
): Promise<{ data: T[] }> {
	if (!response.ok) {
		throw new Error(
			`Failed to fetch ${providerName} models: ${response.status} ${response.statusText}`,
		);
	}

	const json = (await response.json()) as { data?: T[] };

	if (!json.data || !Array.isArray(json.data)) {
		throw new Error(
			`Invalid ${providerName} models response: missing data array`,
		);
	}

	return { data: json.data };
}
