import { randomUUID } from "node:crypto";

export const OPENCODE_STATIC_HEADERS = {
	"User-Agent": "opencode/1.15.3",
	"x-opencode-client": "cli",
	"x-opencode-project": "global",
} as const;

/**
 * Shared OpenCode session/request tracking.
 *
 * OpenCode endpoints appear to behave more reliably when a stable session id
 * is included across requests in the same Pi session.
 */
export function createOpenCodeSessionTracker() {
	let sessionId = "";
	let requestCount = 0;

	function generateId(): string {
		return randomUUID().replaceAll("-", "");
	}

	function getSessionId(): string {
		if (!sessionId) {
			sessionId = generateId();
		}
		return sessionId;
	}

	function nextRequestId(): string {
		requestCount++;
		return `${getSessionId()}-${requestCount}`;
	}

	return {
		getSessionId,
		nextRequestId,
	};
}

export type OpenCodeSessionTracker = ReturnType<typeof createOpenCodeSessionTracker>;

export function createOpenCodeHeaders(
	tracker: OpenCodeSessionTracker,
	existingHeaders?: Record<string, string>,
): Record<string, string> {
	return {
		...existingHeaders,
		...OPENCODE_STATIC_HEADERS,
		"x-opencode-session": tracker.getSessionId(),
		"x-opencode-request": tracker.nextRequestId(),
	};
}
