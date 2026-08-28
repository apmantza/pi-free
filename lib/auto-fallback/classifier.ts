/**
 * Error classification for auto-fallback.
 *
 * Decides whether an observed failure should trigger a model switch.
 *
 * Two input surfaces:
 *   - HTTP status code (from `after_provider_response`) — header + status only,
 *     never response body (wire-signature convention #17 / #437).
 *   - errorMessage string (from `message_end.message.errorMessage`) — Pi's
 *     pi-ai composes this into a free-text summary; today the AssistantMessage
 *     carries no structured status code (issue earendil-works/pi #7234).
 *
 * Regex tables mirror `@earendil-works/pi-ai`'s `src/utils/retry.ts`
 * (NON_RETRYABLE_PROVIDER_LIMIT_ERROR_PATTERN, RETRYABLE_PROVIDER_ERROR_PATTERN)
 * so the extension stays consistent with Pi's own retry classifier. We do
 * NOT import `isRetryableAssistantError` at runtime: AGENTS.md convention 16
 * forbids static pi-ai imports at startup, and the function is not exported
 * via the package's `exports` map (`./utils/*` is not exposed — see sub-agent
 * verification, only the bare `@earendil-works/pi-ai` root re-exports it).
 * If pi-ai's regexes ever diverge from these tables, this file is the single
 * point to update.
 */

/**
 * HTTP status codes that trigger auto-fallback.
 *
 * Recoverable: the next model attempt may succeed (transient or quota).
 * Unrecoverable: switching to another model would hit the same error
 * (auth, malformed request, model not found). These must NOT trigger
 * fallback — they would only burn through candidates for no gain.
 * Unknown: signal is ambiguous; treat as recoverable by default so quota
 * problems don't get hidden behind "we don't recognize this status".
 */
export type FailureKind = "recoverable" | "unrecoverable" | "unknown";

const RECOVERABLE_HTTP_STATUSES = new Set<number>([
	402, // Payment Required — usually "quota used up" on free tiers
	408, // Request Timeout
	409, // Conflict — server-side state issue, may be transient
	425, // Too Early
	429, // Too Many Requests — explicit rate limit signal
	500, // Internal Server Error
	502, // Bad Gateway
	503, // Service Unavailable
	504, // Gateway Timeout
	507, // Insufficient Storage (rare but transient on free tiers)
	521, // Cloudflare: Web Server Is Down
	522, // Cloudflare: Connection Timed Out
	523, // Cloudflare: Origin Is Unreachable
	524, // Cloudflare: A Timeout Occurred
	525, // Cloudflare: SSL Handshake Failed
	526, // Cloudflare: Invalid SSL Certificate
	527, // Cloudflare: Railgun Error
	529, // Anthropic: Overloaded
]);

const UNRECOVERABLE_HTTP_STATUSES = new Set<number>([
	400, // Bad Request — request shape is wrong; switching model won't fix it
	401, // Unauthorized — auth missing/expired; setModel will fail the same way
	403, // Forbidden — auth OK but policy denial; not transient
	404, // Not Found — model id gone; blacklist the model id (not the provider)
	405, // Method Not Allowed
	406, // Not Acceptable
	410, // Gone — model permanently removed
	415, // Unsupported Media Type
	418, // I'm a teapot (RFC 2324; not transient)
	422, // Unprocessable Entity — semantic validation failure
	451, // Unavailable For Legal Reasons
]);

/**
 * Classify an HTTP status code seen on `after_provider_response`.
 *
 * @param status - HTTP status code (e.g. 200, 429, 500).
 * @returns Whether a model switch should be considered.
 */
export function classifyHttpStatus(status: number): FailureKind {
	if (RECOVERABLE_HTTP_STATUSES.has(status)) return "recoverable";
	if (UNRECOVERABLE_HTTP_STATUSES.has(status)) return "unrecoverable";
	// 1xx, 2xx, 3xx should not reach here (we only fire on error events),
	// but treat anything we don't recognize as recoverable — better to
	// over-fallback than to silently let a real outage persist.
	return "unknown";
}

/**
 * Provider-limit / quota errors that Pi's retry classifier marks as
 * NON-retryable. We treat them as recoverable for OUR purposes: the
 * upstream Pi retry cannot recover from "out of credits", but switching
 * to a different provider can. The two classifications are complementary,
 * not contradictory.
 *
 * Source: `packages/ai/src/utils/retry.ts` (pi-mono v0.84.3).
 */
const PROVIDER_LIMIT_ERROR_PATTERN =
	/(?:go\s*usage\s*limit\s*error|free\s*usage\s*limit\s*error|monthly\s*usage\s*limit\s*reached|available\s*balance|insufficient[_\s-]?quota|out\s+of\s+budget|quota\s+exceeded|billing)/i;

