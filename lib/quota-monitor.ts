/**
 * Quota Monitoring for pi-free providers.
 *
 * Subscribes to pi's `after_provider_response` event to extract rate-limit
 * headers from provider responses and track remaining quota per provider.
 *
 * Inspired by free-coding-models' extractQuotaPercent and provider-quota-fetchers.
 *
 * Supported header formats (tried in order):
 *   1. x-ratelimit-remaining-requests / x-ratelimit-limit-requests (SambaNova)
 *   2. x-ratelimit-remaining / x-ratelimit-limit (Mistral, others)
 *   3. ratelimit-remaining-requests / ratelimit-limit-requests
 *   4. ratelimit-remaining / ratelimit-limit
 *   5. x-ratelimit-remaining-requests-day / x-ratelimit-limit-requests-day (SambaNova daily)
 */

import { createLogger } from "./logger.ts";

const _logger = createLogger("quota-monitor");

const _quotaState = new Map<string, QuotaSnapshot>();

/** Per-provider response outcome counters (M2 + Mn3, #437). */
export interface ProviderResponseCounters {
	/** 401 and 403 responses (auth failures). */
	authFailures: number;
	/** 429 responses (rate limited). */
	rateLimited: number;
	/** 5xx responses (gateway/server errors). */
	serverErrors: number;
	/** Responses carrying rate-limit headers none of which matched a known format. */
	quotaHeaderDrift: number;
}

const _responseCounters = new Map<string, ProviderResponseCounters>();

function responseCountersEntry(providerId: string): ProviderResponseCounters {
	let entry = _responseCounters.get(providerId);
	if (!entry) {
		entry = {
			authFailures: 0,
			rateLimited: 0,
			serverErrors: 0,
			quotaHeaderDrift: 0,
		};
		_responseCounters.set(providerId, entry);
	}
	return entry;
}

/** Snapshot of quota state for a single provider. */
export interface QuotaSnapshot {
	/** Requests remaining in the current window. */
	remaining: number;
	/** Total requests allowed in the current window. */
	limit: number;
	/** Remaining as percentage 0–100. */
	percent: number;
	/** Timestamp (Date.now()) when this snapshot was captured. */
	lastUpdated: number;
	/** Which header variant was matched (for debugging). */
	source: string;
}

// Header key pairs to try, in priority order.
// Each pair is [remaining, limit].
const HEADER_PAIRS: [string, string][] = [
	// Per-minute (most common)
	["x-ratelimit-remaining-requests", "x-ratelimit-limit-requests"],
	["x-ratelimit-remaining", "x-ratelimit-limit"],
	["ratelimit-remaining-requests", "ratelimit-limit-requests"],
	["ratelimit-remaining", "ratelimit-limit"],
	// Per-day
	["x-ratelimit-remaining-requests-day", "x-ratelimit-limit-requests-day"],
	["x-ratelimit-remaining-day", "x-ratelimit-limit-day"],
];

/**
 * Attempt to extract quota from response headers.
 * Returns { remaining, limit, source } or null if no quota headers found.
 */
function extractQuota(
	headers: Record<string, string>,
): { remaining: number; limit: number; source: string } | null {
	// Normalize keys to lowercase for case-insensitive matching.
	// Some proxies/servers vary header casing.
	const normalized: Record<string, string> = {};
	for (const [key, value] of Object.entries(headers)) {
		normalized[key.toLowerCase()] = value;
	}

	for (const [remainingKey, limitKey] of HEADER_PAIRS) {
		const remaining = Number.parseFloat(normalized[remainingKey]);
		const limit = Number.parseFloat(normalized[limitKey]);
		if (Number.isFinite(remaining) && Number.isFinite(limit) && limit > 0) {
			return { remaining, limit, source: remainingKey };
		}
	}

	return null;
}

/**
 * Process an after_provider_response event, updating quota state and the
 * per-provider response-outcome counters (M2, #437).
 *
 * The status feeds 401/403 (auth failure), 429 (rate limit) and 5xx (server
 * error) counters — counts only, never response bodies. Mn3: when rate-limit
 * headers are present but none matched a known pair (header-format drift), a
 * per-provider drift counter is bumped and the mismatch is debug-logged.
 */
export function processQuotaResponse(
	providerId: string,
	status: number,
	headers: Record<string, string>,
): void {
	const counters = responseCountersEntry(providerId);
	if (status === 401 || status === 403) {
		counters.authFailures += 1;
	} else if (status === 429) {
		counters.rateLimited += 1;
	} else if (status >= 500 && status < 600) {
		counters.serverErrors += 1;
	}

	const extracted = extractQuota(headers);
	if (!extracted) {
		// Mn3: rate-limit headers present but none matched a known pair. Only
		// count as drift when BOTH halves of a quota pair appear to exist but
		// no known format matched — a remaining-only or limit-only header is a
		// legitimate half-signal, not a format drift.
		const keys = Object.keys(headers).map((k) => k.toLowerCase());
		const hasRemaining = keys.some((k) => /remaining|remaining-requests/.test(k));
		const hasLimit = keys.some((k) => /(^|-)limit/.test(k));
		if (hasRemaining && hasLimit) {
			counters.quotaHeaderDrift += 1;
			_logger.debug(`Quota headers present but none matched for ${providerId}`, {
				provider: providerId,
				status,
				presentKeys: keys,
			});
		}
		return;
	}

	const percent = Math.round((extracted.remaining / extracted.limit) * 100);

	_quotaState.set(providerId, {
		remaining: extracted.remaining,
		limit: extracted.limit,
		percent: Math.max(0, Math.min(100, percent)),
		lastUpdated: Date.now(),
		source: extracted.source,
	});
}

/**
 * Get the response-outcome counters for a provider, or null if none recorded.
 */
export function getResponseCounters(
	providerId: string,
): ProviderResponseCounters | null {
	return _responseCounters.get(providerId) ?? null;
}

/**
 * Get all tracked response-outcome counters.
 */
export function getAllResponseCounters(): ReadonlyMap<
	string,
	ProviderResponseCounters
> {
	return _responseCounters;
}

/**
 * Get the latest quota snapshot for a provider, or null if unknown.
 */
export function getQuota(providerId: string): QuotaSnapshot | null {
	return _quotaState.get(providerId) ?? null;
}

/**
 * Build a human-readable status bar line for a provider's quota.
 * Returns undefined if no quota data is available.
 */
export function formatQuotaStatus(providerId: string): string | undefined {
	const q = _quotaState.get(providerId);
	if (!q) return undefined;

	// Stale after 5 minutes
	if (Date.now() - q.lastUpdated > 5 * 60 * 1000) return undefined;

	if (q.percent <= 10)
		return `⚠️ ${providerId}: ${q.remaining}/${q.limit} (${q.percent}%)`;
	if (q.percent <= 25)
		return `⚡ ${providerId}: ${q.remaining}/${q.limit} (${q.percent}%)`;
	return `${providerId}: ${q.remaining}/${q.limit} (${q.percent}%)`;
}
