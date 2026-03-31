/**
 * Widget data collection - aggregates metrics from all sources
 */

import {
	PROVIDER_CLINE,
	PROVIDER_KILO,
	PROVIDER_NVIDIA,
	PROVIDER_OPENROUTER,
	PROVIDER_ZEN,
} from "../constants.ts";
import {
	getCachedMetrics,
	getDailyRequestCount,
	getRequestCount,
} from "../metrics.ts";
import { getAllCumulativeUsage } from "../usage-store.ts";

export interface ProviderRow {
	provider: string;
	key: string;
	icon: string;
	sessionReqs: number;
	dailyReqs: number;
	dailyLimit?: number;
	hourlyLimit?: number;
	remainingToday?: number;
	totalTokensIn: number;
	totalTokensOut: number;
	totalRequests: number;
	costEquivalent: number;
	firstUsed?: string;
	credits?: number;
	creditsLabel?: string;
}

const KNOWN_PROVIDERS: Record<string, { icon: string; label: string }> = {
	[PROVIDER_KILO]: { icon: "🔥", label: "Kilo" },
	[PROVIDER_OPENROUTER]: { icon: "🔀", label: "OpenRouter" },
	[PROVIDER_ZEN]: { icon: "✦", label: "Zen" },
	[PROVIDER_NVIDIA]: { icon: "⚡", label: "NVIDIA" },
	[PROVIDER_CLINE]: { icon: "🤖", label: "Cline" },
	local: { icon: "💻", label: "Local" },
};

// Session-level request tracking for non-extension providers
const sessionRequestCounts = new Map<string, number>();

export function recordSessionRequest(provider: string): void {
	const current = sessionRequestCounts.get(provider) ?? 0;
	sessionRequestCounts.set(provider, current + 1);
}

export function collectRows(): ProviderRow[] {
	const cumulative = getAllCumulativeUsage();
	const orMetrics = getCachedMetrics(PROVIDER_OPENROUTER);
	const kiloMetrics = getCachedMetrics(PROVIDER_KILO);

	// Discover all providers: known ones + any from cumulative store
	const allKeys = new Set<string>(Object.keys(KNOWN_PROVIDERS));
	for (const key of Object.keys(cumulative)) {
		allKeys.add(key);
	}

	const rows: ProviderRow[] = [];

	for (const key of allKeys) {
		const meta = KNOWN_PROVIDERS[key];
		const c = cumulative[key];
		const sessionReqs =
			getRequestCount(key) || sessionRequestCounts.get(key) || 0;

		const row: ProviderRow = {
			provider: meta?.label ?? key,
			key,
			icon: meta?.icon ?? "📦",
			sessionReqs,
			dailyReqs: getDailyRequestCount(key) || 0,
			totalTokensIn: c?.tokensIn ?? 0,
			totalTokensOut: c?.tokensOut ?? 0,
			totalRequests: c?.requests ?? 0,
			costEquivalent: c?.costEquivalent ?? 0,
			firstUsed: c?.firstUsed,
		};

		// Provider-specific known limits
		if (key === PROVIDER_OPENROUTER) {
			row.dailyLimit = orMetrics?.rateLimit?.requestsPerDay;
			row.remainingToday = orMetrics?.rateLimit?.remainingToday;
			row.credits = orMetrics?.credits;
			row.creditsLabel = "credits";
		} else if (key === PROVIDER_KILO) {
			row.hourlyLimit = 200;
			row.credits = kiloMetrics?.balance;
			row.creditsLabel = "balance";
		}

		rows.push(row);
	}

	// Sort: known providers first (in order), then unknown, then inactive
	const order = Object.keys(KNOWN_PROVIDERS);
	rows.sort((a, b) => {
		const ai = order.indexOf(a.key);
		const bi = order.indexOf(b.key);
		const aOrder = ai >= 0 ? ai : 100;
		const bOrder = bi >= 0 ? bi : 100;
		if (aOrder !== bOrder) return aOrder - bOrder;
		return b.sessionReqs + b.totalRequests - (a.sessionReqs + a.totalRequests);
	});

	return rows;
}
