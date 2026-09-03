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
 * Error-message classification delegates to pi-ai's own
 * `isRetryableAssistantError` (re-exported from the bare
 * `@earendil-works/pi-ai` root — `dist/index.js` does
 * `export * from "./utils/retry.js"`), loaded lazily via
 * `lib/pi-ai-loader.ts`'s single-flight loader (convention #16 forbids
 * startup compat imports; this runs on the failure path only, never at
 * startup). Delegating keeps our classifier in lockstep with Pi's own retry
 * semantics instead of mirroring regex tables that drift.
 *
 * Complementary, not contradictory, to pi-ai's classifier: pi-ai marks
 * provider-limit/quota errors NON-retryable because same-model retry cannot
 * recover from "out of credits" — but switching to a different provider can,
 * so we treat quota errors as recoverable for fallback purposes.
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
import { loadPiAiEntry } from "../pi-ai-loader.ts";

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
 * Errors that are unrecoverable for FALLBACK purposes — a model switch
 * would hit the same wall (auth, policy, bad input). These are pi-free's
 * own additions, NOT part of pi-ai's retry classifier (pi-ai only decides
 * retry-vs-give-up for the same model; we decide switch-vs-stay).
 */
const FATAL_ERROR_PATTERN =
	/(?:invalid[_ -]?api[_ -]?key|invalid[_ -]?request|context[_ -]?length[_ -]?exceeded|model[_ -]?not[_ -]?found|permission[_ -]?denied|unauthorized|forbidden)/i;

/**
 * The lazily-loaded pi-ai retry classifier (single-flight via
 * `lib/pi-ai-loader.ts`). Undefined until the first failure loads it; a
 * failed load falls back to pi-free's local tables below, so classification
 * never blocks on pi-ai availability.
 */
type PiAiRetryModule = {
	isRetryableAssistantError: (message: {
		stopReason?: string;
		errorMessage?: string;
	}) => boolean;
};
let piAiRetryModule: PiAiRetryModule | undefined;
let piAiRetryLoadAttempted = false;

async function loadPiAiRetryClassifier(): Promise<PiAiRetryModule | undefined> {
	if (piAiRetryLoadAttempted) return piAiRetryModule;
	piAiRetryLoadAttempted = true;
	try {
		// SAFETY: pi-ai's `compat` entry (a strict superset of the bare root)
		// re-exports utils/retry (`dist/index.js` does
		// `export * from "./utils/retry.js"`), but its shape isn't in our
		// type scope; the invariant is enforced right after the import by a
		// `typeof fn === "function"` check — anything else leaves
		// piAiRetryModule undefined and classification falls back to the
		// local tables. The vendored last-resort bundle does not carry this
		// helper, so Bun-binary hosts take the local tables as well.
		const mod = await loadPiAiEntry<Record<string, unknown>>("compat");
		const fn = mod.isRetryableAssistantError;
		if (typeof fn === "function") {
			piAiRetryModule = {
				isRetryableAssistantError:
					fn as PiAiRetryModule["isRetryableAssistantError"],
			};
		}
	} catch {
		// pi-ai unavailable (headless edge case) — local tables take over.
	}
	return piAiRetryModule;
}

/**
 * Local fallback tables, used only if pi-ai's classifier cannot load.
 * Kept minimal: they mirror the SHAPE of pi-ai's classification (fatal →
 * unrecoverable, provider-limit/transient → recoverable) but only as a
 * degraded mode — the authoritative tables live in pi-ai.
 */
const PROVIDER_LIMIT_ERROR_PATTERN =
	/(?:usage\s*limit\s*error|monthly\s*usage\s*limit\s*reached|available\s*balance|insufficient[_\s-]?quota|out\s+of\s+budget|quota\s+exceeded|billing)/i;

const TRANSIENT_ERROR_PATTERN =
	/(?:overloaded|rate[\s-]?limit|too\s+many\s+requests|429|500|502|503|504|524|service[\s-]?unavailable|server[\s-]?error|internal[\s-]?error|fetch\s+failed|enotfound|eai_again|socket\s+hang\s+up|timed?\s*out|timeout|premature\s+close|stream\s+ended\s+before)/i;

/**
 * Local fallback classification (degraded mode only — see above).
 */
function classifyErrorMessageLocally(
	errorMessage: string,
): "recoverable" | "unrecoverable" | null {
	if (FATAL_ERROR_PATTERN.test(errorMessage)) return "unrecoverable";
	if (PROVIDER_LIMIT_ERROR_PATTERN.test(errorMessage)) return "recoverable";
	if (TRANSIENT_ERROR_PATTERN.test(errorMessage)) return "recoverable";
	return null;
}

/**
 * Classify an errorMessage string seen on `message_end.message`.
 *
 * Primary path: pi-ai's `isRetryableAssistantError` (lockstep with Pi's
 * own retry semantics). Fallback: local tables. pi-ai returns false for
 * provider-limit errors ("out of credits") — same-model retry cannot fix
 * those, but a model switch can, so they map to RECOVERABLE here.
 *
 * Per AGENTS.md convention 17: we read the errorMessage TEXT only when it
 * arrives on `message_end.message` (Pi-composed, already in the session
 * transcript); we never read response bodies from `after_provider_response`.
 *
 * @returns the failure kind, or null when the message carries no usable
 *   signal (empty message, or no pattern matched anywhere).
 */
export function classifyErrorMessage(
	errorMessage: string | undefined,
): FailureKind | null {
	if (!errorMessage) return null;
	if (FATAL_ERROR_PATTERN.test(errorMessage)) return "unrecoverable";

	if (piAiRetryModule) {
		// pi-ai "retryable" → transient: same-model retry may work, a switch
		// may too → recoverable. pi-ai "non-retryable" splits two ways:
		// quota/limit classes (same-model retry is hopeless, a switch is
		// THE fix → recoverable) vs no-signal (→ null, honest unknown).
		if (
			piAiRetryModule.isRetryableAssistantError({
				stopReason: "error",
				errorMessage,
			})
		) {
			return "recoverable";
		}
		return PROVIDER_LIMIT_ERROR_PATTERN.test(errorMessage) ? "recoverable" : null;
	}
	// Kick off the async load for next time (fire-and-forget; the current
	// call uses the local tables so classification stays synchronous).
	void loadPiAiRetryClassifier();
	return classifyErrorMessageLocally(errorMessage);
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
