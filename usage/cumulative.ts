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

const cumulativeStore = createJSONStore<CumulativeUsage>(USAGE_FILE, {
	providers: {},
	grandTotalRequests: 0,
	grandTotalTokensIn: 0,
	grandTotalTokensOut: 0,
});

export function persistUsage(
	provider: string,
	modelId: string,
	tokensIn: number,
	tokensOut: number,
): void {
	const data = cumulativeStore.load();
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

	cumulativeStore.save(data);
}

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

	providers.sort((a, b) => b.totalRequests - a.totalRequests);

	return {
		providers,
		grandTotalRequests: data.grandTotalRequests,
		grandTotalTokensIn: data.grandTotalTokensIn,
		grandTotalTokensOut: data.grandTotalTokensOut,
	};
}
