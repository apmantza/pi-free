/**
 * Provider usage metrics - tracks rate limits and usage for each provider.
 */

import { OPENCODE_API_KEY, OPENROUTER_API_KEY } from "../config.ts";
import {
	BASE_URL_OPENROUTER,
	BASE_URL_ZEN,
	DEFAULT_FETCH_TIMEOUT_MS,
} from "../constants.ts";
import { fetchWithTimeout, logWarning } from "../util.ts";

// =============================================================================
// Types
// =============================================================================

export interface ProviderMetrics {
	provider: string;
	rateLimit?: {
		requestsPerMinute?: number;
		requestsPerDay?: number;
		remainingToday?: number;
	};
	balance?: number;
	credits?: number;
	requestsToday: number;
	lastUpdated: number;
}

// =============================================================================
// Request counting (in-memory per session)
// =============================================================================

const requestCounts: Map<string, number> = new Map();
const dailyRequestCounts: Map<string, { count: number; date: string }> =
	new Map();

function getTodayDate(): string {
	return new Date().toISOString().split("T")[0];
}

export function incrementRequestCount(provider: string): void {
	const key = `${provider}_session`;
	const count = requestCounts.get(key) || 0;
	requestCounts.set(key, count + 1);

	// Daily counter
	const today = getTodayDate();
	const dailyKey = `${provider}_daily`;
	const daily = dailyRequestCounts.get(dailyKey);
	if (daily && daily.date === today) {
		daily.count++;
	} else {
		dailyRequestCounts.set(dailyKey, { count: 1, date: today });
	}
}

export function getRequestCount(provider: string): number {
	return requestCounts.get(`${provider}_session`) || 0;
}

export function getDailyRequestCount(provider: string): number {
	const today = getTodayDate();
	const daily = dailyRequestCounts.get(`${provider}_daily`);
	return daily && daily.date === today ? daily.count : 0;
}

// =============================================================================
// OpenRouter metrics
// =============================================================================

interface OpenRouterKeyResponse {
	usage?: {
		"24h": number;
		"7d": number;
		total: number;
	};
	limit?: {
		"24h": number;
		"7d": number;
		total: number;
	};
	soft_limit?: boolean;
}

interface OpenRouterCreditsResponse {
	data?: {
		credits_purchased: number;
		credits_used: number;
	};
}

export async function fetchOpenRouterMetrics(): Promise<ProviderMetrics | null> {
	if (!OPENROUTER_API_KEY) return null;

	try {
		// Fetch both key info and credits in parallel
		const [keyResponse, creditsResponse] = await Promise.all([
			fetchWithTimeout(
				`${BASE_URL_OPENROUTER}/key`,
				{
					headers: {
						Authorization: `Bearer ${OPENROUTER_API_KEY}`,
						"User-Agent": "pi-free-providers",
					},
				},
				DEFAULT_FETCH_TIMEOUT_MS,
			),
			fetchWithTimeout(
				`${BASE_URL_OPENROUTER}/credits`,
				{
					headers: {
						Authorization: `Bearer ${OPENROUTER_API_KEY}`,
						"User-Agent": "pi-free-providers",
					},
				},
				DEFAULT_FETCH_TIMEOUT_MS,
			),
		]);

		let limit24h: number | undefined;
		let usage24h: number | undefined;
		let credits = 0;

		if (keyResponse.ok) {
			const keyData = (await keyResponse.json()) as OpenRouterKeyResponse;
			limit24h = keyData.limit?.["24h"];
			usage24h = keyData.usage?.["24h"];
		}

		if (creditsResponse.ok) {
			const creditsData =
				(await creditsResponse.json()) as OpenRouterCreditsResponse;
			if (creditsData.data) {
				credits =
					creditsData.data.credits_purchased - creditsData.data.credits_used;
			}
		}

		const dailyCount = getDailyRequestCount("openrouter");

		return {
			provider: "openrouter",
			rateLimit: {
				requestsPerMinute: 20, // Fixed for free models
				requestsPerDay: limit24h,
				remainingToday: limit24h && usage24h ? limit24h - usage24h : undefined,
			},
			credits,
			requestsToday: dailyCount,
			lastUpdated: Date.now(),
		};
	} catch (error) {
		logWarning("openrouter", "Failed to fetch metrics", error);
		return null;
	}
}

// =============================================================================
// OpenCode metrics (balance only - no rate limits known)
// =============================================================================

export async function fetchOpenCodeMetrics(): Promise<ProviderMetrics | null> {
	if (!OPENCODE_API_KEY) return null;

	try {
		const response = await fetchWithTimeout(
			`${BASE_URL_ZEN}/user`,
			{
				headers: {
					Authorization: `Bearer ${OPENCODE_API_KEY}`,
					"User-Agent": "pi-free-providers",
				},
			},
			DEFAULT_FETCH_TIMEOUT_MS,
		);

		if (!response.ok) {
			return null;
		}

		const data = (await response.json()) as {
			balance?: number;
			credits?: number;
		};
		const dailyCount = getDailyRequestCount("opencode");

		return {
			provider: "opencode",
			balance: data.balance,
			credits: data.credits,
			requestsToday: dailyCount,
			lastUpdated: Date.now(),
		};
	} catch (error) {
		logWarning("opencode", "Failed to fetch metrics", error);
		return null;
	}
}

// =============================================================================
// Cached metrics storage
// =============================================================================

const metricsCache: Map<string, { data: ProviderMetrics; timestamp: number }> =
	new Map();
const CACHE_TTL_MS = 60_000; // 1 minute cache

export function getCachedMetrics(provider: string): ProviderMetrics | null {
	const cached = metricsCache.get(provider);
	if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
		return cached.data;
	}
	return null;
}

export function setCachedMetrics(
	provider: string,
	metrics: ProviderMetrics,
): void {
	metricsCache.set(provider, { data: metrics, timestamp: Date.now() });
}
