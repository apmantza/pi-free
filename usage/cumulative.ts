/**
 * Cumulative usage persistence - disk storage for all-time stats
 */

import { join } from "node:path";
import { createJSONStore } from "../lib/json-persistence.ts";
import { createLogger } from "../lib/logger.ts";

const _logger = createLogger("usage:cumulative");

const PI_DIR = join(process.env.HOME || process.env.USERPROFILE || "", ".pi");
const USAGE_FILE = join(PI_DIR, "free-cumulative-usage.json");

interface CumulativeProviderStats {
	totalRequests: number;
	totalTokensIn: number;
	totalTokensOut: number;
	totalCacheRead: number;
	totalCacheWrite: number;
	totalCost: number;
	models: Record<
		string,
		{
			count: number;
			tokensIn: number;
			tokensOut: number;
			cacheRead: number;
			cacheWrite: number;
			cost: number;
		}
	>;
	firstUsed: string;
	lastUsed: string;
}

interface CumulativeUsage {
	providers: Record<string, CumulativeProviderStats>;
	grandTotalRequests: number;
	grandTotalTokensIn: number;
	grandTotalTokensOut: number;
	grandTotalCacheRead: number;
	grandTotalCacheWrite: number;
	grandTotalCost: number;
}

const cumulativeStore = createJSONStore<CumulativeUsage>(USAGE_FILE, {
	providers: {},
	grandTotalRequests: 0,
	grandTotalTokensIn: 0,
	grandTotalTokensOut: 0,
	grandTotalCacheRead: 0,
	grandTotalCacheWrite: 0,
	grandTotalCost: 0,
});

export function persistUsage(
	provider: string,
	modelId: string,
	tokensIn: number,
	tokensOut: number,
	cacheRead: number,
	cacheWrite: number,
	cost: number,
): void {
	const data = cumulativeStore.load();
	const now = new Date().toISOString();

	let providerStats = data.providers[provider];
	if (!providerStats) {
		providerStats = {
			totalRequests: 0,
			totalTokensIn: 0,
			totalTokensOut: 0,
			totalCacheRead: 0,
			totalCacheWrite: 0,
			totalCost: 0,
			models: {},
			firstUsed: now,
			lastUsed: now,
		};
		data.providers[provider] = providerStats;
	}

	providerStats.totalRequests++;
	providerStats.totalTokensIn += tokensIn;
	providerStats.totalTokensOut += tokensOut;
	providerStats.totalCacheRead += cacheRead;
	providerStats.totalCacheWrite += cacheWrite;
	providerStats.totalCost += cost;
	providerStats.lastUsed = now;

	const modelStats = providerStats.models[modelId] ?? {
		count: 0,
		tokensIn: 0,
		tokensOut: 0,
		cacheRead: 0,
		cacheWrite: 0,
		cost: 0,
	};
	modelStats.count++;
	modelStats.tokensIn += tokensIn;
	modelStats.tokensOut += tokensOut;
	modelStats.cacheRead += cacheRead;
	modelStats.cacheWrite += cacheWrite;
	modelStats.cost += cost;
	providerStats.models[modelId] = modelStats;

	data.grandTotalRequests++;
	data.grandTotalTokensIn += tokensIn;
	data.grandTotalTokensOut += tokensOut;
	data.grandTotalCacheRead += cacheRead;
	data.grandTotalCacheWrite += cacheWrite;
	data.grandTotalCost += cost;

	cumulativeStore.save(data);
}

export interface CumulativeUsageReport {
	providers: Array<{
		name: string;
		totalRequests: number;
		totalTokensIn: number;
		totalTokensOut: number;
		totalCacheRead: number;
		totalCacheWrite: number;
		totalCost: number;
		modelCount: number;
		firstUsed: string;
		lastUsed: string;
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
	grandTotalRequests: number;
	grandTotalTokensIn: number;
	grandTotalTokensOut: number;
	grandTotalCacheRead: number;
	grandTotalCacheWrite: number;
	grandTotalCost: number;
}

export function getCumulativeUsage(): CumulativeUsageReport {
	const data = cumulativeStore.load();

	const providers: CumulativeUsageReport["providers"] = [];

	for (const [name, stats] of Object.entries(data.providers)) {
		const topModels = Object.entries(stats.models)
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

		providers.push({
			name,
			totalRequests: stats.totalRequests,
			totalTokensIn: stats.totalTokensIn,
			totalTokensOut: stats.totalTokensOut,
			totalCacheRead: stats.totalCacheRead,
			totalCacheWrite: stats.totalCacheWrite,
			totalCost: stats.totalCost,
			modelCount: Object.keys(stats.models).length,
			firstUsed: stats.firstUsed,
			lastUsed: stats.lastUsed,
			topModels,
		});
	}

	providers.sort((a, b) => b.totalRequests - a.totalRequests);

	return {
		providers,
		grandTotalRequests: data.grandTotalRequests,
		grandTotalTokensIn: data.grandTotalTokensIn,
		grandTotalTokensOut: data.grandTotalTokensOut,
		grandTotalCacheRead: data.grandTotalCacheRead,
		grandTotalCacheWrite: data.grandTotalCacheWrite,
		grandTotalCost: data.grandTotalCost,
	};
}
