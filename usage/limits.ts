/**
 * Free Tier Rate Limits and Usage Tracking
 *
 * Main entry point - delegates to specialized modules:
 * - usage/tracking.ts - runtime session tracking
 * - usage/cumulative.ts - persistent cumulative storage
 * - usage/formatters.ts - display formatting
 */

import { createLogger } from "../lib/logger.ts";
import { getDailyRequestCount } from "./metrics.ts";
import type { FreeTierLimit, FreeTierUsage } from "./types.ts";

export {
	type CumulativeUsageReport,
	getCumulativeUsage,
} from "./cumulative.ts";
export {
	formatCumulativeUsage,
	formatFreeTierStatus,
	formatSessionUsage,
} from "./formatters.ts";
// Re-export from specialized modules
export {
	getModelUsage,
	getProviderModelUsage,
	getSessionUsage,
	getTopModels,
	incrementModelRequestCount,
	logModelUsageReport,
	resetUsageStats,
	type SessionUsageReport,
} from "./tracking.ts";
// Re-export types for consumers
export type { FreeTierLimit, FreeTierUsage } from "./types.ts";

const _logger = createLogger("free-tier");

// =============================================================================
// Free Tier Limits Configuration
// =============================================================================

export const FREE_TIER_LIMITS: Record<string, FreeTierLimit> = {
	kilo: {
		provider: "kilo",
		requestsPerHour: 200,
		description: "200 requests/hour per IP (anonymous) or account",
	},
	openrouter: {
		provider: "openrouter",
		requestsPerDay: 1000,
		description: "1000 requests/day for free tier (no API key)",
	},
	nvidia: {
		provider: "nvidia",
		requestsPerMonth: 1000,
		description: "1000 requests/month for NIM free tier",
	},
	fireworks: {
		provider: "fireworks",
		requestsPerMonth: 1000,
		description: "1000 requests/month for free tier",
	},
	zen: {
		provider: "zen",
		description: "Fair use policy - no hard limits",
	},
	cline: {
		provider: "cline",
		description: "Rate limited but limits undocumented",
	},
};

// =============================================================================
// Usage Status and Warnings
// =============================================================================

export function getFreeTierUsage(provider: string): FreeTierUsage {
	const limit = FREE_TIER_LIMITS[provider];
	if (!limit) {
		return {
			provider,
			requestsToday: 0,
			requestsThisHour: 0,
			limit: { provider, description: "Unknown" },
			percentUsed: 0,
			status: "unknown",
		};
	}

	const requestsToday = getDailyRequestCount(provider);
	// For hour tracking, estimate based on session count (capped at 50)
	const requestsThisHour = Math.min(requestsToday, 50);

	let percentUsed = 0;
	let status: FreeTierUsage["status"] = "ok";

	if (limit.requestsPerHour) {
		percentUsed = Math.max(
			percentUsed,
			(requestsThisHour / limit.requestsPerHour) * 100,
		);
	}
	if (limit.requestsPerDay) {
		percentUsed = Math.max(
			percentUsed,
			(requestsToday / limit.requestsPerDay) * 100,
		);
	}

	if (percentUsed >= 90) status = "critical";
	else if (percentUsed >= 70) status = "warning";

	return {
		provider,
		requestsToday,
		requestsThisHour,
		limit,
		remainingToday: limit.requestsPerDay
			? limit.requestsPerDay - requestsToday
			: undefined,
		remainingThisHour: limit.requestsPerHour
			? limit.requestsPerHour - requestsThisHour
			: undefined,
		percentUsed: Math.round(percentUsed),
		status,
	};
}

export function isApproachingLimit(provider: string): boolean {
	const usage = getFreeTierUsage(provider);
	return usage.status === "warning" || usage.status === "critical";
}

export function getLimitWarning(provider: string): string | null {
	const usage = getFreeTierUsage(provider);

	if (usage.status === "critical") {
		const remaining = usage.remainingThisHour ?? usage.remainingToday ?? 0;
		return `⚠️ ${provider}: ${usage.percentUsed}% of free tier used. ~${remaining} requests remaining.`;
	}

	if (usage.status === "warning") {
		return `ℹ️ ${provider}: ${usage.percentUsed}% of free tier used.`;
	}

	return null;
}
