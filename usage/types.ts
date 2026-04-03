/**
 * Shared types for usage tracking modules
 *
 * Extracted to break circular dependency between limits.ts and formatters.ts
 */

export interface FreeTierLimit {
	provider: string;
	requestsPerDay?: number;
	requestsPerHour?: number;
	requestsPerMonth?: number;
	description: string;
}

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
