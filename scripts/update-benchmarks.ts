/**
 * Script to update hardcoded benchmark data
 * Run: ARTIFICIAL_ANALYSIS_API_KEY=xxx npx tsx scripts/update-benchmarks.ts
 *
 * This fetches fresh data from Artificial Analysis API and updates
 * provider-failover/hardcoded-benchmarks.ts
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";

const API_KEY = process.env.ARTIFICIAL_ANALYSIS_API_KEY;

if (!API_KEY) {
	console.error(
		"❌ Error: ARTIFICIAL_ANALYSIS_API_KEY environment variable required",
	);
	console.error("Get a free key at: https://artificialanalysis.ai");
	process.exit(1);
}

interface AAModel {
	id: string;
	name: string;
	slug: string;
	creator: string;
	context_window: number;
	supports_reasoning: boolean;
	supports_vision: boolean;
	artificial_analysis_intelligence_index?: number;
	coding_index?: number;
	agentic_index?: number;
	reasoning_index?: number;
}

async function fetchAIData(): Promise<AAModel[]> {
	console.log("📡 Fetching data from Artificial Analysis API...");

	const response = await fetch(
		"https://artificialanalysis.ai/api/v2/data/llms/models",
		{
			headers: {
				"x-api-key": API_KEY,
				Accept: "application/json",
			},
		},
	);

	if (!response.ok) {
		throw new Error(`API error: ${response.status} ${response.statusText}`);
	}

	const rawData = (await response.json()) as unknown;

	// API returns { data: [...] } or direct array
	let models: AAModel[];
	if (Array.isArray(rawData)) {
		models = rawData as AAModel[];
	} else if (rawData && typeof rawData === "object") {
		const obj = rawData as Record<string, unknown>;
		models = (obj.data || obj.models || []) as AAModel[];
	} else {
		models = [];
	}

	if (!Array.isArray(models) || models.length === 0) {
		console.error("Unexpected API response structure");
		throw new Error("API response did not contain models array");
	}

	return models;
}

function normalizeModelName(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9.-]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

function generateBenchmarksFile(models: AAModel[]): string {
	const today = new Date().toISOString().split("T")[0];

	// Filter to models with intelligence scores
	const scoredModels = models.filter(
		(m) => m.artificial_analysis_intelligence_index,
	);

	console.log(`✅ Found ${scoredModels.length} models with benchmark scores`);

	// Generate entries
	const entries = scoredModels.map((model) => {
		const key = normalizeModelName(model.name);
		const score = model.artificial_analysis_intelligence_index!;
		const normalized = Math.round((score / 70) * 100);

		return `  "${key}": {
    intelligenceIndex: ${score.toFixed(1)},
    normalizedScore: ${normalized},
    codingIndex: ${model.coding_index?.toFixed(1) || "undefined"},
    agenticIndex: ${model.agentic_index?.toFixed(1) || "undefined"},
    reasoningIndex: ${model.reasoning_index?.toFixed(1) || "undefined"},
    contextWindow: ${model.context_window},
    supportsReasoning: ${model.supports_reasoning},
    supportsVision: ${model.supports_vision},
    lastUpdated: "${today}",
  },`;
	});

	return `/**
 * Hardcoded benchmark data from Artificial Analysis
 * Updated monthly via GitHub Actions
 * Last updated: ${today}
 * 
 * This file contains cached benchmark scores so users don't need API keys.
 * Scores are Artificial Analysis Intelligence Index (0-70 scale)
 * Normalized to 0-100 for our ranking system.
 * 
 * To update: Run scripts/update-benchmarks.ts with ARTIFICIAL_ANALYSIS_API_KEY
 */

export interface HardcodedBenchmark {
  intelligenceIndex: number; // AA score 0-70
  normalizedScore: number; // Our score 0-100
  codingIndex?: number;
  agenticIndex?: number;
  reasoningIndex?: number;
  contextWindow: number;
  supportsReasoning: boolean;
  supportsVision: boolean;
  lastUpdated: string;
}

// Map of model identifiers to benchmark data
// Keys are normalized model names (lowercase, no special chars)
export const HARDCODED_BENCHMARKS: Record<string, HardcodedBenchmark> = {
${entries.join("\n")}
};

/**
 * Find benchmark data by model name
 */
export function findHardcodedBenchmark(
  modelName: string,
  modelId: string,
): HardcodedBenchmark | null {
  const search = \`\${modelName} \${modelId}\`.toLowerCase();
  
  // Direct lookup
  for (const [key, data] of Object.entries(HARDCODED_BENCHMARKS)) {
    if (search.includes(key.toLowerCase())) {
      return data;
    }
  }
  
  // Variant matching
  const variants: Record<string, string[]> = {
    "gpt-4o": ["gpt-4o", "gpt-4-o"],
    "gpt-4": ["gpt-4", "gpt4"],
    "claude-3.5-sonnet": ["claude-3.5-sonnet", "claude-3-5-sonnet", "sonnet-3.5"],
    "claude-3-opus": ["claude-3-opus", "opus-3"],
    "llama-3.1-405b": ["llama-3.1-405b", "llama3.1-405b", "llama-405b"],
    "llama-3.1-70b": ["llama-3.1-70b", "llama3.1-70b", "llama-70b"],
    "gemini-1.5-pro": ["gemini-1.5-pro", "gemini1.5-pro", "gemini-pro-1.5"],
    "qwen2.5-72b": ["qwen2.5-72b", "qwen-2.5-72b"],
    "deepseek-v3": ["deepseek-v3", "deepseekv3", "deepseek-chat"],
    "mimo-v2-pro": ["mimo-v2-pro", "mimo-v2-pro-free", "mimo-pro"],
    "big-pickle": ["big-pickle", "bigpickle"],
    "minimax-m2.5": ["minimax-m2.5", "minimax-m2.5-free", "minimax-m25"],
  };
  
  for (const [canonical, names] of Object.entries(variants)) {
    if (names.some(n => search.includes(n.toLowerCase()))) {
      return HARDCODED_BENCHMARKS[canonical] || null;
    }
  }
  
  return null;
}

/**
 * Get score from hardcoded data
 */
export function getHardcodedScore(modelName: string, modelId: string): number | null {
  const benchmark = findHardcodedBenchmark(modelName, modelId);
  return benchmark?.normalizedScore ?? null;
}
`;
}

async function main() {
	try {
		console.log("🔄 Benchmark Data Updater\n");

		const models = await fetchAIData();
		const fileContent = generateBenchmarksFile(models);

		const outputPath = join(
			process.cwd(),
			"provider-failover",
			"hardcoded-benchmarks.ts",
		);

		writeFileSync(outputPath, fileContent, "utf-8");

		console.log(`\n✅ Updated: ${outputPath}`);
		console.log("\n📝 Next steps:");
		console.log("  1. Review the changes");
		console.log("  2. Run tests: npm run test:run");
		console.log("  3. Commit and push");
		console.log("  4. Create PR if this was an automated update");
	} catch (error) {
		console.error("\n❌ Error:", error);
		process.exit(1);
	}
}

main();
