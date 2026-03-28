/**
 * Hardcoded benchmark data from Artificial Analysis
 * Updated monthly via GitHub Actions
 * Last updated: 2026-03-28
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
	// OpenAI models
	"gpt-4o": {
		intelligenceIndex: 64.2,
		normalizedScore: 92,
		codingIndex: 89.5,
		agenticIndex: 58.3,
		reasoningIndex: 87.0,
		contextWindow: 128000,
		supportsReasoning: true,
		supportsVision: true,
		lastUpdated: "2026-03-28",
	},
	"gpt-4": {
		intelligenceIndex: 58.0,
		normalizedScore: 83,
		codingIndex: 85.0,
		agenticIndex: 52.0,
		reasoningIndex: 82.0,
		contextWindow: 128000,
		supportsReasoning: true,
		supportsVision: true,
		lastUpdated: "2026-03-28",
	},
	"gpt-4o-mini": {
		intelligenceIndex: 52.0,
		normalizedScore: 74,
		codingIndex: 78.0,
		agenticIndex: 45.0,
		reasoningIndex: 70.0,
		contextWindow: 128000,
		supportsReasoning: true,
		supportsVision: true,
		lastUpdated: "2026-03-28",
	},
	"gpt-3.5-turbo": {
		intelligenceIndex: 42.0,
		normalizedScore: 60,
		codingIndex: 65.0,
		agenticIndex: 35.0,
		reasoningIndex: 55.0,
		contextWindow: 16385,
		supportsReasoning: false,
		supportsVision: false,
		lastUpdated: "2026-03-28",
	},

	// Anthropic models
	"claude-3.5-sonnet": {
		intelligenceIndex: 62.9,
		normalizedScore: 90,
		codingIndex: 91.0,
		agenticIndex: 61.5,
		reasoningIndex: 85.0,
		contextWindow: 200000,
		supportsReasoning: true,
		supportsVision: true,
		lastUpdated: "2026-03-28",
	},
	"claude-3-opus": {
		intelligenceIndex: 60.0,
		normalizedScore: 86,
		codingIndex: 88.0,
		agenticIndex: 56.0,
		reasoningIndex: 86.0,
		contextWindow: 200000,
		supportsReasoning: true,
		supportsVision: true,
		lastUpdated: "2026-03-28",
	},
	"claude-3.5-haiku": {
		intelligenceIndex: 48.0,
		normalizedScore: 69,
		codingIndex: 70.0,
		agenticIndex: 42.0,
		reasoningIndex: 65.0,
		contextWindow: 200000,
		supportsReasoning: false,
		supportsVision: true,
		lastUpdated: "2026-03-28",
	},
	"claude-3-haiku": {
		intelligenceIndex: 45.0,
		normalizedScore: 64,
		codingIndex: 68.0,
		agenticIndex: 40.0,
		reasoningIndex: 62.0,
		contextWindow: 200000,
		supportsReasoning: false,
		supportsVision: true,
		lastUpdated: "2026-03-28",
	},

	// Meta/Llama models
	"llama-3.1-405b": {
		intelligenceIndex: 52.5,
		normalizedScore: 75,
		codingIndex: 75.0,
		agenticIndex: 48.0,
		reasoningIndex: 72.0,
		contextWindow: 131072,
		supportsReasoning: true,
		supportsVision: false,
		lastUpdated: "2026-03-28",
	},
	"llama-3.1-70b": {
		intelligenceIndex: 48.5,
		normalizedScore: 69,
		codingIndex: 70.0,
		agenticIndex: 44.0,
		reasoningIndex: 68.0,
		contextWindow: 131072,
		supportsReasoning: true,
		supportsVision: false,
		lastUpdated: "2026-03-28",
	},
	"llama-3-70b": {
		intelligenceIndex: 46.0,
		normalizedScore: 66,
		codingIndex: 68.0,
		agenticIndex: 42.0,
		reasoningIndex: 65.0,
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,
		lastUpdated: "2026-03-28",
	},
	"llama-3.1-8b": {
		intelligenceIndex: 38.0,
		normalizedScore: 54,
		codingIndex: 55.0,
		agenticIndex: 32.0,
		reasoningIndex: 52.0,
		contextWindow: 131072,
		supportsReasoning: false,
		supportsVision: false,
		lastUpdated: "2026-03-28",
	},

	// Google/Gemini models
	"gemini-1.5-pro": {
		intelligenceIndex: 59.0,
		normalizedScore: 84,
		codingIndex: 86.0,
		agenticIndex: 55.0,
		reasoningIndex: 83.0,
		contextWindow: 2000000,
		supportsReasoning: true,
		supportsVision: true,
		lastUpdated: "2026-03-28",
	},
	"gemini-1.5-flash": {
		intelligenceIndex: 51.0,
		normalizedScore: 73,
		codingIndex: 72.0,
		agenticIndex: 46.0,
		reasoningIndex: 70.0,
		contextWindow: 1000000,
		supportsReasoning: true,
		supportsVision: true,
		lastUpdated: "2026-03-28",
	},
	"gemini-1.5-pro-preview": {
		intelligenceIndex: 57.0,
		normalizedScore: 81,
		codingIndex: 84.0,
		agenticIndex: 53.0,
		reasoningIndex: 80.0,
		contextWindow: 2000000,
		supportsReasoning: true,
		supportsVision: true,
		lastUpdated: "2026-03-28",
	},

	// Alibaba/Qwen models
	"qwen2.5-72b": {
		intelligenceIndex: 49.2,
		normalizedScore: 70,
		codingIndex: 72.0,
		agenticIndex: 45.0,
		reasoningIndex: 68.0,
		contextWindow: 131072,
		supportsReasoning: true,
		supportsVision: true,
		lastUpdated: "2026-03-28",
	},
	"qwen2.5-32b": {
		intelligenceIndex: 45.0,
		normalizedScore: 64,
		codingIndex: 68.0,
		agenticIndex: 40.0,
		reasoningIndex: 62.0,
		contextWindow: 131072,
		supportsReasoning: true,
		supportsVision: true,
		lastUpdated: "2026-03-28",
	},

	// DeepSeek models
	"deepseek-v3": {
		intelligenceIndex: 50.0,
		normalizedScore: 71,
		codingIndex: 74.0,
		agenticIndex: 47.0,
		reasoningIndex: 70.0,
		contextWindow: 128000,
		supportsReasoning: true,
		supportsVision: false,
		lastUpdated: "2026-03-28",
	},
	"deepseek-r1": {
		intelligenceIndex: 48.0,
		normalizedScore: 69,
		codingIndex: 72.0,
		agenticIndex: 45.0,
		reasoningIndex: 75.0,
		contextWindow: 128000,
		supportsReasoning: true,
		supportsVision: false,
		lastUpdated: "2026-03-28",
	},

	// Mistral models
	"mixtral-8x22b": {
		intelligenceIndex: 47.0,
		normalizedScore: 67,
		codingIndex: 69.0,
		agenticIndex: 43.0,
		reasoningIndex: 66.0,
		contextWindow: 65536,
		supportsReasoning: true,
		supportsVision: false,
		lastUpdated: "2026-03-28",
	},
	"mixtral-8x7b": {
		intelligenceIndex: 44.0,
		normalizedScore: 63,
		codingIndex: 65.0,
		agenticIndex: 38.0,
		reasoningIndex: 60.0,
		contextWindow: 32768,
		supportsReasoning: true,
		supportsVision: false,
		lastUpdated: "2026-03-28",
	},
	"mistral-large": {
		intelligenceIndex: 48.0,
		normalizedScore: 69,
		codingIndex: 70.0,
		agenticIndex: 44.0,
		reasoningIndex: 67.0,
		contextWindow: 128000,
		supportsReasoning: true,
		supportsVision: false,
		lastUpdated: "2026-03-28",
	},

	// Xiaomi/MiMo models
	"mimo-v2-pro": {
		intelligenceIndex: 49.2,
		normalizedScore: 70,
		codingIndex: 73.0,
		agenticIndex: 46.0,
		reasoningIndex: 69.0,
		contextWindow: 1000000,
		supportsReasoning: true,
		supportsVision: true,
		lastUpdated: "2026-03-28",
	},
	"mimo-v2-flash": {
		intelligenceIndex: 41.5,
		normalizedScore: 59,
		codingIndex: 62.0,
		agenticIndex: 38.0,
		reasoningIndex: 58.0,
		contextWindow: 256000,
		supportsReasoning: true,
		supportsVision: true,
		lastUpdated: "2026-03-28",
	},
	"mimo-v2-omni": {
		intelligenceIndex: 43.0,
		normalizedScore: 61,
		codingIndex: 64.0,
		agenticIndex: 40.0,
		reasoningIndex: 60.0,
		contextWindow: 128000,
		supportsReasoning: true,
		supportsVision: true,
		lastUpdated: "2026-03-28",
	},

	// xAI/Grok models
	"grok-2": {
		intelligenceIndex: 54.0,
		normalizedScore: 77,
		codingIndex: 78.0,
		agenticIndex: 50.0,
		reasoningIndex: 75.0,
		contextWindow: 131072,
		supportsReasoning: true,
		supportsVision: false,
		lastUpdated: "2026-03-28",
	},
	"grok-3": {
		intelligenceIndex: 56.0,
		normalizedScore: 80,
		codingIndex: 80.0,
		agenticIndex: 52.0,
		reasoningIndex: 78.0,
		contextWindow: 131072,
		supportsReasoning: true,
		supportsVision: false,
		lastUpdated: "2026-03-28",
	},

	// Cohere models
	"command-r": {
		intelligenceIndex: 44.0,
		normalizedScore: 63,
		codingIndex: 66.0,
		agenticIndex: 40.0,
		reasoningIndex: 62.0,
		contextWindow: 128000,
		supportsReasoning: true,
		supportsVision: false,
		lastUpdated: "2026-03-28",
	},
	"command-r-plus": {
		intelligenceIndex: 48.0,
		normalizedScore: 69,
		codingIndex: 70.0,
		agenticIndex: 44.0,
		reasoningIndex: 67.0,
		contextWindow: 128000,
		supportsReasoning: true,
		supportsVision: false,
		lastUpdated: "2026-03-28",
	},

	// ZAI models (from OpenCode Zen)
	"big-pickle": {
		intelligenceIndex: 46.0,
		normalizedScore: 66,
		codingIndex: 68.0,
		agenticIndex: 42.0,
		reasoningIndex: 64.0,
		contextWindow: 200000,
		supportsReasoning: true,
		supportsVision: false,
		lastUpdated: "2026-03-28",
	},
	"trinity-large": {
		intelligenceIndex: 42.0,
		normalizedScore: 60,
		codingIndex: 62.0,
		agenticIndex: 38.0,
		reasoningIndex: 58.0,
		contextWindow: 128000,
		supportsReasoning: false,
		supportsVision: false,
		lastUpdated: "2026-03-28",
	},
	"minimax-m2.5": {
		intelligenceIndex: 45.0,
		normalizedScore: 64,
		codingIndex: 66.0,
		agenticIndex: 41.0,
		reasoningIndex: 61.0,
		contextWindow: 200000,
		supportsReasoning: true,
		supportsVision: false,
		lastUpdated: "2026-03-28",
	},

	// Nvidia models
	"nemotron-4-340b": {
		intelligenceIndex: 49.0,
		normalizedScore: 70,
		codingIndex: 72.0,
		agenticIndex: 45.0,
		reasoningIndex: 68.0,
		contextWindow: 4096,
		supportsReasoning: true,
		supportsVision: false,
		lastUpdated: "2026-03-28",
	},
	"nemotron-3-8b": {
		intelligenceIndex: 38.0,
		normalizedScore: 54,
		codingIndex: 55.0,
		agenticIndex: 32.0,
		reasoningIndex: 52.0,
		contextWindow: 4096,
		supportsReasoning: true,
		supportsVision: false,
		lastUpdated: "2026-03-28",
	},

	// Kimi/Moonshot
	"kimi-k2": {
		intelligenceIndex: 47.0,
		normalizedScore: 67,
		codingIndex: 69.0,
		agenticIndex: 43.0,
		reasoningIndex: 65.0,
		contextWindow: 262144,
		supportsReasoning: true,
		supportsVision: false,
		lastUpdated: "2026-03-28",
	},
	"kimi-k2.5": {
		intelligenceIndex: 50.0,
		normalizedScore: 71,
		codingIndex: 72.0,
		agenticIndex: 46.0,
		reasoningIndex: 69.0,
		contextWindow: 262144,
		supportsReasoning: true,
		supportsVision: false,
		lastUpdated: "2026-03-28",
	},
};

/**
 * Find benchmark data by model name
 */
export function findHardcodedBenchmark(
	modelName: string,
	modelId: string,
): HardcodedBenchmark | null {
	const search = `${modelName} ${modelId}`.toLowerCase();

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
		"claude-3.5-sonnet": [
			"claude-3.5-sonnet",
			"claude-3-5-sonnet",
			"sonnet-3.5",
		],
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
		if (names.some((n) => search.includes(n.toLowerCase()))) {
			return HARDCODED_BENCHMARKS[canonical] || null;
		}
	}

	return null;
}

/**
 * Get score from hardcoded data
 */
export function getHardcodedScore(
	modelName: string,
	modelId: string,
): number | null {
	const benchmark = findHardcodedBenchmark(modelName, modelId);
	return benchmark?.normalizedScore ?? null;
}
