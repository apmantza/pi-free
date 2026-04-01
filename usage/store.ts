/**
 * Persistent cumulative usage tracking per provider.
 *
 * Stored at ~/./.pi/free-usage.json — survives across sessions.
 * Updated on each turn_end via provider-helper.ts.
 *
 * This answers: "how much free value have I gotten over time?"
 */

import { join } from "node:path";
import { createJSONStore } from "../lib/json-persistence.js";
import { createLogger } from "../lib/logger.js";

// =============================================================================
// Types
// =============================================================================

export interface ProviderCumulativeUsage {
	/** Total input tokens across all sessions. */
	tokensIn: number;
	/** Total output tokens across all sessions. */
	tokensOut: number;
	/** Total requests across all sessions. */
	requests: number;
	/** Total cost that would have been charged on a paid tier. */
	costEquivalent: number;
	/** ISO date of first tracked request. */
	firstUsed: string;
	/** ISO date of last tracked request. */
	lastUsed: string;
}

export interface CumulativeUsageStore {
	[provider: string]: ProviderCumulativeUsage;
}

// =============================================================================
// Storage
// =============================================================================

const PI_DIR = join(process.env.HOME || process.env.USERPROFILE || "", ".pi");
const USAGE_PATH = join(PI_DIR, "free-usage.json");

const logger = createLogger("usage-store");

const store = createJSONStore<CumulativeUsageStore>(USAGE_PATH, {});

// =============================================================================
// API
// =============================================================================

/** Record a turn's token usage for a provider. */
export function recordTurn(
	provider: string,
	tokensIn: number,
	tokensOut: number,
	costEquivalent: number,
): void {
	const data = store.load();
	const now = new Date().toISOString();
	const existing = data[provider];

	if (existing) {
		existing.tokensIn += tokensIn;
		existing.tokensOut += tokensOut;
		existing.requests += 1;
		existing.costEquivalent += costEquivalent;
		existing.lastUsed = now;
	} else {
		data[provider] = {
			tokensIn,
			tokensOut,
			requests: 1,
			costEquivalent,
			firstUsed: now,
			lastUsed: now,
		};
	}

	store.save(data);
	logger.debug("recorded turn", {
		provider,
		tokensIn,
		tokensOut,
		costEquivalent,
	});
}

/** Get cumulative usage for a specific provider. */
export function getCumulativeUsage(
	provider: string,
): ProviderCumulativeUsage | null {
	return store.load()[provider] ?? null;
}

/** Get all cumulative usage data. */
export function getAllCumulativeUsage(): CumulativeUsageStore {
	return store.load();
}
