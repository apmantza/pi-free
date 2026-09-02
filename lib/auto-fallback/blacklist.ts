/**
 * In-session blacklist for auto-fallback.
 *
 * Tracks recent failures per `{provider}/{model}` key so the selection layer
 * can avoid retrying a known-broken model. Two eviction rules (Q9 = C):
 *
 *   - **Time window**: a record older than `ttlMs` expires and the model
 *     gets another chance. A single transient quota error should not
 *     permanently ban a perfectly serviceable model.
 *   - **Max strikes**: after `maxStrikes` failures in the TTL window the
 *     record is "promoted" to a hard ban for the rest of the session —
 *     the model is clearly broken (e.g. upstream disabled the endpoint)
 *     and there is no point waiting out the TTL.
 *
 * Blacklist state is in-memory only. It is reset when the extension
 * reloads (extension entry point runs again). Per AGENTS.md convention 18
 * this is intentional — across releases / extension reloads we do not
 * persist "model X was bad last week" because that signal decays fast
 * (free providers flip free/paid status frequently).
 */

interface BlacklistEntry {
	/** Consecutive failure count within the current TTL window. */
	count: number;
	/**
	 * Timestamp (ms since epoch) of the first failure in the current
	 * streak. Used to decide if a hit is still inside the TTL window.
	 */
	windowStart: number;
	/**
	 * Timestamp (ms since epoch) of the most recent failure. For
	 * status bar output / `/free-fallback-history` rendering.
	 */
	lastFailureAt: number;
	/**
	 * Last few error messages seen for this key — capped so a runaway
	 * loop doesn't grow unbounded. NOT used for classification (see
	 * classifier.ts); only for the history view.
	 */
	reasons: string[];
}

export interface BlacklistOptions {
	/** Failure TTL window in ms. Default 10 minutes. */
	ttlMs?: number;
	/** Strikes within the TTL that promote to hard ban. Default 3. */
	maxStrikes?: number;
	/**
	 * Cap on stored error messages per entry, oldest-first. Default 5.
	 * Prevents runaway growth if a hot model never evicts.
	 */
	maxReasons?: number;
}

/**
 * Current state of the in-memory blacklist. Private; the public API is
 * the factory {@link createBlacklist}.
 */
class BlacklistState {
	private readonly entries = new Map<string, BlacklistEntry>();
	private readonly ttlMs: number;
	private readonly maxStrikes: number;
	private readonly maxReasons: number;

	constructor(options: BlacklistOptions = {}) {
		this.ttlMs = options.ttlMs ?? 10 * 60 * 1000;
		this.maxStrikes = options.maxStrikes ?? 3;
		this.maxReasons = options.maxReasons ?? 5;
	}

	/**
	 * Record a failure for a model.
	 *
	 * @param key - Composite key, conventionally `${provider}/${modelId}`.
	 * @param reason - Short error class label (e.g. "429", "quota"). NOT the
	 *     full errorMessage; that is for log/notify only.
	 * @returns The updated record, or null if the entry was just evicted.
	 */
	recordFailure(
		key: string,
		reason: string,
		now: number = Date.now(),
	): BlacklistEntry | null {
		const existing = this.entries.get(key);
		if (existing && now - existing.windowStart > this.ttlMs) {
			// TTL window expired — reset the streak so a single stale
			// failure does not haunt a now-working model.
			this.entries.delete(key);
		}
		const current = this.entries.get(key);
		const nextCount = (current?.count ?? 0) + 1;
		const entry: BlacklistEntry = {
			count: nextCount,
			windowStart: current?.windowStart ?? now,
			lastFailureAt: now,
			reasons: [...(current?.reasons ?? []), reason].slice(-this.maxReasons),
		};
		this.entries.set(key, entry);
		return entry;
	}

	/**
	 * Remove the blacklist record (e.g. on a successful run, or via
	 * `/reset-fallback-blacklist`). Idempotent.
	 */
	clear(key: string): void {
		this.entries.delete(key);
	}

	/** Clear every entry — used by the `/reset-fallback-blacklist` command. */
	clearAll(): number {
		const n = this.entries.size;
		this.entries.clear();
		return n;
	}

	/**
	 * Should the given key be considered blacklisted right now?
	 *
	 * Excludes entries past their TTL window. An entry that has hit
	 * {@link BlacklistOptions.maxStrikes} stays banned for the rest of the
	 * session (no automatic expiry).
	 */
	isBlacklisted(key: string, now: number = Date.now()): boolean {
		const entry = this.entries.get(key);
		if (!entry) return false;
		// Hard ban (>= maxStrikes) persists for the session.
		if (entry.count >= this.maxStrikes) return true;
		// Soft ban: must also still be inside the window.
		return now - entry.windowStart <= this.ttlMs;
	}

	/** Read-only view of all entries, for `/free-fallback-history`. */
	snapshot(): ReadonlyMap<string, BlacklistEntry> {
		return new Map(this.entries);
	}

	/** Total entries currently tracked (before TTL eviction). */
	size(): number {
		return this.entries.size;
	}
}

export interface Blacklist {
	recordFailure(
		key: string,
		reason: string,
		now?: number,
	): BlacklistEntry | null;
	clear(key: string): void;
	clearAll(): number;
	isBlacklisted(key: string, now?: number): boolean;
	snapshot(): ReadonlyMap<string, BlacklistEntry>;
	size(): number;
}

/**
 * Build a fresh blacklist. Each session should hold exactly one — sharing
 * across sessions is not desired (see file header).
 */
export function createBlacklist(options: BlacklistOptions = {}): Blacklist {
	const state = new BlacklistState(options);
	return {
		recordFailure(key, reason, now) {
			return state.recordFailure(key, reason, now);
		},
		clear(key) {
			state.clear(key);
		},
		clearAll() {
			return state.clearAll();
		},
		isBlacklisted(key, now) {
			return state.isBlacklisted(key, now);
		},
		snapshot() {
			return state.snapshot();
		},
		size() {
			return state.size();
		},
	};
}
