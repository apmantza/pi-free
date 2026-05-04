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

const _quotaState = new Map<string, QuotaSnapshot>();

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
export function extractQuota(
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
 * Process an after_provider_response event, updating quota state.
 * Call from the event handler in index.ts.
 */
export function processQuotaResponse(
	providerId: string,
	headers: Record<string, string>,
): void {
	const extracted = extractQuota(headers);
	if (!extracted) return;

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
 * Get the latest quota snapshot for a provider, or null if unknown.
 */
export function getQuota(providerId: string): QuotaSnapshot | null {
	return _quotaState.get(providerId) ?? null;
}

/**
 * Get all tracked quotas.
 */
export function getAllQuotas(): ReadonlyMap<string, QuotaSnapshot> {
	return _quotaState;
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
