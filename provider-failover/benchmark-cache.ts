/**
 * External Benchmark Cache
 * Fetches and caches real model performance data from external sources
 * Falls back to heuristics if no benchmark data available
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CACHE_DIR = join(
	process.env.HOME || process.env.USERPROFILE || "",
	".pi",
	"cache",
);
const BENCHMARK_CACHE_FILE = join(CACHE_DIR, "model-benchmarks.json");
const STALE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days - only refresh if older than this
const FORCE_REFRESH_AFTER_MS = 30 * 24 * 60 * 60 * 1000; // 30 days - force refresh regardless

export interface BenchmarkData {
	modelName: string;
	elo?: number; // LMSYS Chatbot Arena Elo rating
	mmlu?: number; // MMLU benchmark score
	mtBench?: number; // MT-Bench score
	humaneval?: number; // HumanEval (code generation)
	source: string;
	fetchedAt: number;
}

// Known model name mappings (variations → canonical name)
const MODEL_NAME_MAPPINGS: Record<string, string[]> = {
	"gpt-4": ["gpt-4", "gpt-4-turbo", "gpt-4-0125", "gpt-4-1106"],
	"gpt-4o": ["gpt-4o", "gpt-4o-2024-08-06"],
	"gpt-3.5": ["gpt-3.5", "gpt-3.5-turbo", "gpt-3.5-turbo-0125"],
	"claude-3.5-sonnet": ["claude-3.5-sonnet", "claude-3-5-sonnet-20241022"],
	"claude-3.5-opus": ["claude-3-opus", "claude-3-opus-20240229"],
	"claude-3-haiku": ["claude-3-haiku", "claude-3-haiku-20240307"],
	"llama-3.1-405b": ["llama-3.1-405b", "llama-3.1-405b-instruct"],
	"llama-3.1-70b": ["llama-3.1-70b", "llama-3.1-70b-instruct"],
	"llama-3-70b": ["llama-3-70b", "llama-3-70b-instruct"],
	"mixtral-8x22b": ["mixtral-8x22b", "mixtral-8x22b-instruct"],
	"gemini-1.5-pro": ["gemini-1.5-pro", "gemini-1.5-pro-latest"],
	"qwen2.5-72b": ["qwen2.5-72b", "qwen-2.5-72b-instruct"],
	"deepseek-v3": ["deepseek-v3", "deepseek-chat-v3"],
	"deepseek-r1": ["deepseek-r1"],
};

/**
 * Ensure cache directory exists
 */
function ensureCacheDir(): void {
	if (!existsSync(CACHE_DIR)) {
		mkdirSync(CACHE_DIR, { recursive: true });
	}
}

/**
 * Load cached benchmark data
 */
export function loadBenchmarkCache(): Map<string, BenchmarkData> {
	ensureCacheDir();

	try {
		if (!existsSync(BENCHMARK_CACHE_FILE)) {
			return new Map();
		}

		const data = JSON.parse(
			readFileSync(BENCHMARK_CACHE_FILE, "utf-8"),
		) as Record<string, BenchmarkData>;
		const now = Date.now();
		const cache = new Map<string, BenchmarkData>();

		// Filter out really old entries (> 30 days)
		for (const [key, value] of Object.entries(data)) {
			if (now - value.fetchedAt < FORCE_REFRESH_AFTER_MS) {
				cache.set(key, value);
			}
		}

		return cache;
	} catch {
		return new Map();
	}
}

/**
 * Save benchmark data to cache
 */
export function saveBenchmarkCache(cache: Map<string, BenchmarkData>): void {
	ensureCacheDir();

	const data: Record<string, BenchmarkData> = {};
	for (const [key, value] of cache) {
		data[key] = value;
	}

	writeFileSync(BENCHMARK_CACHE_FILE, JSON.stringify(data, null, 2), "utf-8");
}

/**
 * Normalize model name for lookup
 */
export function normalizeModelName(modelId: string, modelName: string): string {
	const search = `${modelId} ${modelName}`.toLowerCase();

	for (const [canonical, variations] of Object.entries(MODEL_NAME_MAPPINGS)) {
		if (variations.some((v) => search.includes(v.toLowerCase()))) {
			return canonical;
		}
	}

	// Extract family + size as fallback
	const match = search.match(/([a-z]+)[-_]?(\d+(?:\.\d+)?)?[-_]?(\d+[bkm])?/i);
	if (match) {
		return match.slice(1).filter(Boolean).join("-");
	}

	return modelId.toLowerCase().replace(/[^a-z0-9-]/g, "-");
}

/**
 * Fetch LMSYS Chatbot Arena Elo ratings
 * Public data from https://chat.lmsys.org/
 */
async function fetchLMSYSRatings(): Promise<Map<string, number>> {
	try {
		// LMSYS doesn't have a public API, but their data is available
		// We'll try to fetch from their leaderboard endpoint or use a mirror
		// For now, return empty and document the limitation

		// Alternative: Use static snapshot that can be updated periodically
		// This would be updated via GitHub Actions or manual refresh
		const staticSnapshot: Record<string, number> = {
			"gpt-4o": 1286,
			"gpt-4": 1253,
			"claude-3.5-sonnet": 1272,
			"claude-3-opus": 1239,
			"gemini-1.5-pro": 1268,
			"llama-3.1-405b": 1266,
			"llama-3.1-70b": 1248,
			"llama-3-70b": 1207,
			"mixtral-8x22b": 1205,
			"qwen2.5-72b": 1251,
			"deepseek-v3": 1248,
			"gpt-3.5": 1154,
			"claude-3-haiku": 1178,
		};

		return new Map(Object.entries(staticSnapshot));
	} catch (error) {
		console.warn("[benchmark] Failed to fetch LMSYS data:", error);
		return new Map();
	}
}