/**
 * Transient errors that Pi's retry classifier marks as retryable — also
 * valid signals for auto-fallback. Same source as above.
 */
const TRANSIENT_ERROR_PATTERN =
	/(?:overloaded|rate[\s-]?limit|too\s+many\s+requests|429|500|502|503|504|524|service[\s-]?unavailable|server[\s-]?error|internal[\s-]?error|fetch\s+failed|enotfound|eai_again|socket\s+hang\s+up|timed?\s*out|timeout|premature\s+close|stream\s+ended\s+before|http2\s+request\s+did\s+not\s+get\s+a_response|resourcelexexhausted)/i;

/**
 * Non-retryable, non-recoverable errors — Pi's classifier rejects these,
 * and a model switch would hit the same wall (auth, policy, bad input).
 */
const FATAL_ERROR_PATTERN =
	/(?:invalid[_ -]?api[_ -]?key|invalid[_ -]?request|context[_ -]?length[_ -]?exceeded|model[_ -]?not[_ -]?found|permission[_ -]?denied|unauthorized|forbidden)/i;

/**
 * Classify an errorMessage string seen on `message_end.message`.
 *
 * Returns the FIRST matching pattern class. Order matters:
 * 1. Fatal (clearly unrecoverable — don't waste fallback attempts)
 * 2. Provider limit (recoverable — switch provider)
 * 3. Transient (recoverable — Pi may retry; we may also switch)
 * 4. null = no signal (e.g., empty errorMessage)
 *
 * Per AGENTS.md convention 17: we read the errorMessage TEXT only when it
 * arrives on `message_end.message` (Pi-composed, already in the session
 * transcript); we never read response bodies from `after_provider_response`.
 */
export function classifyErrorMessage(
	errorMessage: string | undefined,
): FailureKind | null {
	if (!errorMessage) return null;
	if (FATAL_ERROR_PATTERN.test(errorMessage)) return "unrecoverable";
	if (PROVIDER_LIMIT_ERROR_PATTERN.test(errorMessage)) return "recoverable";
	if (TRANSIENT_ERROR_PATTERN.test(errorMessage)) return "recoverable";
	return null;
}

/**
 * Combined classification from `message_end` event.
 *
 * The AssistantMessage exposes `stopReason` and `errorMessage`. Pi's own
 * retry mechanism classifies this as retryable/non-retryable using only
 * those two fields (and a regex on errorMessage). For auto-fallback we
 * also want to know whether the failure is the kind a model switch can
 * recover from — same regex family, but our decision differs:
 *
 *   - "error" + recoverable errorMessage → switch
 *   - "error" + unrecoverable errorMessage → count toward blacklist, do NOT switch
 *   - "aborted" + recoverable errorMessage → see {@link classifyAbort}
 *   - "aborted" + unrecoverable/unknown → user-initiated cancel, do not switch
 *   - "stop" / "length" / "toolUse" / "deferred" → not a failure
 *
 * @returns FailureKind if this represents a fallback trigger; null otherwise.
 */
export function classifyAssistantFailure(
	stopReason: string | undefined,
	errorMessage: string | undefined,
): FailureKind | null {
	if (stopReason !== "error" && stopReason !== "aborted") return null;
	const classified = classifyErrorMessage(errorMessage);
	// stopReason === "aborted" without a known error class is treated as
	// user-initiated (Q23 abort heuristic — refined by classifyAbort() when
	// combined with the last observed HTTP status).
	if (stopReason === "aborted" && classified === null) return null;
	return classified ?? "unknown";
}

/**
 * Refine an "aborted" classification using the most recent observed HTTP
 * status. Implements Q23=B:
 *
 *   - aborted + last status >= 500 → recoverable (server killed mid-flight)
 *   - aborted + last status 4xx    → unrecoverable (request was bad, user
 *                                       pressed esc; nothing to switch to)
 *   - aborted + no last status     → null (treat as user-initiated)
 *
 * Callers must pass `lastStatus` from their most recent `after_provider_response`
 * observation for the same (provider, model) — typically tracked in a small
 * side-channel (the `fallback-state` store) so it survives the gap between the
 * two events.
 */
export function classifyAbort(
	lastHttpStatus: number | undefined,
): FailureKind | null {
	if (lastHttpStatus === undefined) return null;
	if (lastHttpStatus >= 500 && lastHttpStatus < 600) return "recoverable";
	if (lastHttpStatus >= 400 && lastHttpStatus < 500) return "unrecoverable";
	return null;
}