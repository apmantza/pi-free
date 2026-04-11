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
		return (
			Math.random().toString(36).substring(2, 15) +
			Math.random().toString(36).substring(2, 15)
		);
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
