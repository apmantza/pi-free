/**
 * Usage tracking - runtime session and model-level tracking
 */

import { createLogger } from "../lib/logger.ts";
import { incrementRequestCount } from "../metrics.ts";
import { persistUsage } from "./cumulative.ts";

const logger = createLogger("usage:tracking");

export interface ModelUsageEntry {
	count: number;
	tokensIn: number;
	tokensOut: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	lastUsed: number;
}

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

// Runtime tracking state
const modelUsageCounts = new Map<string, ModelUsageEntry>();
const sessionStats: SessionStats = {
	startTime: Date.now(),
	providers: new Map(),
};

export function resetUsageStats(): void {
	modelUsageCounts.clear();
	sessionStats.startTime = Date.now();
	sessionStats.providers.clear();
}

export function incrementModelRequestCount(
	provider: string,
	modelId: string,
	tokensIn = 0,
	tokensOut = 0,
	cacheRead = 0,
	cacheWrite = 0,
	cost = 0,
): void {
	const key = `${provider}/${modelId}`;
	const existing = modelUsageCounts.get(key);

	if (existing) {
		existing.count++;
		existing.tokensIn += tokensIn;
		existing.tokensOut += tokensOut;
		existing.cacheRead += cacheRead;
		existing.cacheWrite += cacheWrite;
		existing.cost += cost;
		existing.lastUsed = Date.now();
	} else {
		modelUsageCounts.set(key, {
			count: 1,
			tokensIn,
			tokensOut,
			cacheRead,
			cacheWrite,
			cost,
			lastUsed: Date.now(),
		});
	}

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
			cacheRead: 0,
			cacheWrite: 0,
			cost: 0,
			lastUsed: Date.now(),
		});
	}

	// Persist to disk
	persistUsage(
		provider,
		modelId,
		tokensIn,
		tokensOut,
		cacheRead,
		cacheWrite,
		cost,
	);
}

export function getModelUsage(
	provider: string,
	modelId: string,
): ModelUsageEntry | undefined {
	return modelUsageCounts.get(`${provider}/${modelId}`);
}

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

	return results.sort((a, b) => b.count - a.count);
}

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

export function logModelUsageReport(provider?: string): void {
	if (provider) {
		const models = getProviderModelUsage(provider);
		const total = models.reduce((sum, m) => sum + m.count, 0);
		const totalTokensIn = models.reduce((sum, m) => sum + m.tokensIn, 0);
		const totalTokensOut = models.reduce((sum, m) => sum + m.tokensOut, 0);

		logger.info(`${provider} usage summary: ${total} total requests`, {
			total,
			tokensInK: Math.round(totalTokensIn / 1000),
			tokensOutK: Math.round(totalTokensOut / 1000),
		});
		for (const m of models.slice(0, 5)) {
			logger.debug(`${m.modelId} stats: ${m.count} requests`, {
				modelId: m.modelId,
				count: m.count,
				tokensInK: Math.round(m.tokensIn / 1000),
			});
		}
	} else {
		logger.info("Top 10 models across all providers");
		for (const m of getTopModels(10)) {
			logger.debug(`${m.provider}/${m.modelId}: ${m.count} requests`, {
				provider: m.provider,
				modelId: m.modelId,
				count: m.count,
				tokensInK: Math.round(m.tokensIn / 1000),
			});
		}
	}
}

export interface SessionUsageReport {
	duration: number;
	durationFormatted: string;
	providers: Array<{
		name: string;
		requests: number;
		tokensIn: number;
		tokensOut: number;
		cacheRead: number;
		cacheWrite: number;
		cost: number;
		topModels: Array<{
			modelId: string;
			count: number;
			tokensIn: number;
			tokensOut: number;
			cacheRead: number;
			cacheWrite: number;
			cost: number;
		}>;
	}>;
	totalRequests: number;
	totalTokensIn: number;
	totalTokensOut: number;
	totalCacheRead: number;
	totalCacheWrite: number;
	totalCost: number;
}

function formatDuration(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);

	if (hours > 0) return `${hours}h ${minutes % 60}m`;
	if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
	return `${seconds}s`;
}

export function getSessionUsage(): SessionUsageReport {
	const now = Date.now();
	const duration = now - sessionStats.startTime;

	const providers: SessionUsageReport["providers"] = [];
	let totalRequests = 0;
	let totalTokensIn = 0;
	let totalTokensOut = 0;
	let totalCacheRead = 0;
	let totalCacheWrite = 0;
	let totalCost = 0;

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
				cacheRead: m.cacheRead,
				cacheWrite: m.cacheWrite,
				cost: m.cost,
			}))
			.sort((a, b) => b.count - a.count)
			.slice(0, 5);

		// Sum cache and cost from models
		const providerCacheRead = topModels.reduce((s, m) => s + m.cacheRead, 0);
		const providerCacheWrite = topModels.reduce((s, m) => s + m.cacheWrite, 0);
		const providerCost = topModels.reduce((s, m) => s + m.cost, 0);
		totalCacheRead += providerCacheRead;
		totalCacheWrite += providerCacheWrite;
		totalCost += providerCost;

		providers.push({
			name: providerName,
			requests: stats.requests,
			tokensIn: stats.tokensIn,
			tokensOut: stats.tokensOut,
			cacheRead: providerCacheRead,
			cacheWrite: providerCacheWrite,
			cost: providerCost,
			topModels,
		});
	}

	providers.sort((a, b) => b.requests - a.requests);

	return {
		duration,
		durationFormatted: formatDuration(duration),
		providers,
		totalRequests,
		totalTokensIn,
		totalTokensOut,
		totalCacheRead,
		totalCacheWrite,
		totalCost,
	};
}
