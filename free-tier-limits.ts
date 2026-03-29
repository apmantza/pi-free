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

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getDailyRequestCount, incrementRequestCount } from "./metrics.ts";

// =============================================================================
// Per-Model Usage Tracking (more granular than provider-level)
// =============================================================================

interface ModelUsageEntry {
	count: number;
	tokensIn: number;
	tokensOut: number;
	lastUsed: number; // timestamp
}

// Map: "provider/modelId" -> usage stats
const modelUsageCounts = new Map<string, ModelUsageEntry>();

// Session-level tracking
interface SessionStats {
	startTime: number;
	providers: Map<
		string,
		{
			requests: number;
			tokensIn: number;
			tokensOut: number;
			models: Map<string, ModelUsageEntry>;
		}
	>;
}

const sessionStats: SessionStats = {
	startTime: Date.now(),
	providers: new Map(),
};

/**
 * Track a request for a specific model with token usage
 * Call this on every successful request to build usage patterns
 */
export function incrementModelRequestCount(
	provider: string,
	modelId: string,
	tokensIn = 0,
	tokensOut = 0,
): void {
	const key = `${provider}/${modelId}`;
	const existing = modelUsageCounts.get(key);

	if (existing) {
		existing.count++;
		existing.tokensIn += tokensIn;
		existing.tokensOut += tokensOut;
		existing.lastUsed = Date.now();
	} else {
		modelUsageCounts.set(key, {
			count: 1,
			tokensIn,
			tokensOut,
			lastUsed: Date.now(),
		});
	}

	// Also increment provider-level count
	incrementRequestCount(provider);

	// Track in session stats
	let providerStats = sessionStats.providers.get(provider);
	if (!providerStats) {
		providerStats = {
			requests: 0,
			tokensIn: 0,
			tokensOut: 0,
			models: new Map(),
		};
		sessionStats.providers.set(provider, providerStats);
	}
	providerStats.requests++;
	providerStats.tokensIn += tokensIn;
	providerStats.tokensOut += tokensOut;

	const modelStats = providerStats.models.get(modelId);
	if (modelStats) {
		modelStats.count++;
		modelStats.tokensIn += tokensIn;
		modelStats.tokensOut += tokensOut;
		modelStats.lastUsed = Date.now();
	} else {
		providerStats.models.set(modelId, {
			count: 1,
			tokensIn,
			tokensOut,
			lastUsed: Date.now(),
		});
	}

	// Persist to disk
	persistUsage(provider, modelId, tokensIn, tokensOut);
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
export function getProviderModelUsage(provider: string): Array<{
	modelId: string;
	count: number;
	tokensIn: number;
	tokensOut: number;
	lastUsed: number;
}> {
	const results: Array<{
		modelId: string;
		count: number;
		tokensIn: number;
		tokensOut: number;
		lastUsed: number;
	}> = [];
	const prefix = `${provider}/`;

	for (const [key, entry] of modelUsageCounts.entries()) {
		if (key.startsWith(prefix)) {
			results.push({
				modelId: key.slice(prefix.length),
				count: entry.count,
				tokensIn: entry.tokensIn,
				tokensOut: entry.tokensOut,
				lastUsed: entry.lastUsed,
			});
		}
	}

	return results.sort((a, b) => b.count - a.count); // Most used first
}

/**
 * Get top N most used models across all providers
 */
export function getTopModels(n = 10): Array<{
	provider: string;
	modelId: string;
	count: number;
	tokensIn: number;
	tokensOut: number;
}> {
	const all: Array<{
		provider: string;
		modelId: string;
		count: number;
		tokensIn: number;
		tokensOut: number;
	}> = [];

	for (const [key, entry] of modelUsageCounts.entries()) {
		const slashIndex = key.indexOf("/");
		const provider = key.slice(0, slashIndex);
		const modelId = key.slice(slashIndex + 1);
		all.push({
			provider,
			modelId,
			count: entry.count,
			tokensIn: entry.tokensIn,
			tokensOut: entry.tokensOut,
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
		const totalTokensIn = models.reduce((sum, m) => sum + m.tokensIn, 0);
		const totalTokensOut = models.reduce((sum, m) => sum + m.tokensOut, 0);

		console.log(
			`[usage-report] ${provider}: ${total} total requests, ~${Math.round(totalTokensIn / 1000)}K tokens in, ~${Math.round(totalTokensOut / 1000)}K out`,
		);
		for (const m of models.slice(0, 5)) {
			console.log(
				`  - ${m.modelId}: ${m.count} req, ~${Math.round(m.tokensIn / 1000)}K in`,
			);
		}
	} else {
		console.log("[usage-report] Top 10 models across all providers:");
		for (const m of getTopModels(10)) {
			console.log(
				`  - ${m.provider}/${m.modelId}: ${m.count} req, ~${Math.round(m.tokensIn / 1000)}K in`,
			);
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

// =============================================================================
// Persistent Storage (Cumulative Usage)
// =============================================================================

const PI_DIR = join(process.env.HOME || process.env.USERPROFILE || "", ".pi");
const USAGE_FILE = join(PI_DIR, "free-cumulative-usage.json");

interface CumulativeProviderStats {
	totalRequests: number;
	totalTokensIn: number;
	totalTokensOut: number;
	models: Record<
		string,
		{ count: number; tokensIn: number; tokensOut: number }
	>;
	firstUsed: string;
	lastUsed: string;
}

interface CumulativeUsage {
	providers: Record<string, CumulativeProviderStats>;
	grandTotalRequests: number;
	grandTotalTokensIn: number;
	grandTotalTokensOut: number;
}

let cachedCumulative: CumulativeUsage | null = null;

function loadCumulative(): CumulativeUsage {
	if (cachedCumulative) return cachedCumulative;

	try {
		if (existsSync(USAGE_FILE)) {
			const data = JSON.parse(readFileSync(USAGE_FILE, "utf-8"));
			cachedCumulative = data;
			return data;
		}
	} catch (err) {
		console.debug("[free-tier] Failed to load cumulative usage:", err);
	}

	cachedCumulative = {
		providers: {},
		grandTotalRequests: 0,
		grandTotalTokensIn: 0,
		grandTotalTokensOut: 0,
	};
	return cachedCumulative;
}

function saveCumulative(): void {
	if (!cachedCumulative) return;

	try {
		if (!existsSync(PI_DIR)) {
			mkdirSync(PI_DIR, { recursive: true });
		}
		writeFileSync(
			USAGE_FILE,
			JSON.stringify(cachedCumulative, null, 2),
			"utf-8",
		);
	} catch (err) {
		console.debug("[free-tier] Failed to save cumulative usage:", err);
	}
}

/**
 * Persist usage to disk for cumulative tracking
 */
function persistUsage(
	provider: string,
	modelId: string,
	tokensIn: number,
	tokensOut: number,
): void {
	const data = loadCumulative();
	const now = new Date().toISOString();

	let providerStats = data.providers[provider];
	if (!providerStats) {
		providerStats = {
			totalRequests: 0,
			totalTokensIn: 0,
			totalTokensOut: 0,
			models: {},
			firstUsed: now,
			lastUsed: now,
		};
		data.providers[provider] = providerStats;
	}

	providerStats.totalRequests++;
	providerStats.totalTokensIn += tokensIn;
	providerStats.totalTokensOut += tokensOut;
	providerStats.lastUsed = now;

	const modelStats = providerStats.models[modelId] ?? {
		count: 0,
		tokensIn: 0,
		tokensOut: 0,
	};
	modelStats.count++;
	modelStats.tokensIn += tokensIn;
	modelStats.tokensOut += tokensOut;
	providerStats.models[modelId] = modelStats;

	data.grandTotalRequests++;
	data.grandTotalTokensIn += tokensIn;
	data.grandTotalTokensOut += tokensOut;

	saveCumulative();
}

// =============================================================================
// Session Usage Command
// =============================================================================

export interface SessionUsageReport {
	duration: number; // milliseconds
	durationFormatted: string;
	providers: Array<{
		name: string;
		requests: number;
		tokensIn: number;
		tokensOut: number;
		topModels: Array<{
			modelId: string;
			count: number;
			tokensIn: number;
			tokensOut: number;
		}>;
	}>;
	totalRequests: number;
	totalTokensIn: number;
	totalTokensOut: number;
}

/**
 * Get current session usage report
 */
export function getSessionUsage(): SessionUsageReport {
	const now = Date.now();
	const duration = now - sessionStats.startTime;

	const providers: SessionUsageReport["providers"] = [];
	let totalRequests = 0;
	let totalTokensIn = 0;
	let totalTokensOut = 0;

	for (const [providerName, stats] of sessionStats.providers) {
		totalRequests += stats.requests;
		totalTokensIn += stats.tokensIn;
		totalTokensOut += stats.tokensOut;

		const topModels = Array.from(stats.models.entries())
			.map(([modelId, m]) => ({
				modelId,
				count: m.count,
				tokensIn: m.tokensIn,
				tokensOut: m.tokensOut,
			}))
			.sort((a, b) => b.count - a.count)
			.slice(0, 5);

		providers.push({
			name: providerName,
			requests: stats.requests,
			tokensIn: stats.tokensIn,
			tokensOut: stats.tokensOut,
			topModels,
		});
	}

	// Sort providers by request count
	providers.sort((a, b) => b.requests - a.requests);

	return {
		duration,
		durationFormatted: formatDuration(duration),
		providers,
		totalRequests,
		totalTokensIn,
		totalTokensOut,
	};
}

function formatDuration(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);

	if (hours > 0) {
		return `${hours}h ${minutes % 60}m`;
	}
	if (minutes > 0) {
		return `${minutes}m ${seconds % 60}s`;
	}
	return `${seconds}s`;
}

/**
 * Format session usage as readable text
 */
export function formatSessionUsage(): string {
	const report = getSessionUsage();

	if (report.providers.length === 0) {
		return "No usage recorded in this session yet.";
	}

	const lines: string[] = [];
	lines.push("━".repeat(50));
	lines.push(`📊 Session Usage (${report.durationFormatted})`);
	lines.push("━".repeat(50));
	lines.push("");

	for (const p of report.providers) {
		const status = getLimitWarning(p.name);
		const statusEmoji = status ? (status.includes("⚠️") ? "🔴" : "🟡") : "🟢";
		lines.push(`${statusEmoji} ${p.name}`);
		lines.push(`   Requests: ${p.requests}`);
		lines.push(
			`   Tokens: ~${Math.round(p.tokensIn / 1000)}K in, ~${Math.round(p.tokensOut / 1000)}K out`,
		);

		if (p.topModels.length > 0) {
			lines.push(`   Top models:`);
			for (const m of p.topModels.slice(0, 3)) {
				lines.push(`     • ${m.modelId.split("/").pop()}: ${m.count} req`);
			}
		}
		lines.push("");
	}

	lines.push("━".repeat(50));
	lines.push(
		`📈 Totals: ${report.totalRequests} requests, ~${Math.round(report.totalTokensIn / 1000)}K tokens`,
	);
	lines.push("━".repeat(50));

	return lines.join("\n");
}

// =============================================================================
// Cumulative Usage Command
// =============================================================================

export interface CumulativeUsageReport {
	providers: Array<{
		name: string;
		totalRequests: number;
		totalTokensIn: number;
		totalTokensOut: number;
		modelCount: number;
		firstUsed: string;
		lastUsed: string;
		topModels: Array<{
			modelId: string;
			count: number;
			tokensIn: number;
			tokensOut: number;
		}>;
	}>;
	grandTotalRequests: number;
	grandTotalTokensIn: number;
	grandTotalTokensOut: number;
}

/**
 * Get cumulative usage from disk
 */
export function getCumulativeUsage(): CumulativeUsageReport {
	const data = loadCumulative();

	const providers: CumulativeUsageReport["providers"] = [];

	for (const [name, stats] of Object.entries(data.providers)) {
		// Get top 5 models by request count
		const topModels = Object.entries(stats.models)
			.map(([modelId, m]) => ({
				modelId,
				count: m.count,
				tokensIn: m.tokensIn,
				tokensOut: m.tokensOut,
			}))
			.sort((a, b) => b.count - a.count)
			.slice(0, 5);

		providers.push({
			name,
			totalRequests: stats.totalRequests,
			totalTokensIn: stats.totalTokensIn,
			totalTokensOut: stats.totalTokensOut,
			modelCount: Object.keys(stats.models).length,
			firstUsed: stats.firstUsed,
			lastUsed: stats.lastUsed,
			topModels,
		});
	}

	// Sort by total requests
	providers.sort((a, b) => b.totalRequests - a.totalRequests);

	return {
		providers,
		grandTotalRequests: data.grandTotalRequests,
		grandTotalTokensIn: data.grandTotalTokensIn,
		grandTotalTokensOut: data.grandTotalTokensOut,
	};
}

/**
 * Format cumulative usage as readable text
 */
export function formatCumulativeUsage(): string {
	const report = getCumulativeUsage();

	if (report.providers.length === 0) {
		return "No cumulative usage data yet. Start using free models!";
	}

	const lines: string[] = [];
	lines.push("━".repeat(50));
	lines.push("📊 Total Usage (All Time)");
	lines.push("━".repeat(50));
	lines.push("");

	for (const p of report.providers) {
		lines.push(`🔹 ${p.name}`);
		lines.push(`   Requests: ${p.totalRequests.toLocaleString()}`);
		lines.push(
			`   Tokens: ~${Math.round(p.totalTokensIn / 1000).toLocaleString()}K in, ~${Math.round(p.totalTokensOut / 1000).toLocaleString()}K out`,
		);
		lines.push(`   Models used: ${p.modelCount}`);

		if (p.topModels.length > 0) {
			lines.push(`   Top models:`);
			for (const m of p.topModels.slice(0, 3)) {
				lines.push(
					`     • ${m.modelId.split("/").pop()}: ${m.count.toLocaleString()} req`,
				);
			}
		}

		lines.push(`   Active since: ${p.firstUsed.split("T")[0]}`);
		lines.push("");
	}

	lines.push("━".repeat(50));
	lines.push(`📈 Grand Totals:`);
	lines.push(`   ${report.grandTotalRequests.toLocaleString()} requests`);
	lines.push(
		`   ~${Math.round(report.grandTotalTokensIn / 1000).toLocaleString()}K input tokens`,
	);
	lines.push(
		`   ~${Math.round(report.grandTotalTokensOut / 1000).toLocaleString()}K output tokens`,
	);
	lines.push("━".repeat(50));

	return lines.join("\n");
}
