/**
 * Shared state between auto-fallback and quota-monitor.
 *
 * Per design (Q28 = B): quota-monitor and auto-fallback each own their own
 * concern (status-bar display vs. model switching), but they need to share
 * one piece of information — the most recently observed HTTP status per
 * `(provider, model)` pair — so auto-fallback's abort heuristic (Q23 = B:
 * "aborted + last status >= 500 → recoverable") can decide whether a
 * mid-stream abort was a user cancel or a server failure.
 *
 * State lives in memory only. It is keyed on `provider/modelId` so the
 * value naturally co-locates with the blacklist key.
 */

class FallbackSharedState {
	private readonly lastStatusByKey = new Map<string, number>();
	private readonly lastHttpByKey = new Map<
		string,
		{ status: number; at: number }
	>();

	/**
	 * Record the HTTP status seen on `after_provider_response`.
	 *
	 * Called by quota-monitor (already observes every response). The
	 * status is intentionally NOT associated with success/failure here;
	 * that distinction lives in classifier.ts. We keep both the bare
	 * status (for the abort heuristic) and the timestamped version (for
	 * future time-windowed logic).
	 */
	recordResponse(provider: string, modelId: string, status: number): void {
		const key = `${provider}/${modelId}`;
		this.lastStatusByKey.set(key, status);
		this.lastHttpByKey.set(key, { status, at: Date.now() });
	}

	/**
	 * Look up the most recently observed HTTP status for a key, used by
	 * the abort classifier. Returns undefined when no response has been
	 * seen yet (e.g. failure happens before any after_provider_response).
	 */
	getLastStatus(provider: string, modelId: string): number | undefined {
		return this.lastStatusByKey.get(`${provider}/${modelId}`);
	}

	/**
	 * Snapshot of all keyed last statuses, for `/pi-free-health`.
	 * Returned shape: array of `{ key, status, at }`.
	 */
	snapshot(): Array<{ key: string; status: number; at: number }> {
		const out: Array<{ key: string; status: number; at: number }> = [];
		for (const [key, value] of this.lastHttpByKey) {
			out.push({ key, status: value.status, at: value.at });
		}
		return out;
	}

	/** Clear all keys (e.g. on extension reload). */
	clear(): void {
		this.lastStatusByKey.clear();
		this.lastHttpByKey.clear();
	}
}

/**
 * Process-singleton instance. Both quota-monitor and auto-fallback import
 * this same module, so they see the same store. Tests can instantiate a
 * fresh one via `new FallbackSharedState()`.
 */
export const fallbackState = new FallbackSharedState();
