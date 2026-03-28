/**
 * Artificial Analysis API Integration
 * Real benchmark data for model capability ranking
 * API: https://artificialanalysis.ai/api-reference
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CACHE_DIR = join(
	process.env.HOME || process.env.USERPROFILE || "",
	".pi",
	"cache",
);
const CACHE_FILE = join(CACHE_DIR, "artificial-analysis.json");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// API key from config
const AA_API_KEY = process.env.ARTIFICIAL_ANALYSIS_API_KEY;

export interface AAModelData {
	id: string;
	name: string;
	slug: string;
	creator: string;
	// Benchmark scores
	artificial_analysis_intelligence_index?: number; // Overall capability score
	coding_index?: number;
	agentic_index?: number;
	reasoning_index?: number;
	// Capabilities
	context_window: number;
	supports_vision: boolean;
	supports_reasoning: boolean;
	// Performance
	median_output_tokens_per_second?: number;
	pricing_input_per_1m?: number;
	pricing_output_per_1m?: number;
	// Metadata
	last_updated: string;
}

/**
 * Fetch model data from Artificial Analysis API
 */
export async function fetchArtificialAnalysisData(): Promise<AAModelData[]> {
	if (!AA_API_KEY) {
		console.warn(
			"[artificial-analysis] No API key set (ARTIFICIAL_ANALYSIS_API_KEY)",
		);
		return [];
	}

	try {
		const response = await fetch(
			"https://artificialanalysis.ai/api/v2/data/llms/models",
			{
				headers: {
					"x-api-key": AA_API_KEY,
					Accept: "application/json",
				},
			},
		);

		if (!response.ok) {
			throw new Error(`API error: ${response.status} ${response.statusText}`);
		}

		const data = (await response.json()) as AAModelData[];

		// Cache the result
		saveCache(data);

		return data;
	} catch (error) {
		console.error("[artificial-analysis] Failed to fetch:", error);
		// Return cached data if available
		return loadCache();
	}
}

/**
 * Load cached data
 */
function loadCache(): AAModelData[] {
	try {
		if (!existsSync(CACHE_FILE)) return [];

		const cache = JSON.parse(readFileSync(CACHE_FILE, "utf-8"));
		const age = Date.now() - cache.timestamp;

		if (age > CACHE_TTL_MS) {
			console.log("[artificial-analysis] Cache expired");
			return [];
		}

		return cache.data;
	} catch {
		return [];
	}
}

/**
 * Save data to cache
 */
function saveCache(data: AAModelData[]): void {
	try {
		if (!existsSync(CACHE_DIR)) {
			mkdirSync(CACHE_DIR, { recursive: true });
		}

		writeFileSync(
			CACHE_FILE,
			JSON.stringify({ timestamp: Date.now(), data }, null, 2),
			"utf-8",
		);
	} catch (error) {
		console.error("[artificial-analysis] Failed to cache:", error);
	}
}

/**
 * Find model by name (fuzzy matching)
 */
export function findAAModel(
	modelName: string,
	modelId: string,
	data: AAModelData[],
): AAModelData | null {
	const searchTerms = [modelName, modelId].map((s) => s.toLowerCase());

	// Try exact match first
	for (const model of data) {
		if (
			searchTerms.some(
				(term) =>
					model.name.toLowerCase() === term ||
					model.slug.toLowerCase() === term ||
					model.id.toLowerCase() === term,
			)
		) {
			return model;
		}
	}

	// Try partial match
	for (const model of data) {
		if (
			searchTerms.some(
				(term) =>
					model.name.toLowerCase().includes(term) ||
					term.includes(model.name.toLowerCase()) ||
					model.slug.toLowerCase().includes(term),
			)
		) {
			return model;
		}
	}

	return null;
}

/**
 * Get capability score from AA data
 * Returns score 0-100 based on Intelligence Index
 */
export function getAAScore(model: AAModelData | null): number | null {
	if (!model?.artificial_analysis_intelligence_index) return null;

	// Intelligence Index is roughly 0-70 scale
	// Normalize to 0-100
	const score = (model.artificial_analysis_intelligence_index / 70) * 100;
	return Math.min(100, Math.round(score));
}

/**
 * Initialize - fetch data if needed
 */
export async function initArtificialAnalysis(): Promise<boolean> {
	// Check if we have fresh cache
	const cached = loadCache();
	if (cached.length > 0) {
		console.log(
			`[artificial-analysis] Using cached data (${cached.length} models)`,
		);
		return true;
	}

	// Try to fetch fresh data
	if (!AA_API_KEY) {
		console.log("[artificial-analysis] No API key, using heuristic estimation");
		return false;
	}

	console.log("[artificial-analysis] Fetching fresh data...");
	const data = await fetchArtificialAnalysisData();

	if (data.length > 0) {
		console.log(`[artificial-analysis] Fetched ${data.length} models`);
		return true;
	}

	return false;
}

// Export for use in capability ranking
export { AA_API_KEY };