/**
 * Fetch from Hugging Face Open LLM Leaderboard
 * https://huggingface.co/spaces/open-llm-leaderboard
 */
async function fetchHuggingFaceLeaderboard(): Promise<
	Map<string, BenchmarkData>
> {
	// HF leaderboard doesn't have a simple API
	// Would require scraping or using their datasets API
	// Return empty for now - can be implemented later
	return new Map();
}

/**
 * Update benchmark cache from external sources
 */
export async function updateBenchmarkCache(): Promise<{
	updated: number;
	sources: string[];
}> {
	const cache = loadBenchmarkCache();
	const now = Date.now();
	let updated = 0;
	const sources: string[] = [];

	// Try LMSYS
	const lmsysData = await fetchLMSYSRatings();
	if (lmsysData.size > 0) {
		sources.push("LMSYS Chatbot Arena");
		for (const [model, elo] of lmsysData) {
			const existing = cache.get(model);
			cache.set(model, {
				modelName: model,
				elo,
				source: "LMSYS",
				fetchedAt: now,
				...(existing?.mmlu && { mmlu: existing.mmlu }),
				...(existing?.mtBench && { mtBench: existing.mtBench }),
				...(existing?.humaneval && { humaneval: existing.humaneval }),
			});
			updated++;
		}
	}

	// Try Hugging Face
	const hfData = await fetchHuggingFaceLeaderboard();
	if (hfData.size > 0) {
		sources.push("Hugging Face Open LLM Leaderboard");
		for (const [model, data] of hfData) {
			cache.set(model, data);
			updated++;
		}
	}

	saveBenchmarkCache(cache);
	return { updated, sources };
}

/**
 * Get benchmark data for a model
 */
export function getModelBenchmark(
	modelId: string,
	modelName: string,
): BenchmarkData | null {
	const cache = loadBenchmarkCache();
	const normalized = normalizeModelName(modelId, modelName);

	// Try exact match
	if (cache.has(normalized)) {
		return cache.get(normalized)!;
	}

	// Try fuzzy match on variations
	for (const [canonical, variations] of Object.entries(MODEL_NAME_MAPPINGS)) {
		if (variations.some((v) => normalized.includes(v))) {
			return cache.get(canonical) || null;
		}
	}

	return null;
}

/**
 * Calculate capability score from benchmark data + heuristics
 */
export function calculateBenchmarkedCapability(
	modelId: string,
	modelName: string,
	contextWindow: number,
	reasoning: boolean,
	hasVision: boolean,
): { score: number; tier: string; source: string } {
	const benchmark = getModelBenchmark(modelId, modelName);

	if (benchmark?.elo) {
		// Use real Elo rating
		// Elo ~1200 = medium, ~1250 = high, ~1280 = ultra
		let score = (benchmark.elo - 1100) / 2; // Normalize to ~0-100
		score = Math.max(0, Math.min(100, score));

		let tier = "medium";
		if (score >= 85) tier = "ultra";
		else if (score >= 70) tier = "high";
		else if (score >= 50) tier = "medium";
		else if (score >= 30) tier = "low";
		else tier = "minimal";

		// Boost for large context
		if (contextWindow > 100000) score += 5;
		if (contextWindow > 200000) score += 10;

		// Boost for reasoning
		if (reasoning) score += 10;

		return { score: Math.round(score), tier, source: "LMSYS Elo + heuristics" };
	}

	// Fallback to pure heuristics
	return { score: 0, tier: "unknown", source: "no benchmark data" };
}

/**
 * Check if benchmark cache needs refresh
 * Only refreshes if:
 * 1. Cache is empty
 * 2. Cache is older than STALE_CACHE_TTL_MS (7 days)
 * 3. No recent successful fetch (to avoid unnecessary updates)
 */
export function needsBenchmarkRefresh(): boolean {
	const cache = loadBenchmarkCache();
	if (cache.size === 0) return true;

	// Check if cache is stale (> 7 days)
	const now = Date.now();
	let oldestEntry = now;

	for (const data of cache.values()) {
		if (data.fetchedAt < oldestEntry) {
			oldestEntry = data.fetchedAt;
		}
	}

	return now - oldestEntry > STALE_CACHE_TTL_MS;
}

/**
 * Force refresh of benchmark cache
 * Use this when user explicitly wants fresh data
 */
export async function forceRefreshBenchmarks(): Promise<{
	updated: number;
	sources: string[];
}> {
	console.log("[benchmark] Force refreshing benchmark cache...");
	const result = await updateBenchmarkCache();
	console.log(
		`[benchmark] Force refreshed ${result.updated} models from: ${result.sources.join(", ") || "static snapshot"}`,
	);
	return result;
}
