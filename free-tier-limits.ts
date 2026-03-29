/**
 * Free Tier Rate Limits and Usage Tracking
 *
 * Documents and tracks usage against free tier limits per provider.
 * This helps users understand their remaining quota before hitting 429 errors.
 *
 * Provider Free Tier Limits:
 * - Kilo: 200 requests/hour per IP (anonymous) or per account (authenticated)
 * - OpenRouter: 1000 requests/day for free tier (no key)
 * - Zen (OpenCode): Unknown limits - fair use policy
 * - Cline: Rate limited but undocumented
 * - NVIDIA: 1000 requests/month for free tier
 * - Fireworks: 1000 requests/month for free tier
 */

import { getDailyRequestCount, incrementRequestCount } from "./metrics.ts";

// =============================================================================
// Per-Model Usage Tracking (more granular than provider-level)
// =============================================================================

interface ModelUsageEntry {
	count: number;
	lastUsed: number; // timestamp
}

// Map: "provider/modelId" -> usage stats
const modelUsageCounts = new Map<string, ModelUsageEntry>();

/**
 * Track a request for a specific model
 * Call this on every successful request to build usage patterns
 */
export function incrementModelRequestCount(
	provider: string,
	modelId: string,
): void {
	const key = `${provider}/${modelId}`;
	const existing = modelUsageCounts.get(key);

	if (existing) {
		existing.count++;
		existing.lastUsed = Date.now();
	} else {
		modelUsageCounts.set(key, { count: 1, lastUsed: Date.now() });
	}

	// Also increment provider-level count
	incrementRequestCount(provider);
}

/**
 * Get usage for a specific model
 */
export function getModelUsage(
	provider: string,
	modelId: string,
): ModelUsageEntry | undefined {
	return modelUsageCounts.get(`${provider}/${modelId}`);
}

/**
 * Get all model usage for a provider
 */
export function getProviderModelUsage(
	provider: string,
): Array<{ modelId: string; count: number; lastUsed: number }> {
	const results: Array<{ modelId: string; count: number; lastUsed: number }> =
		[];
	const prefix = `${provider}/`;

	for (const [key, entry] of modelUsageCounts.entries()) {
		if (key.startsWith(prefix)) {
			results.push({
				modelId: key.slice(prefix.length),
				count: entry.count,
				lastUsed: entry.lastUsed,
			});
		}
	}

	return results.sort((a, b) => b.count - a.count); // Most used first
}

/**
 * Get top N most used models across all providers
 */
export function getTopModels(
	n = 10,
): Array<{ provider: string; modelId: string; count: number }> {
	const all: Array<{ provider: string; modelId: string; count: number }> = [];

	for (const [key, entry] of modelUsageCounts.entries()) {
		const [provider, ...modelParts] = key.split("/");
		all.push({
			provider,
			modelId: modelParts.join("/"),
			count: entry.count,
		});
	}

	return all.sort((a, b) => b.count - a.count).slice(0, n);
}

/**
 * Log usage report for debugging limits
 */
export function logModelUsageReport(provider?: string): void {
	if (provider) {
		const models = getProviderModelUsage(provider);
		const total = models.reduce((sum, m) => sum + m.count, 0);

		console.log(`[usage-report] ${provider}: ${total} total requests`);
		for (const m of models.slice(0, 5)) {
			console.log(`  - ${m.modelId}: ${m.count} requests`);
		}
	} else {
		console.log("[usage-report] Top 10 models across all providers:");
		for (const m of getTopModels(10)) {
			console.log(`  - ${m.provider}/${m.modelId}: ${m.count} requests`);
		}
	}
}

// =============================================================================
// Free Tier Limits Configuration
// =============================================================================

export interface FreeTierLimit {
	provider: string;
	requestsPerDay?: number;
	requestsPerHour?: number;
	requestsPerMonth?: number;
	description: string;
}

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
// Usage Tracking
// =============================================================================

export interface FreeTierUsage {
	provider: string;
	requestsToday: number;
	requestsThisHour: number;
	requestsThisMonth?: number;
	limit: FreeTierLimit;
	remainingToday?: number;
	remainingThisHour?: number;
	remainingThisMonth?: number;
	percentUsed: number;
	status: "ok" | "warning" | "critical" | "unknown";
}

/**
 * Get current usage against free tier limits
 */
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

	// For hour tracking, we'd need more granular data
	// For now, estimate based on session count
	const requestsThisHour = Math.min(requestsToday, 50); // Rough estimate

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

	// Determine status
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

/**
 * Check if we're approaching a rate limit
 */
export function isApproachingLimit(provider: string): boolean {
	const usage = getFreeTierUsage(provider);
	return usage.status === "warning" || usage.status === "critical";
}

/**
 * Get warning message if approaching limit
 */
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

/**
 * Format free tier status for display
 */
export function formatFreeTierStatus(provider: string): string {
	const usage = getFreeTierUsage(provider);
	const parts: string[] = [];

	if (usage.limit.requestsPerHour) {
		parts.push(`${usage.requestsThisHour}/${usage.limit.requestsPerHour}/h`);
	}
	if (usage.limit.requestsPerDay) {
		parts.push(`${usage.requestsToday}/${usage.limit.requestsPerDay}/d`);
	}
	if (usage.limit.requestsPerMonth) {
		parts.push(
			`${usage.requestsThisMonth ?? 0}/${usage.limit.requestsPerMonth}/mo`,
		);
	}

	if (parts.length === 0) {
		return `${provider}: ${usage.limit.description}`;
	}

	return `${provider}: ${parts.join(" | ")}`;
}
