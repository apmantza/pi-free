/**
 * Hardcoded benchmark data from Artificial Analysis
 * Updated monthly via GitHub Actions
 * Last updated: 2026-04-01
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
	"gpt-oss-120b-low": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 24.5,
		normalizedScore: 35,

		// AA specific benchmarks
		codingIndex: 15.5,
		mathIndex: 66.7,

		// Academic benchmarks
		mmluPro: 0.775,
		gpqa: 0.672,
		hle: 0.052,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gpt-oss-120b-high": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 33.3,
		normalizedScore: 48,

		// AA specific benchmarks
		codingIndex: 28.6,
		mathIndex: 93.4,

		// Academic benchmarks
		mmluPro: 0.808,
		gpqa: 0.782,
		hle: 0.185,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gpt-oss-20b-high": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 24.5,
		normalizedScore: 35,

		// AA specific benchmarks
		codingIndex: 18.5,
		mathIndex: 89.3,

		// Academic benchmarks
		mmluPro: 0.748,
		gpqa: 0.688,
		hle: 0.098,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gpt-oss-20b-low": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 20.8,
		normalizedScore: 30,

		// AA specific benchmarks
		codingIndex: 14.4,
		mathIndex: 62.3,

		// Academic benchmarks
		mmluPro: 0.718,
		gpqa: 0.611,
		hle: 0.051,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	o3: {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 38.4,
		normalizedScore: 55,

		// AA specific benchmarks
		codingIndex: 38.4,
		mathIndex: 88.3,

		// Academic benchmarks
		mmluPro: 0.853,
		gpqa: 0.827,
		hle: 0.2,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"grok-1": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 11.7,
		normalizedScore: 17,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: undefined,
		hle: undefined,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gpt-5.4-nano-non-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 24.4,
		normalizedScore: 35,

		// AA specific benchmarks
		codingIndex: 27.9,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.558,
		hle: 0.042,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gpt-5.4-nano-xhigh": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 44.4,
		normalizedScore: 63,

		// AA specific benchmarks
		codingIndex: 43.9,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.817,
		hle: 0.265,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gpt-5.4-non-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 35.4,
		normalizedScore: 51,

		// AA specific benchmarks
		codingIndex: 41.0,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.748,
		hle: 0.106,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gpt-5.4-nano-medium": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 38.1,
		normalizedScore: 54,

		// AA specific benchmarks
		codingIndex: 35.0,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.761,
		hle: 0.147,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gpt-5.4-mini-xhigh": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 48.1,
		normalizedScore: 69,

		// AA specific benchmarks
		codingIndex: 51.5,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.875,
		hle: 0.266,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gpt-5.3-codex-xhigh": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 54.0,
		normalizedScore: 77,

		// AA specific benchmarks
		codingIndex: 53.1,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.915,
		hle: 0.399,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gpt-5.4-mini-medium": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 37.7,
		normalizedScore: 54,

		// AA specific benchmarks
		codingIndex: 37.5,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.823,
		hle: 0.171,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gpt-5.4-mini-non-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 23.3,
		normalizedScore: 33,

		// AA specific benchmarks
		codingIndex: 25.3,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.606,
		hle: 0.057,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gpt-5.4-xhigh": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 57.2,
		normalizedScore: 82,

		// AA specific benchmarks
		codingIndex: 57.3,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.92,
		hle: 0.416,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"llama-3.3-instruct-70b": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 14.5,
		normalizedScore: 21,

		// AA specific benchmarks
		codingIndex: 10.7,
		mathIndex: 7.7,

		// Academic benchmarks
		mmluPro: 0.713,
		gpqa: 0.498,
		hle: 0.04,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"llama-3.1-instruct-405b": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 17.4,
		normalizedScore: 25,

		// AA specific benchmarks
		codingIndex: 14.5,
		mathIndex: 3.0,

		// Academic benchmarks
		mmluPro: 0.732,
		gpqa: 0.515,
		hle: 0.042,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"llama-3.2-instruct-90b-vision": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 11.9,
		normalizedScore: 17,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.671,
		gpqa: 0.432,
		hle: 0.049,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"llama-3.2-instruct-11b-vision": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 8.7,
		normalizedScore: 12,

		// AA specific benchmarks
		codingIndex: 4.3,
		mathIndex: 1.7,

		// Academic benchmarks
		mmluPro: 0.464,
		gpqa: 0.221,
		hle: 0.052,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"llama-4-maverick": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 18.4,
		normalizedScore: 26,

		// AA specific benchmarks
		codingIndex: 15.6,
		mathIndex: 19.3,

		// Academic benchmarks
		mmluPro: 0.809,
		gpqa: 0.671,
		hle: 0.048,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"llama-4-scout": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 13.5,
		normalizedScore: 19,

		// AA specific benchmarks
		codingIndex: 6.7,
		mathIndex: 14.0,

		// Academic benchmarks
		mmluPro: 0.752,
		gpqa: 0.587,
		hle: 0.043,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gemma-3n-e2b-instruct": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 4.8,
		normalizedScore: 7,

		// AA specific benchmarks
		codingIndex: 2.2,
		mathIndex: 10.3,

		// Academic benchmarks
		mmluPro: 0.378,
		gpqa: 0.229,
		hle: 0.04,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gemini-2.5-flash-lite-preview-sep-25-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 21.6,
		normalizedScore: 31,

		// AA specific benchmarks
		codingIndex: 18.1,
		mathIndex: 68.7,

		// Academic benchmarks
		mmluPro: 0.808,
		gpqa: 0.709,
		hle: 0.066,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gemma-3-27b-instruct": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 10.3,
		normalizedScore: 15,

		// AA specific benchmarks
		codingIndex: 9.6,
		mathIndex: 20.7,

		// Academic benchmarks
		mmluPro: 0.669,
		gpqa: 0.428,
		hle: 0.047,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gemma-3-4b-instruct": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 6.3,
		normalizedScore: 9,

		// AA specific benchmarks
		codingIndex: 2.9,
		mathIndex: 12.7,

		// Academic benchmarks
		mmluPro: 0.417,
		gpqa: 0.291,
		hle: 0.052,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gemma-3-270m": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 7.7,
		normalizedScore: 11,

		// AA specific benchmarks
		codingIndex: 0.0,
		mathIndex: 2.3,

		// Academic benchmarks
		mmluPro: 0.055,
		gpqa: 0.224,
		hle: 0.042,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gemma-3-12b-instruct": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 8.8,
		normalizedScore: 13,

		// AA specific benchmarks
		codingIndex: 6.3,
		mathIndex: 18.3,

		// Academic benchmarks
		mmluPro: 0.595,
		gpqa: 0.349,
		hle: 0.048,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gemini-2.5-flash-lite-preview-sep-25-non-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 19.4,
		normalizedScore: 28,

		// AA specific benchmarks
		codingIndex: 14.5,
		mathIndex: 46.7,

		// Academic benchmarks
		mmluPro: 0.796,
		gpqa: 0.651,
		hle: 0.046,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gemini-3-flash-preview-non-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 35.0,
		normalizedScore: 50,

		// AA specific benchmarks
		codingIndex: 37.8,
		mathIndex: 55.7,

		// Academic benchmarks
		mmluPro: 0.882,
		gpqa: 0.812,
		hle: 0.141,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gemini-2.5-pro": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 34.6,
		normalizedScore: 49,

		// AA specific benchmarks
		codingIndex: 31.9,
		mathIndex: 87.7,

		// Academic benchmarks
		mmluPro: 0.862,
		gpqa: 0.844,
		hle: 0.211,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gemini-3.1-pro-preview": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 57.2,
		normalizedScore: 82,

		// AA specific benchmarks
		codingIndex: 55.5,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.941,
		hle: 0.447,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gemini-3.1-flash-lite-preview": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 33.5,
		normalizedScore: 48,

		// AA specific benchmarks
		codingIndex: 30.1,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.822,
		hle: 0.162,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gemma-3n-e4b-instruct": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 6.4,
		normalizedScore: 9,

		// AA specific benchmarks
		codingIndex: 4.2,
		mathIndex: 14.3,

		// Academic benchmarks
		mmluPro: 0.488,
		gpqa: 0.296,
		hle: 0.044,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gemma-3-1b-instruct": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 5.5,
		normalizedScore: 8,

		// AA specific benchmarks
		codingIndex: 0.2,
		mathIndex: 3.3,

		// Academic benchmarks
		mmluPro: 0.135,
		gpqa: 0.237,
		hle: 0.052,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gemini-3-pro-preview-low": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 41.3,
		normalizedScore: 59,

		// AA specific benchmarks
		codingIndex: 39.4,
		mathIndex: 86.7,

		// Academic benchmarks
		mmluPro: 0.895,
		gpqa: 0.887,
		hle: 0.276,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gemini-3-flash-preview-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 46.4,
		normalizedScore: 66,

		// AA specific benchmarks
		codingIndex: 42.6,
		mathIndex: 97.0,

		// Academic benchmarks
		mmluPro: 0.89,
		gpqa: 0.898,
		hle: 0.347,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"claude-sonnet-4.6-non-reasoning-low-effort": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 42.6,
		normalizedScore: 61,

		// AA specific benchmarks
		codingIndex: 43.0,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.797,
		hle: 0.108,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"claude-sonnet-4.6-adaptive-reasoning-max-effort": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 51.7,
		normalizedScore: 74,

		// AA specific benchmarks
		codingIndex: 50.9,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.875,
		hle: 0.3,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"claude-sonnet-4.6-non-reasoning-high-effort": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 44.4,
		normalizedScore: 63,

		// AA specific benchmarks
		codingIndex: 46.4,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.799,
		hle: 0.132,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"claude-opus-4.6-non-reasoning-high-effort": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 46.5,
		normalizedScore: 66,

		// AA specific benchmarks
		codingIndex: 47.6,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.84,
		hle: 0.186,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"claude-opus-4.6-adaptive-reasoning-max-effort": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 53.0,
		normalizedScore: 76,

		// AA specific benchmarks
		codingIndex: 48.1,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.896,
		hle: 0.367,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"claude-4.5-haiku-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 37.1,
		normalizedScore: 53,

		// AA specific benchmarks
		codingIndex: 32.6,
		mathIndex: 83.7,

		// Academic benchmarks
		mmluPro: 0.76,
		gpqa: 0.672,
		hle: 0.097,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"claude-4.5-haiku-non-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 31.1,
		normalizedScore: 44,

		// AA specific benchmarks
		codingIndex: 29.6,
		mathIndex: 39.0,

		// Academic benchmarks
		mmluPro: 0.8,
		gpqa: 0.646,
		hle: 0.043,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"mistral-large-3": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 22.8,
		normalizedScore: 33,

		// AA specific benchmarks
		codingIndex: 22.7,
		mathIndex: 38.0,

		// Academic benchmarks
		mmluPro: 0.807,
		gpqa: 0.68,
		hle: 0.041,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"mistral-small-4-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 27.2,
		normalizedScore: 39,

		// AA specific benchmarks
		codingIndex: 24.3,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.769,
		hle: 0.095,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"devstral-small-2": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 19.5,
		normalizedScore: 28,

		// AA specific benchmarks
		codingIndex: 20.7,
		mathIndex: 34.3,

		// Academic benchmarks
		mmluPro: 0.678,
		gpqa: 0.532,
		hle: 0.034,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"ministral-3-14b": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 16.0,
		normalizedScore: 23,

		// AA specific benchmarks
		codingIndex: 10.9,
		mathIndex: 30.0,

		// Academic benchmarks
		mmluPro: 0.693,
		gpqa: 0.572,
		hle: 0.046,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"devstral-2": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 22.0,
		normalizedScore: 31,

		// AA specific benchmarks
		codingIndex: 23.7,
		mathIndex: 36.7,

		// Academic benchmarks
		mmluPro: 0.762,
		gpqa: 0.594,
		hle: 0.036,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"mistral-medium-3.1": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 21.3,
		normalizedScore: 30,

		// AA specific benchmarks
		codingIndex: 18.3,
		mathIndex: 38.3,

		// Academic benchmarks
		mmluPro: 0.683,
		gpqa: 0.588,
		hle: 0.044,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"mistral-small-4-non-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 18.6,
		normalizedScore: 27,

		// AA specific benchmarks
		codingIndex: 16.4,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.571,
		hle: 0.037,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"ministral-3-3b": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 11.2,
		normalizedScore: 16,

		// AA specific benchmarks
		codingIndex: 4.8,
		mathIndex: 22.0,

		// Academic benchmarks
		mmluPro: 0.524,
		gpqa: 0.358,
		hle: 0.053,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"magistral-small-1.2": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 18.2,
		normalizedScore: 26,

		// AA specific benchmarks
		codingIndex: 14.8,
		mathIndex: 80.3,

		// Academic benchmarks
		mmluPro: 0.768,
		gpqa: 0.663,
		hle: 0.061,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"magistral-medium-1.2": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 27.1,
		normalizedScore: 39,

		// AA specific benchmarks
		codingIndex: 21.7,
		mathIndex: 82.0,

		// Academic benchmarks
		mmluPro: 0.815,
		gpqa: 0.739,
		hle: 0.096,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"ministral-3-8b": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 14.8,
		normalizedScore: 21,

		// AA specific benchmarks
		codingIndex: 10.0,
		mathIndex: 31.7,

		// Academic benchmarks
		mmluPro: 0.642,
		gpqa: 0.471,
		hle: 0.043,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"deepseek-r1-distill-llama-70b": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 16.0,
		normalizedScore: 23,

		// AA specific benchmarks
		codingIndex: 11.4,
		mathIndex: 53.7,

		// Academic benchmarks
		mmluPro: 0.795,
		gpqa: 0.402,
		hle: 0.061,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"deepseek-r1-0528-may-25": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 27.1,
		normalizedScore: 39,

		// AA specific benchmarks
		codingIndex: 24.0,
		mathIndex: 76.0,

		// Academic benchmarks
		mmluPro: 0.849,
		gpqa: 0.813,
		hle: 0.149,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"deepseek-v3.2-non-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 32.1,
		normalizedScore: 46,

		// AA specific benchmarks
		codingIndex: 34.6,
		mathIndex: 59.0,

		// Academic benchmarks
		mmluPro: 0.837,
		gpqa: 0.751,
		hle: 0.105,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"deepseek-v3.2-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 41.7,
		normalizedScore: 60,

		// AA specific benchmarks
		codingIndex: 36.7,
		mathIndex: 92.0,

		// Academic benchmarks
		mmluPro: 0.862,
		gpqa: 0.84,
		hle: 0.222,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"deepseek-v3.2-speciale": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 29.4,
		normalizedScore: 42,

		// AA specific benchmarks
		codingIndex: 37.9,
		mathIndex: 96.7,

		// Academic benchmarks
		mmluPro: 0.863,
		gpqa: 0.871,
		hle: 0.261,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"deepseek-r1-0528-qwen3-8b": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 16.4,
		normalizedScore: 23,

		// AA specific benchmarks
		codingIndex: 7.8,
		mathIndex: 63.7,

		// Academic benchmarks
		mmluPro: 0.739,
		gpqa: 0.612,
		hle: 0.056,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"r1-1776": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 12.0,
		normalizedScore: 17,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: undefined,
		hle: undefined,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"falcon-h1r-7b": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 15.8,
		normalizedScore: 23,

		// AA specific benchmarks
		codingIndex: 9.8,
		mathIndex: 80.0,

		// Academic benchmarks
		mmluPro: 0.725,
		gpqa: 0.661,
		hle: 0.108,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"grok-code-fast-1": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 28.7,
		normalizedScore: 41,

		// AA specific benchmarks
		codingIndex: 23.7,
		mathIndex: 43.3,

		// Academic benchmarks
		mmluPro: 0.793,
		gpqa: 0.727,
		hle: 0.075,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"grok-3-mini-reasoning-high": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 32.1,
		normalizedScore: 46,

		// AA specific benchmarks
		codingIndex: 25.2,
		mathIndex: 84.7,

		// Academic benchmarks
		mmluPro: 0.828,
		gpqa: 0.791,
		hle: 0.111,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"grok-4.20-beta-0309-non-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 29.7,
		normalizedScore: 42,

		// AA specific benchmarks
		codingIndex: 25.4,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.785,
		hle: 0.225,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"grok-4.20-beta-0309-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 48.5,
		normalizedScore: 69,

		// AA specific benchmarks
		codingIndex: 42.2,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.885,
		hle: 0.3,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"nova-micro": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 10.3,
		normalizedScore: 15,

		// AA specific benchmarks
		codingIndex: 4.1,
		mathIndex: 6.0,

		// Academic benchmarks
		mmluPro: 0.531,
		gpqa: 0.358,
		hle: 0.047,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"nova-2.0-lite-low": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 24.6,
		normalizedScore: 35,

		// AA specific benchmarks
		codingIndex: 13.6,
		mathIndex: 46.7,

		// Academic benchmarks
		mmluPro: 0.788,
		gpqa: 0.698,
		hle: 0.042,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"nova-2.0-omni-low": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 23.2,
		normalizedScore: 33,

		// AA specific benchmarks
		codingIndex: 13.9,
		mathIndex: 56.0,

		// Academic benchmarks
		mmluPro: 0.798,
		gpqa: 0.699,
		hle: 0.04,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"nova-2.0-pro-preview-non-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 23.1,
		normalizedScore: 33,

		// AA specific benchmarks
		codingIndex: 20.5,
		mathIndex: 30.7,

		// Academic benchmarks
		mmluPro: 0.772,
		gpqa: 0.636,
		hle: 0.04,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"nova-2.0-omni-medium": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 28.0,
		normalizedScore: 40,

		// AA specific benchmarks
		codingIndex: 15.1,
		mathIndex: 89.7,

		// Academic benchmarks
		mmluPro: 0.809,
		gpqa: 0.76,
		hle: 0.068,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"nova-2.0-omni-non-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 16.6,
		normalizedScore: 24,

		// AA specific benchmarks
		codingIndex: 13.8,
		mathIndex: 37.0,

		// Academic benchmarks
		mmluPro: 0.719,
		gpqa: 0.555,
		hle: 0.039,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"nova-premier": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 19.0,
		normalizedScore: 27,

		// AA specific benchmarks
		codingIndex: 13.8,
		mathIndex: 17.3,

		// Academic benchmarks
		mmluPro: 0.733,
		gpqa: 0.569,
		hle: 0.047,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"nova-2.0-pro-preview-low": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 31.9,
		normalizedScore: 46,

		// AA specific benchmarks
		codingIndex: 24.5,
		mathIndex: 63.3,

		// Academic benchmarks
		mmluPro: 0.822,
		gpqa: 0.751,
		hle: 0.052,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"nova-2.0-lite-non-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 18.0,
		normalizedScore: 26,

		// AA specific benchmarks
		codingIndex: 12.5,
		mathIndex: 33.7,

		// Academic benchmarks
		mmluPro: 0.743,
		gpqa: 0.603,
		hle: 0.03,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"nova-2.0-lite-medium": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 29.7,
		normalizedScore: 42,

		// AA specific benchmarks
		codingIndex: 23.9,
		mathIndex: 88.7,

		// Academic benchmarks
		mmluPro: 0.813,
		gpqa: 0.768,
		hle: 0.086,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"nova-2.0-pro-preview-medium": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 35.7,
		normalizedScore: 51,

		// AA specific benchmarks
		codingIndex: 30.4,
		mathIndex: 89.0,

		// Academic benchmarks
		mmluPro: 0.83,
		gpqa: 0.785,
		hle: 0.089,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"phi-4": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 10.4,
		normalizedScore: 15,

		// AA specific benchmarks
		codingIndex: 11.2,
		mathIndex: 18.0,

		// Academic benchmarks
		mmluPro: 0.714,
		gpqa: 0.575,
		hle: 0.041,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"phi-4-multimodal-instruct": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 10.0,
		normalizedScore: 14,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.485,
		gpqa: 0.315,
		hle: 0.044,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"phi-4-mini-instruct": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 8.4,
		normalizedScore: 12,

		// AA specific benchmarks
		codingIndex: 3.6,
		mathIndex: 6.7,

		// Academic benchmarks
		mmluPro: 0.465,
		gpqa: 0.331,
		hle: 0.042,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"lfm2.5-1.2b-instruct": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 8.0,
		normalizedScore: 11,

		// AA specific benchmarks
		codingIndex: 0.8,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.326,
		hle: 0.068,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"lfm2-24b-a2b": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 10.5,
		normalizedScore: 15,

		// AA specific benchmarks
		codingIndex: 3.6,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.474,
		hle: 0.044,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"lfm2.5-vl-1.6b": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 6.2,
		normalizedScore: 9,

		// AA specific benchmarks
		codingIndex: 1.0,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.289,
		hle: 0.051,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"lfm2.5-1.2b-thinking": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 8.1,
		normalizedScore: 12,

		// AA specific benchmarks
		codingIndex: 1.4,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.339,
		hle: 0.061,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"lfm2-2.6b": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 8.0,
		normalizedScore: 11,

		// AA specific benchmarks
		codingIndex: 1.4,
		mathIndex: 8.3,

		// Academic benchmarks
		mmluPro: 0.298,
		gpqa: 0.306,
		hle: 0.052,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"lfm2-8b-a1b": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 7.0,
		normalizedScore: 10,

		// AA specific benchmarks
		codingIndex: 2.3,
		mathIndex: 25.3,

		// Academic benchmarks
		mmluPro: 0.505,
		gpqa: 0.344,
		hle: 0.049,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"solar-pro-2-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 14.9,
		normalizedScore: 21,

		// AA specific benchmarks
		codingIndex: 12.1,
		mathIndex: 61.3,

		// Academic benchmarks
		mmluPro: 0.805,
		gpqa: 0.687,
		hle: 0.07,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"solar-open-100b-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 21.7,
		normalizedScore: 31,

		// AA specific benchmarks
		codingIndex: 10.5,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.657,
		hle: 0.092,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"solar-pro-2-non-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 13.6,
		normalizedScore: 19,

		// AA specific benchmarks
		codingIndex: 11.3,
		mathIndex: 30.0,

		// Academic benchmarks
		mmluPro: 0.75,
		gpqa: 0.561,
		hle: 0.038,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"minimax-m2.7": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 49.6,
		normalizedScore: 71,

		// AA specific benchmarks
		codingIndex: 41.9,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.874,
		hle: 0.281,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"llama-3.1-nemotron-instruct-70b": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 13.4,
		normalizedScore: 19,

		// AA specific benchmarks
		codingIndex: 10.8,
		mathIndex: 11.0,

		// Academic benchmarks
		mmluPro: 0.69,
		gpqa: 0.465,
		hle: 0.046,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"nvidia-nemotron-3-nano-30b-a3b-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 24.3,
		normalizedScore: 35,

		// AA specific benchmarks
		codingIndex: 19.0,
		mathIndex: 91.0,

		// Academic benchmarks
		mmluPro: 0.794,
		gpqa: 0.757,
		hle: 0.102,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"nvidia-nemotron-3-super-120b-a12b-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 36.0,
		normalizedScore: 51,

		// AA specific benchmarks
		codingIndex: 31.2,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.8,
		hle: 0.192,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"nvidia-nemotron-3-nano-30b-a3b-non-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 13.2,
		normalizedScore: 19,

		// AA specific benchmarks
		codingIndex: 15.8,
		mathIndex: 13.3,

		// Academic benchmarks
		mmluPro: 0.579,
		gpqa: 0.399,
		hle: 0.046,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"nvidia-nemotron-nano-12b-v2-vl-non-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 10.1,
		normalizedScore: 14,

		// AA specific benchmarks
		codingIndex: 5.9,
		mathIndex: 26.7,

		// Academic benchmarks
		mmluPro: 0.649,
		gpqa: 0.439,
		hle: 0.045,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"nvidia-nemotron-nano-9b-v2-non-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 13.2,
		normalizedScore: 19,

		// AA specific benchmarks
		codingIndex: 7.5,
		mathIndex: 62.3,

		// Academic benchmarks
		mmluPro: 0.739,
		gpqa: 0.557,
		hle: 0.04,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"llama-3.3-nemotron-super-49b-v1-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 18.5,
		normalizedScore: 26,

		// AA specific benchmarks
		codingIndex: 9.4,
		mathIndex: 54.7,

		// Academic benchmarks
		mmluPro: 0.785,
		gpqa: 0.643,
		hle: 0.065,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"nvidia-nemotron-nano-12b-v2-vl-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 14.9,
		normalizedScore: 21,

		// AA specific benchmarks
		codingIndex: 11.8,
		mathIndex: 75.0,

		// Academic benchmarks
		mmluPro: 0.759,
		gpqa: 0.572,
		hle: 0.053,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"llama-3.1-nemotron-nano-4b-v1.1-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 14.4,
		normalizedScore: 21,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: 50.0,

		// Academic benchmarks
		mmluPro: 0.556,
		gpqa: 0.408,
		hle: 0.051,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"llama-nemotron-super-49b-v1.5-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 18.7,
		normalizedScore: 27,

		// AA specific benchmarks
		codingIndex: 15.2,
		mathIndex: 76.7,

		// Academic benchmarks
		mmluPro: 0.814,
		gpqa: 0.748,
		hle: 0.068,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"llama-3.1-nemotron-ultra-253b-v1-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 15.0,
		normalizedScore: 21,

		// AA specific benchmarks
		codingIndex: 13.1,
		mathIndex: 63.7,

		// Academic benchmarks
		mmluPro: 0.825,
		gpqa: 0.728,
		hle: 0.081,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"llama-nemotron-super-49b-v1.5-non-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 14.6,
		normalizedScore: 21,

		// AA specific benchmarks
		codingIndex: 10.5,
		mathIndex: 8.0,

		// Academic benchmarks
		mmluPro: 0.692,
		gpqa: 0.481,
		hle: 0.043,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"nvidia-nemotron-3-nano-4b": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 14.7,
		normalizedScore: 21,

		// AA specific benchmarks
		codingIndex: 10.0,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.513,
		hle: 0.048,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"nemotron-cascade-2-30b-a3b": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 27.7,
		normalizedScore: 40,

		// AA specific benchmarks
		codingIndex: 25.1,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.763,
		hle: 0.114,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"nvidia-nemotron-nano-9b-v2-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 14.8,
		normalizedScore: 21,

		// AA specific benchmarks
		codingIndex: 8.3,
		mathIndex: 69.7,

		// Academic benchmarks
		mmluPro: 0.742,
		gpqa: 0.57,
		hle: 0.046,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"llama-3.3-nemotron-super-49b-v1-non-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 14.3,
		normalizedScore: 20,

		// AA specific benchmarks
		codingIndex: 7.6,
		mathIndex: 7.7,

		// Academic benchmarks
		mmluPro: 0.698,
		gpqa: 0.517,
		hle: 0.035,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"kimi-k2.5-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 46.8,
		normalizedScore: 67,

		// AA specific benchmarks
		codingIndex: 39.5,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.879,
		hle: 0.294,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"kimi-k2.5-non-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 37.3,
		normalizedScore: 53,

		// AA specific benchmarks
		codingIndex: 25.8,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.789,
		hle: 0.123,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"kimi-linear-48b-a3b-instruct": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 14.4,
		normalizedScore: 21,

		// AA specific benchmarks
		codingIndex: 14.2,
		mathIndex: 36.3,

		// Academic benchmarks
		mmluPro: 0.585,
		gpqa: 0.412,
		hle: 0.027,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"step-3.5-flash": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 37.8,
		normalizedScore: 54,

		// AA specific benchmarks
		codingIndex: 31.6,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.831,
		hle: 0.191,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"step3-vl-10b": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 15.4,
		normalizedScore: 22,

		// AA specific benchmarks
		codingIndex: 13.9,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.69,
		hle: 0.102,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"molmo2-8b": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 7.3,
		normalizedScore: 10,

		// AA specific benchmarks
		codingIndex: 4.4,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.425,
		hle: 0.044,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"olmo-3-7b-instruct": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 8.2,
		normalizedScore: 12,

		// AA specific benchmarks
		codingIndex: 3.4,
		mathIndex: 41.3,

		// Academic benchmarks
		mmluPro: 0.522,
		gpqa: 0.4,
		hle: 0.058,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"olmo-3.1-32b-instruct": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 12.2,
		normalizedScore: 17,

		// AA specific benchmarks
		codingIndex: 5.6,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.539,
		hle: 0.049,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"olmo-3-7b-think": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 9.4,
		normalizedScore: 13,

		// AA specific benchmarks
		codingIndex: 7.6,
		mathIndex: 70.7,

		// Academic benchmarks
		mmluPro: 0.655,
		gpqa: 0.516,
		hle: 0.057,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"molmo-7b-d": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 9.2,
		normalizedScore: 13,

		// AA specific benchmarks
		codingIndex: 1.2,
		mathIndex: 0.0,

		// Academic benchmarks
		mmluPro: 0.371,
		gpqa: 0.24,
		hle: 0.051,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"olmo-3.1-32b-think": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 13.9,
		normalizedScore: 20,

		// AA specific benchmarks
		codingIndex: 9.8,
		mathIndex: 77.3,

		// Academic benchmarks
		mmluPro: 0.763,
		gpqa: 0.591,
		hle: 0.06,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"granite-4.0-h-small": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 10.8,
		normalizedScore: 15,

		// AA specific benchmarks
		codingIndex: 8.5,
		mathIndex: 13.7,

		// Academic benchmarks
		mmluPro: 0.624,
		gpqa: 0.416,
		hle: 0.037,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"granite-4.0-h-1b": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 8.0,
		normalizedScore: 11,

		// AA specific benchmarks
		codingIndex: 2.7,
		mathIndex: 6.3,

		// Academic benchmarks
		mmluPro: 0.277,
		gpqa: 0.263,
		hle: 0.05,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"granite-4.0-350m": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 6.1,
		normalizedScore: 9,

		// AA specific benchmarks
		codingIndex: 0.3,
		mathIndex: 0.0,

		// Academic benchmarks
		mmluPro: 0.124,
		gpqa: 0.261,
		hle: 0.057,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"granite-4.0-micro": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 7.7,
		normalizedScore: 11,

		// AA specific benchmarks
		codingIndex: 5.0,
		mathIndex: 6.0,

		// Academic benchmarks
		mmluPro: 0.447,
		gpqa: 0.336,
		hle: 0.051,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"granite-4.0-h-350m": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 5.4,
		normalizedScore: 8,

		// AA specific benchmarks
		codingIndex: 0.6,
		mathIndex: 1.3,

		// Academic benchmarks
		mmluPro: 0.127,
		gpqa: 0.257,
		hle: 0.064,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"granite-4.0-1b": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 7.3,
		normalizedScore: 10,

		// AA specific benchmarks
		codingIndex: 2.9,
		mathIndex: 6.3,

		// Academic benchmarks
		mmluPro: 0.325,
		gpqa: 0.281,
		hle: 0.051,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"mercury-2": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 32.8,
		normalizedScore: 47,

		// AA specific benchmarks
		codingIndex: 30.6,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.77,
		hle: 0.155,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"reka-flash-3": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 9.5,
		normalizedScore: 14,

		// AA specific benchmarks
		codingIndex: 8.9,
		mathIndex: 33.7,

		// Academic benchmarks
		mmluPro: 0.669,
		gpqa: 0.529,
		hle: 0.051,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"deephermes-3---mistral-24b-preview-non-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 10.9,
		normalizedScore: 16,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.58,
		gpqa: 0.382,
		hle: 0.039,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"hermes-4---llama-3.1-70b-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 16.0,
		normalizedScore: 23,

		// AA specific benchmarks
		codingIndex: 14.4,
		mathIndex: 68.7,

		// Academic benchmarks
		mmluPro: 0.811,
		gpqa: 0.699,
		hle: 0.079,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"hermes-4---llama-3.1-405b-non-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 17.6,
		normalizedScore: 25,

		// AA specific benchmarks
		codingIndex: 18.1,
		mathIndex: 15.3,

		// Academic benchmarks
		mmluPro: 0.729,
		gpqa: 0.536,
		hle: 0.042,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"llama-65b": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 7.4,
		normalizedScore: 11,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: undefined,
		hle: undefined,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"deephermes-3---llama-3.1-8b-preview-non-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 7.6,
		normalizedScore: 11,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.365,
		gpqa: 0.27,
		hle: 0.043,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"hermes-4---llama-3.1-70b-non-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 12.6,
		normalizedScore: 18,

		// AA specific benchmarks
		codingIndex: 9.2,
		mathIndex: 11.3,

		// Academic benchmarks
		mmluPro: 0.664,
		gpqa: 0.491,
		hle: 0.036,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"hermes-4---llama-3.1-405b-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 18.6,
		normalizedScore: 27,

		// AA specific benchmarks
		codingIndex: 16.0,
		mathIndex: 69.7,

		// Academic benchmarks
		mmluPro: 0.829,
		gpqa: 0.727,
		hle: 0.103,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"exaone-4.0-1.2b-non-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 8.1,
		normalizedScore: 12,

		// AA specific benchmarks
		codingIndex: 2.5,
		mathIndex: 24.0,

		// Academic benchmarks
		mmluPro: 0.5,
		gpqa: 0.424,
		hle: 0.058,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"exaone-4.0-1.2b-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 8.3,
		normalizedScore: 12,

		// AA specific benchmarks
		codingIndex: 3.1,
		mathIndex: 50.3,

		// Academic benchmarks
		mmluPro: 0.588,
		gpqa: 0.515,
		hle: 0.058,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"k-exaone-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 32.1,
		normalizedScore: 46,

		// AA specific benchmarks
		codingIndex: 27.0,
		mathIndex: 90.3,

		// Academic benchmarks
		mmluPro: 0.838,
		gpqa: 0.783,
		hle: 0.131,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"exaone-4.0-32b-non-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 11.7,
		normalizedScore: 17,

		// AA specific benchmarks
		codingIndex: 9.4,
		mathIndex: 39.3,

		// Academic benchmarks
		mmluPro: 0.768,
		gpqa: 0.628,
		hle: 0.049,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"k-exaone-non-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 23.4,
		normalizedScore: 33,

		// AA specific benchmarks
		codingIndex: 13.5,
		mathIndex: 44.0,

		// Academic benchmarks
		mmluPro: 0.81,
		gpqa: 0.695,
		hle: 0.054,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"exaone-4.0-32b-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 16.7,
		normalizedScore: 24,

		// AA specific benchmarks
		codingIndex: 14.0,
		mathIndex: 80.0,

		// Academic benchmarks
		mmluPro: 0.818,
		gpqa: 0.739,
		hle: 0.105,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"mimo-v2-omni": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 43.4,
		normalizedScore: 62,

		// AA specific benchmarks
		codingIndex: 35.5,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.828,
		hle: 0.199,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"mimo-v2-flash-non-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 30.4,
		normalizedScore: 43,

		// AA specific benchmarks
		codingIndex: 25.8,
		mathIndex: 67.7,

		// Academic benchmarks
		mmluPro: 0.744,
		gpqa: 0.656,
		hle: 0.08,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"mimo-v2-flash-feb-2026": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 41.5,
		normalizedScore: 59,

		// AA specific benchmarks
		codingIndex: 33.5,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.835,
		hle: 0.2,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"mimo-v2-pro": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 49.2,
		normalizedScore: 70,

		// AA specific benchmarks
		codingIndex: 41.4,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.87,
		hle: 0.283,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"ernie-4.5-300b-a47b": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 15.0,
		normalizedScore: 21,

		// AA specific benchmarks
		codingIndex: 14.5,
		mathIndex: 41.3,

		// Academic benchmarks
		mmluPro: 0.776,
		gpqa: 0.811,
		hle: 0.035,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"ernie-5.0-thinking-preview": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 29.1,
		normalizedScore: 42,

		// AA specific benchmarks
		codingIndex: 29.2,
		mathIndex: 85.0,

		// Academic benchmarks
		mmluPro: 0.83,
		gpqa: 0.777,
		hle: 0.127,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"sarvam-105b-high": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 18.2,
		normalizedScore: 26,

		// AA specific benchmarks
		codingIndex: 9.8,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.738,
		hle: 0.101,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"sarvam-30b-high": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 12.3,
		normalizedScore: 18,

		// AA specific benchmarks
		codingIndex: 7.9,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.633,
		hle: 0.07,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"kat-coder-pro-v2": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 43.8,
		normalizedScore: 63,

		// AA specific benchmarks
		codingIndex: 45.6,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.855,
		hle: 0.16,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"kat-coder-pro-v1": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 36.0,
		normalizedScore: 51,

		// AA specific benchmarks
		codingIndex: 18.3,
		mathIndex: 94.7,

		// Academic benchmarks
		mmluPro: 0.813,
		gpqa: 0.764,
		hle: 0.334,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"intellect-3": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 22.2,
		normalizedScore: 32,

		// AA specific benchmarks
		codingIndex: 19.1,
		mathIndex: 88.0,

		// Academic benchmarks
		mmluPro: 0.822,
		gpqa: 0.761,
		hle: 0.121,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"motif-2-12.7b-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 19.1,
		normalizedScore: 27,

		// AA specific benchmarks
		codingIndex: 11.9,
		mathIndex: 80.3,

		// Academic benchmarks
		mmluPro: 0.796,
		gpqa: 0.695,
		hle: 0.082,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"k2-think-v2": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 24.1,
		normalizedScore: 34,

		// AA specific benchmarks
		codingIndex: 15.5,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.713,
		hle: 0.095,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"k2-v2-low": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 14.4,
		normalizedScore: 21,

		// AA specific benchmarks
		codingIndex: 10.5,
		mathIndex: 35.3,

		// Academic benchmarks
		mmluPro: 0.713,
		gpqa: 0.541,
		hle: 0.039,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"k2-v2-medium": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 18.7,
		normalizedScore: 27,

		// AA specific benchmarks
		codingIndex: 14.0,
		mathIndex: 64.7,

		// Academic benchmarks
		mmluPro: 0.761,
		gpqa: 0.598,
		hle: 0.044,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"k2-v2-high": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 20.6,
		normalizedScore: 29,

		// AA specific benchmarks
		codingIndex: 16.1,
		mathIndex: 78.3,

		// Academic benchmarks
		mmluPro: 0.786,
		gpqa: 0.681,
		hle: 0.098,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"mi-dm-k-2.5-pro": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 23.1,
		normalizedScore: 33,

		// AA specific benchmarks
		codingIndex: 12.6,
		mathIndex: 76.7,

		// Academic benchmarks
		mmluPro: 0.809,
		gpqa: 0.701,
		hle: 0.077,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"hyperclova-x-seed-think-32b": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 23.7,
		normalizedScore: 34,

		// AA specific benchmarks
		codingIndex: 17.5,
		mathIndex: 59.0,

		// Academic benchmarks
		mmluPro: 0.785,
		gpqa: 0.615,
		hle: 0.055,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"longcat-flash-lite": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 23.9,
		normalizedScore: 34,

		// AA specific benchmarks
		codingIndex: 16.5,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.636,
		hle: 0.06,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"tri-21b-think-preview": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 20.0,
		normalizedScore: 29,

		// AA specific benchmarks
		codingIndex: 7.4,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.538,
		hle: 0.057,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"tri-21b-think": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 18.6,
		normalizedScore: 27,

		// AA specific benchmarks
		codingIndex: 6.3,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.601,
		hle: 0.061,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"nanbeige4.1-3b": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 16.1,
		normalizedScore: 23,

		// AA specific benchmarks
		codingIndex: 8.9,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.849,
		hle: 0.1,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"apertus-70b-instruct": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 7.7,
		normalizedScore: 11,

		// AA specific benchmarks
		codingIndex: 1.9,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.272,
		hle: 0.055,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"apertus-8b-instruct": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 5.9,
		normalizedScore: 8,

		// AA specific benchmarks
		codingIndex: 1.4,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.256,
		hle: 0.05,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"glm-4.6v-non-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 17.1,
		normalizedScore: 24,

		// AA specific benchmarks
		codingIndex: 11.1,
		mathIndex: 26.3,

		// Academic benchmarks
		mmluPro: 0.752,
		gpqa: 0.566,
		hle: 0.037,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"glm-4.6v-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 23.4,
		normalizedScore: 33,

		// AA specific benchmarks
		codingIndex: 19.7,
		mathIndex: 85.3,

		// Academic benchmarks
		mmluPro: 0.799,
		gpqa: 0.719,
		hle: 0.089,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"glm-5-turbo": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 46.8,
		normalizedScore: 67,

		// AA specific benchmarks
		codingIndex: 36.8,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.847,
		hle: 0.254,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"glm-5-non-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 40.6,
		normalizedScore: 58,

		// AA specific benchmarks
		codingIndex: 39.0,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.666,
		hle: 0.072,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"glm-5-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 49.8,
		normalizedScore: 71,

		// AA specific benchmarks
		codingIndex: 44.2,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.82,
		hle: 0.272,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwen-chat-14b": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 7.4,
		normalizedScore: 11,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: undefined,
		hle: undefined,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"tiny-aya-global": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 4.7,
		normalizedScore: 7,

		// AA specific benchmarks
		codingIndex: 1.2,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.305,
		hle: 0.052,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"command-a": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 13.5,
		normalizedScore: 19,

		// AA specific benchmarks
		codingIndex: 9.9,
		mathIndex: 13.0,

		// Academic benchmarks
		mmluPro: 0.712,
		gpqa: 0.527,
		hle: 0.046,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"apriel-v1.6-15b-thinker": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 27.6,
		normalizedScore: 39,

		// AA specific benchmarks
		codingIndex: 22.0,
		mathIndex: 88.0,

		// Academic benchmarks
		mmluPro: 0.79,
		gpqa: 0.733,
		hle: 0.098,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"jamba-reasoning-3b": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 9.6,
		normalizedScore: 14,

		// AA specific benchmarks
		codingIndex: 2.5,
		mathIndex: 10.7,

		// Academic benchmarks
		mmluPro: 0.577,
		gpqa: 0.333,
		hle: 0.046,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"jamba-1.7-large": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 10.9,
		normalizedScore: 16,

		// AA specific benchmarks
		codingIndex: 7.8,
		mathIndex: 2.3,

		// Academic benchmarks
		mmluPro: 0.577,
		gpqa: 0.39,
		hle: 0.038,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"jamba-1.7-mini": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 8.1,
		normalizedScore: 12,

		// AA specific benchmarks
		codingIndex: 3.1,
		mathIndex: 0.3,

		// Academic benchmarks
		mmluPro: 0.388,
		gpqa: 0.322,
		hle: 0.045,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwen3-next-80b-a3b-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 26.7,
		normalizedScore: 38,

		// AA specific benchmarks
		codingIndex: 19.5,
		mathIndex: 84.3,

		// Academic benchmarks
		mmluPro: 0.824,
		gpqa: 0.759,
		hle: 0.117,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwen3.5-122b-a10b-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 41.6,
		normalizedScore: 59,

		// AA specific benchmarks
		codingIndex: 34.7,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.857,
		hle: 0.234,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwen3-coder-480b-a35b-instruct": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 24.8,
		normalizedScore: 35,

		// AA specific benchmarks
		codingIndex: 24.6,
		mathIndex: 39.3,

		// Academic benchmarks
		mmluPro: 0.788,
		gpqa: 0.618,
		hle: 0.044,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwen3-next-80b-a3b-instruct": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 20.1,
		normalizedScore: 29,

		// AA specific benchmarks
		codingIndex: 15.3,
		mathIndex: 66.3,

		// Academic benchmarks
		mmluPro: 0.819,
		gpqa: 0.738,
		hle: 0.073,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwen3-omni-30b-a3b-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 15.6,
		normalizedScore: 22,

		// AA specific benchmarks
		codingIndex: 12.7,
		mathIndex: 74.0,

		// Academic benchmarks
		mmluPro: 0.792,
		gpqa: 0.726,
		hle: 0.073,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwen3.5-122b-a10b-non-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 35.9,
		normalizedScore: 51,

		// AA specific benchmarks
		codingIndex: 31.6,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.827,
		hle: 0.148,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwen3.5-27b-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 42.1,
		normalizedScore: 60,

		// AA specific benchmarks
		codingIndex: 34.9,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.858,
		hle: 0.222,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwen3.5-35b-a3b-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 37.1,
		normalizedScore: 53,

		// AA specific benchmarks
		codingIndex: 30.3,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.845,
		hle: 0.197,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwen3.5-397b-a17b-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 45.0,
		normalizedScore: 64,

		// AA specific benchmarks
		codingIndex: 41.3,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.893,
		hle: 0.273,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwen3-omni-30b-a3b-instruct": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 10.7,
		normalizedScore: 15,

		// AA specific benchmarks
		codingIndex: 7.2,
		mathIndex: 52.3,

		// Academic benchmarks
		mmluPro: 0.725,
		gpqa: 0.62,
		hle: 0.051,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwen3.5-397b-a17b-non-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 40.1,
		normalizedScore: 57,

		// AA specific benchmarks
		codingIndex: 37.4,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.861,
		hle: 0.188,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwen3-max-thinking": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 39.9,
		normalizedScore: 57,

		// AA specific benchmarks
		codingIndex: 30.5,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.861,
		hle: 0.262,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwen3.5-2b-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 16.3,
		normalizedScore: 23,

		// AA specific benchmarks
		codingIndex: 3.5,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.456,
		hle: 0.021,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwen3.5-0.8b-non-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 9.9,
		normalizedScore: 14,

		// AA specific benchmarks
		codingIndex: 1.0,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.236,
		hle: 0.049,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwen3.5-4b-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 27.1,
		normalizedScore: 39,

		// AA specific benchmarks
		codingIndex: 17.5,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.771,
		hle: 0.078,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwen3.5-9b-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 32.4,
		normalizedScore: 46,

		// AA specific benchmarks
		codingIndex: 25.3,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.806,
		hle: 0.133,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwen3.5-0.8b-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 10.5,
		normalizedScore: 15,

		// AA specific benchmarks
		codingIndex: 0.0,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.111,
		hle: 0.012,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwen3-coder-next": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 28.3,
		normalizedScore: 40,

		// AA specific benchmarks
		codingIndex: 22.9,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.737,
		hle: 0.093,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwen3.5-35b-a3b-non-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 30.7,
		normalizedScore: 44,

		// AA specific benchmarks
		codingIndex: 16.8,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.819,
		hle: 0.128,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwen3.5-9b-non-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 27.3,
		normalizedScore: 39,

		// AA specific benchmarks
		codingIndex: 21.4,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.786,
		hle: 0.086,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwen3.5-27b-non-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 37.2,
		normalizedScore: 53,

		// AA specific benchmarks
		codingIndex: 33.4,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.842,
		hle: 0.132,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwen3.5-4b-non-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 22.6,
		normalizedScore: 32,

		// AA specific benchmarks
		codingIndex: 13.7,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.712,
		hle: 0.075,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwen3.5-2b-non-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 14.7,
		normalizedScore: 21,

		// AA specific benchmarks
		codingIndex: 4.9,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.438,
		hle: 0.049,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"ling-flash-2.0": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 15.7,
		normalizedScore: 22,

		// AA specific benchmarks
		codingIndex: 16.7,
		mathIndex: 65.3,

		// Academic benchmarks
		mmluPro: 0.777,
		gpqa: 0.657,
		hle: 0.063,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"ling-mini-2.0": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 9.2,
		normalizedScore: 13,

		// AA specific benchmarks
		codingIndex: 5.0,
		mathIndex: 49.3,

		// Academic benchmarks
		mmluPro: 0.671,
		gpqa: 0.562,
		hle: 0.05,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"ring-flash-2.0": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 14.0,
		normalizedScore: 20,

		// AA specific benchmarks
		codingIndex: 10.6,
		mathIndex: 83.7,

		// Academic benchmarks
		mmluPro: 0.793,
		gpqa: 0.725,
		hle: 0.089,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"ring-1t": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 22.8,
		normalizedScore: 33,

		// AA specific benchmarks
		codingIndex: 16.8,
		mathIndex: 89.3,

		// Academic benchmarks
		mmluPro: 0.806,
		gpqa: 0.774,
		hle: 0.102,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"ling-1t": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 19.0,
		normalizedScore: 27,

		// AA specific benchmarks
		codingIndex: 18.8,
		mathIndex: 71.3,

		// Academic benchmarks
		mmluPro: 0.822,
		gpqa: 0.719,
		hle: 0.072,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"doubao-seed-code": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 33.5,
		normalizedScore: 48,

		// AA specific benchmarks
		codingIndex: 31.3,
		mathIndex: 79.3,

		// Academic benchmarks
		mmluPro: 0.854,
		gpqa: 0.764,
		hle: 0.133,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	o1: {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 30.8,
		normalizedScore: 44,

		// AA specific benchmarks
		codingIndex: 20.5,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.841,
		gpqa: 0.747,
		hle: 0.077,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"o1-preview": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 23.7,
		normalizedScore: 34,

		// AA specific benchmarks
		codingIndex: 34.0,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: undefined,
		hle: undefined,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"o1-mini": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 20.4,
		normalizedScore: 29,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.742,
		gpqa: 0.603,
		hle: 0.049,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gpt-4o-aug-24": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 18.6,
		normalizedScore: 27,

		// AA specific benchmarks
		codingIndex: 16.6,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.521,
		hle: 0.029,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gpt-4o-may-24": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 14.5,
		normalizedScore: 21,

		// AA specific benchmarks
		codingIndex: 24.2,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.74,
		gpqa: 0.526,
		hle: 0.028,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gpt-4-turbo": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 13.7,
		normalizedScore: 20,

		// AA specific benchmarks
		codingIndex: 21.5,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.694,
		gpqa: undefined,
		hle: 0.033,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gpt-4o-nov-24": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 17.3,
		normalizedScore: 25,

		// AA specific benchmarks
		codingIndex: 16.7,
		mathIndex: 6.0,

		// Academic benchmarks
		mmluPro: 0.748,
		gpqa: 0.543,
		hle: 0.033,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gpt-4o-mini": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 12.6,
		normalizedScore: 18,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: 14.7,

		// Academic benchmarks
		mmluPro: 0.648,
		gpqa: 0.426,
		hle: 0.04,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gpt-3.5-turbo": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 9.0,
		normalizedScore: 13,

		// AA specific benchmarks
		codingIndex: 10.7,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.462,
		gpqa: 0.297,
		hle: undefined,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gpt-4.1-nano": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 13.0,
		normalizedScore: 19,

		// AA specific benchmarks
		codingIndex: 11.2,
		mathIndex: 24.0,

		// Academic benchmarks
		mmluPro: 0.657,
		gpqa: 0.512,
		hle: 0.039,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gpt-5-minimal": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 23.9,
		normalizedScore: 34,

		// AA specific benchmarks
		codingIndex: 25.1,
		mathIndex: 31.7,

		// Academic benchmarks
		mmluPro: 0.806,
		gpqa: 0.673,
		hle: 0.054,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gpt-4.1": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 26.3,
		normalizedScore: 38,

		// AA specific benchmarks
		codingIndex: 21.8,
		mathIndex: 34.7,

		// Academic benchmarks
		mmluPro: 0.806,
		gpqa: 0.666,
		hle: 0.046,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gpt-4.1-mini": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 22.9,
		normalizedScore: 33,

		// AA specific benchmarks
		codingIndex: 18.5,
		mathIndex: 46.3,

		// Academic benchmarks
		mmluPro: 0.781,
		gpqa: 0.664,
		hle: 0.046,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gpt-5-mini-high": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 41.2,
		normalizedScore: 59,

		// AA specific benchmarks
		codingIndex: 35.3,
		mathIndex: 90.7,

		// Academic benchmarks
		mmluPro: 0.837,
		gpqa: 0.828,
		hle: 0.197,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gpt-5.2-non-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 33.6,
		normalizedScore: 48,

		// AA specific benchmarks
		codingIndex: 34.7,
		mathIndex: 51.0,

		// Academic benchmarks
		mmluPro: 0.814,
		gpqa: 0.712,
		hle: 0.073,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gpt-5-chatgpt": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 21.8,
		normalizedScore: 31,

		// AA specific benchmarks
		codingIndex: 21.2,
		mathIndex: 48.3,

		// Academic benchmarks
		mmluPro: 0.82,
		gpqa: 0.686,
		hle: 0.058,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gpt-5-mini-minimal": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 20.7,
		normalizedScore: 30,

		// AA specific benchmarks
		codingIndex: 21.9,
		mathIndex: 46.7,

		// Academic benchmarks
		mmluPro: 0.775,
		gpqa: 0.687,
		hle: 0.05,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gpt-5-nano-minimal": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 13.8,
		normalizedScore: 20,

		// AA specific benchmarks
		codingIndex: 14.2,
		mathIndex: 27.3,

		// Academic benchmarks
		mmluPro: 0.556,
		gpqa: 0.428,
		hle: 0.041,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"o4-mini-high": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 33.1,
		normalizedScore: 47,

		// AA specific benchmarks
		codingIndex: 25.6,
		mathIndex: 90.7,

		// Academic benchmarks
		mmluPro: 0.832,
		gpqa: 0.784,
		hle: 0.175,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"o3-pro": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 40.7,
		normalizedScore: 58,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.845,
		hle: undefined,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gpt-4.5-preview": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 20.0,
		normalizedScore: 29,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: undefined,
		hle: undefined,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gpt-5-codex-high": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 44.6,
		normalizedScore: 64,

		// AA specific benchmarks
		codingIndex: 38.9,
		mathIndex: 98.7,

		// Academic benchmarks
		mmluPro: 0.865,
		gpqa: 0.837,
		hle: 0.256,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gpt-5-nano-medium": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 25.9,
		normalizedScore: 37,

		// AA specific benchmarks
		codingIndex: 22.9,
		mathIndex: 78.3,

		// Academic benchmarks
		mmluPro: 0.772,
		gpqa: 0.67,
		hle: 0.076,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gpt-5.1-non-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 27.4,
		normalizedScore: 39,

		// AA specific benchmarks
		codingIndex: 27.3,
		mathIndex: 38.0,

		// Academic benchmarks
		mmluPro: 0.801,
		gpqa: 0.643,
		hle: 0.052,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gpt-5.2-medium": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 46.6,
		normalizedScore: 67,

		// AA specific benchmarks
		codingIndex: 44.2,
		mathIndex: 96.7,

		// Academic benchmarks
		mmluPro: 0.859,
		gpqa: 0.864,
		hle: 0.249,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gpt-5-high": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 44.6,
		normalizedScore: 64,

		// AA specific benchmarks
		codingIndex: 36.0,
		mathIndex: 94.3,

		// Academic benchmarks
		mmluPro: 0.871,
		gpqa: 0.854,
		hle: 0.265,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gpt-4o-chatgpt": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 14.1,
		normalizedScore: 20,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.773,
		gpqa: 0.511,
		hle: 0.037,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gpt-5-mini-medium": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 38.9,
		normalizedScore: 56,

		// AA specific benchmarks
		codingIndex: 32.9,
		mathIndex: 85.0,

		// Academic benchmarks
		mmluPro: 0.828,
		gpqa: 0.803,
		hle: 0.146,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gpt-5.1-high": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 47.7,
		normalizedScore: 68,

		// AA specific benchmarks
		codingIndex: 44.7,
		mathIndex: 94.0,

		// Academic benchmarks
		mmluPro: 0.87,
		gpqa: 0.873,
		hle: 0.265,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gpt-5-nano-high": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 26.8,
		normalizedScore: 38,

		// AA specific benchmarks
		codingIndex: 20.3,
		mathIndex: 83.7,

		// Academic benchmarks
		mmluPro: 0.78,
		gpqa: 0.676,
		hle: 0.082,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gpt-5.2-xhigh": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 51.3,
		normalizedScore: 73,

		// AA specific benchmarks
		codingIndex: 48.7,
		mathIndex: 99.0,

		// Academic benchmarks
		mmluPro: 0.874,
		gpqa: 0.903,
		hle: 0.354,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gpt-5-low": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 39.2,
		normalizedScore: 56,

		// AA specific benchmarks
		codingIndex: 30.7,
		mathIndex: 83.0,

		// Academic benchmarks
		mmluPro: 0.86,
		gpqa: 0.808,
		hle: 0.184,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"o3-mini-high": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 25.2,
		normalizedScore: 36,

		// AA specific benchmarks
		codingIndex: 17.3,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.802,
		gpqa: 0.773,
		hle: 0.123,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gpt-4o-march-2025-chatgpt-4o-latest": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 18.6,
		normalizedScore: 27,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: 25.7,

		// Academic benchmarks
		mmluPro: 0.803,
		gpqa: 0.655,
		hle: 0.05,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gpt-5.1-codex-high": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 43.1,
		normalizedScore: 62,

		// AA specific benchmarks
		codingIndex: 36.6,
		mathIndex: 95.7,

		// Academic benchmarks
		mmluPro: 0.86,
		gpqa: 0.86,
		hle: 0.234,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gpt-4": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 12.8,
		normalizedScore: 18,

		// AA specific benchmarks
		codingIndex: 13.1,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: undefined,
		hle: undefined,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gpt-5.2-codex-xhigh": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 49.0,
		normalizedScore: 70,

		// AA specific benchmarks
		codingIndex: 43.0,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.899,
		hle: 0.335,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gpt-5-medium": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 42.0,
		normalizedScore: 60,

		// AA specific benchmarks
		codingIndex: 39.0,
		mathIndex: 91.7,

		// Academic benchmarks
		mmluPro: 0.867,
		gpqa: 0.842,
		hle: 0.235,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"o1-pro": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 25.8,
		normalizedScore: 37,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: undefined,
		hle: undefined,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"o3-mini": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 25.9,
		normalizedScore: 37,

		// AA specific benchmarks
		codingIndex: 17.9,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.791,
		gpqa: 0.748,
		hle: 0.087,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gpt-5.1-codex-mini-high": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 38.6,
		normalizedScore: 55,

		// AA specific benchmarks
		codingIndex: 36.4,
		mathIndex: 91.7,

		// Academic benchmarks
		mmluPro: 0.82,
		gpqa: 0.813,
		hle: 0.169,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"llama-3.1-instruct-70b": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 12.5,
		normalizedScore: 18,

		// AA specific benchmarks
		codingIndex: 10.9,
		mathIndex: 4.0,

		// Academic benchmarks
		mmluPro: 0.676,
		gpqa: 0.409,
		hle: 0.046,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"llama-3.1-instruct-8b": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 11.8,
		normalizedScore: 17,

		// AA specific benchmarks
		codingIndex: 4.9,
		mathIndex: 4.3,

		// Academic benchmarks
		mmluPro: 0.476,
		gpqa: 0.259,
		hle: 0.051,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"llama-3.2-instruct-3b": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 9.7,
		normalizedScore: 14,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: 3.3,

		// Academic benchmarks
		mmluPro: 0.347,
		gpqa: 0.255,
		hle: 0.052,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"llama-3-instruct-70b": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 8.9,
		normalizedScore: 13,

		// AA specific benchmarks
		codingIndex: 6.8,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.574,
		gpqa: 0.379,
		hle: 0.044,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"llama-3-instruct-8b": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 6.4,
		normalizedScore: 9,

		// AA specific benchmarks
		codingIndex: 4.0,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.405,
		gpqa: 0.296,
		hle: 0.051,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"llama-3.2-instruct-1b": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 6.3,
		normalizedScore: 9,

		// AA specific benchmarks
		codingIndex: 0.6,
		mathIndex: 0.0,

		// Academic benchmarks
		mmluPro: 0.2,
		gpqa: 0.196,
		hle: 0.053,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"llama-2-chat-7b": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 9.7,
		normalizedScore: 14,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.164,
		gpqa: 0.227,
		hle: 0.058,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"llama-2-chat-13b": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 8.4,
		normalizedScore: 12,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.406,
		gpqa: 0.321,
		hle: 0.047,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"llama-2-chat-70b": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 8.4,
		normalizedScore: 12,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.406,
		gpqa: 0.327,
		hle: 0.05,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gemini-2.0-pro-experimental-feb-25": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 18.1,
		normalizedScore: 26,

		// AA specific benchmarks
		codingIndex: 25.5,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.805,
		gpqa: 0.622,
		hle: 0.068,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gemini-2.0-flash-experimental": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 16.8,
		normalizedScore: 24,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.782,
		gpqa: 0.636,
		hle: 0.047,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gemini-1.5-pro-sep-24": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 16.0,
		normalizedScore: 23,

		// AA specific benchmarks
		codingIndex: 23.6,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.75,
		gpqa: 0.589,
		hle: 0.049,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gemini-2.0-flash-lite-preview": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 14.5,
		normalizedScore: 21,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.542,
		hle: 0.044,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gemini-2.0-flash-feb-25": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 18.5,
		normalizedScore: 26,

		// AA specific benchmarks
		codingIndex: 13.6,
		mathIndex: 21.7,

		// Academic benchmarks
		mmluPro: 0.779,
		gpqa: 0.623,
		hle: 0.053,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gemini-1.5-flash-sep-24": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 13.8,
		normalizedScore: 20,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.68,
		gpqa: 0.463,
		hle: 0.035,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gemini-1.5-flash-8b": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 11.1,
		normalizedScore: 16,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.569,
		gpqa: 0.359,
		hle: 0.045,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"palm-2": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 8.6,
		normalizedScore: 12,

		// AA specific benchmarks
		codingIndex: 4.6,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: undefined,
		hle: undefined,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gemini-2.5-flash-preview-sep-25-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 31.1,
		normalizedScore: 44,

		// AA specific benchmarks
		codingIndex: 24.6,
		mathIndex: 78.3,

		// Academic benchmarks
		mmluPro: 0.842,
		gpqa: 0.793,
		hle: 0.127,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gemini-2.5-flash-lite-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 17.6,
		normalizedScore: 25,

		// AA specific benchmarks
		codingIndex: 9.5,
		mathIndex: 53.3,

		// Academic benchmarks
		mmluPro: 0.759,
		gpqa: 0.625,
		hle: 0.064,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gemini-2.5-flash-preview-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 24.3,
		normalizedScore: 35,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.8,
		gpqa: 0.698,
		hle: 0.116,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gemini-1.0-ultra": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 10.1,
		normalizedScore: 14,

		// AA specific benchmarks
		codingIndex: 17.6,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: undefined,
		hle: undefined,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gemini-2.5-flash-lite-non-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 12.7,
		normalizedScore: 18,

		// AA specific benchmarks
		codingIndex: 7.4,
		mathIndex: 35.3,

		// Academic benchmarks
		mmluPro: 0.724,
		gpqa: 0.474,
		hle: 0.037,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gemma-3n-e4b-instruct-preview-may-25": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 10.1,
		normalizedScore: 14,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.483,
		gpqa: 0.278,
		hle: 0.049,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gemini-2.5-flash-preview-non-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 17.8,
		normalizedScore: 25,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.783,
		gpqa: 0.594,
		hle: 0.05,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gemini-3-pro-preview-high": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 48.4,
		normalizedScore: 69,

		// AA specific benchmarks
		codingIndex: 46.5,
		mathIndex: 95.7,

		// Academic benchmarks
		mmluPro: 0.898,
		gpqa: 0.908,
		hle: 0.372,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gemini-2.5-pro-preview-mar-25": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 30.3,
		normalizedScore: 43,

		// AA specific benchmarks
		codingIndex: 46.7,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.858,
		gpqa: 0.836,
		hle: 0.171,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gemini-1.5-pro-may-24": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 12.0,
		normalizedScore: 17,

		// AA specific benchmarks
		codingIndex: 19.8,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.657,
		gpqa: 0.371,
		hle: 0.039,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gemini-2.5-flash-preview-sep-25-non-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 25.7,
		normalizedScore: 37,

		// AA specific benchmarks
		codingIndex: 22.1,
		mathIndex: 56.7,

		// Academic benchmarks
		mmluPro: 0.836,
		gpqa: 0.766,
		hle: 0.078,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gemini-1.5-flash-may-24": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 10.5,
		normalizedScore: 15,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.574,
		gpqa: 0.324,
		hle: 0.042,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gemini-2.0-flash-thinking-experimental-jan-25": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 19.6,
		normalizedScore: 28,

		// AA specific benchmarks
		codingIndex: 24.1,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.798,
		gpqa: 0.701,
		hle: 0.071,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gemini-2.0-flash-lite-feb-25": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 14.7,
		normalizedScore: 21,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.724,
		gpqa: 0.535,
		hle: 0.036,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gemini-2.5-flash-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 27.0,
		normalizedScore: 39,

		// AA specific benchmarks
		codingIndex: 22.2,
		mathIndex: 73.3,

		// Academic benchmarks
		mmluPro: 0.832,
		gpqa: 0.79,
		hle: 0.111,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gemini-2.5-pro-preview-may-25": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 29.5,
		normalizedScore: 42,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.837,
		gpqa: 0.822,
		hle: 0.154,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gemini-1.0-pro": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 8.5,
		normalizedScore: 12,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.431,
		gpqa: 0.277,
		hle: 0.046,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gemini-2.0-flash-thinking-experimental-dec-24": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 12.3,
		normalizedScore: 18,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: undefined,
		hle: undefined,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"gemini-2.5-flash-non-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 20.6,
		normalizedScore: 29,

		// AA specific benchmarks
		codingIndex: 17.8,
		mathIndex: 60.3,

		// Academic benchmarks
		mmluPro: 0.809,
		gpqa: 0.683,
		hle: 0.051,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"claude-3.5-sonnet-oct-24": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 15.9,
		normalizedScore: 23,

		// AA specific benchmarks
		codingIndex: 30.2,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.772,
		gpqa: 0.599,
		hle: 0.039,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"claude-3.5-sonnet-june-24": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 14.2,
		normalizedScore: 20,

		// AA specific benchmarks
		codingIndex: 26.0,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.751,
		gpqa: 0.56,
		hle: 0.037,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"claude-3-opus": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 18.0,
		normalizedScore: 26,

		// AA specific benchmarks
		codingIndex: 19.5,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.696,
		gpqa: 0.489,
		hle: 0.031,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"claude-3.5-haiku": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 18.7,
		normalizedScore: 27,

		// AA specific benchmarks
		codingIndex: 10.7,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.634,
		gpqa: 0.408,
		hle: 0.035,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"claude-3-sonnet": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 10.3,
		normalizedScore: 15,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.579,
		gpqa: 0.4,
		hle: 0.038,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"claude-3-haiku": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 12.3,
		normalizedScore: 18,

		// AA specific benchmarks
		codingIndex: 6.7,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.374,
		hle: 0.039,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"claude-instant": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 7.4,
		normalizedScore: 11,

		// AA specific benchmarks
		codingIndex: 7.8,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.434,
		gpqa: 0.33,
		hle: 0.038,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"claude-opus-4.5-non-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 43.1,
		normalizedScore: 62,

		// AA specific benchmarks
		codingIndex: 42.9,
		mathIndex: 62.7,

		// Academic benchmarks
		mmluPro: 0.889,
		gpqa: 0.81,
		hle: 0.129,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"claude-2.0": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 9.1,
		normalizedScore: 13,

		// AA specific benchmarks
		codingIndex: 12.9,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.486,
		gpqa: 0.344,
		hle: undefined,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"claude-4-sonnet-non-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 33.0,
		normalizedScore: 47,

		// AA specific benchmarks
		codingIndex: 30.6,
		mathIndex: 38.0,

		// Academic benchmarks
		mmluPro: 0.837,
		gpqa: 0.683,
		hle: 0.04,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"claude-3.7-sonnet-non-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 30.8,
		normalizedScore: 44,

		// AA specific benchmarks
		codingIndex: 26.7,
		mathIndex: 21.0,

		// Academic benchmarks
		mmluPro: 0.803,
		gpqa: 0.656,
		hle: 0.048,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"claude-4.1-opus-non-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 36.0,
		normalizedScore: 51,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: undefined,
		hle: undefined,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"claude-4.1-opus-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 42.0,
		normalizedScore: 60,

		// AA specific benchmarks
		codingIndex: 36.5,
		mathIndex: 80.3,

		// Academic benchmarks
		mmluPro: 0.88,
		gpqa: 0.809,
		hle: 0.119,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"claude-4-sonnet-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 38.7,
		normalizedScore: 55,

		// AA specific benchmarks
		codingIndex: 34.1,
		mathIndex: 74.3,

		// Academic benchmarks
		mmluPro: 0.842,
		gpqa: 0.777,
		hle: 0.096,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"claude-opus-4.5-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 49.7,
		normalizedScore: 71,

		// AA specific benchmarks
		codingIndex: 47.8,
		mathIndex: 91.3,

		// Academic benchmarks
		mmluPro: 0.895,
		gpqa: 0.866,
		hle: 0.284,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"claude-4-opus-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 39.0,
		normalizedScore: 56,

		// AA specific benchmarks
		codingIndex: 34.0,
		mathIndex: 73.3,

		// Academic benchmarks
		mmluPro: 0.873,
		gpqa: 0.796,
		hle: 0.117,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"claude-4.5-sonnet-non-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 37.1,
		normalizedScore: 53,

		// AA specific benchmarks
		codingIndex: 33.5,
		mathIndex: 37.0,

		// Academic benchmarks
		mmluPro: 0.86,
		gpqa: 0.727,
		hle: 0.071,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"claude-4.5-sonnet-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 43.0,
		normalizedScore: 61,

		// AA specific benchmarks
		codingIndex: 38.6,
		mathIndex: 88.0,

		// Academic benchmarks
		mmluPro: 0.875,
		gpqa: 0.834,
		hle: 0.173,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"claude-3.7-sonnet-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 34.7,
		normalizedScore: 50,

		// AA specific benchmarks
		codingIndex: 27.6,
		mathIndex: 56.3,

		// Academic benchmarks
		mmluPro: 0.837,
		gpqa: 0.772,
		hle: 0.103,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"claude-4-opus-non-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 33.0,
		normalizedScore: 47,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: 36.3,

		// Academic benchmarks
		mmluPro: 0.86,
		gpqa: 0.701,
		hle: 0.059,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"claude-2.1": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 9.3,
		normalizedScore: 13,

		// AA specific benchmarks
		codingIndex: 14.0,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.495,
		gpqa: 0.319,
		hle: 0.042,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"mistral-large-2-nov-24": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 15.1,
		normalizedScore: 22,

		// AA specific benchmarks
		codingIndex: 13.8,
		mathIndex: 14.0,

		// Academic benchmarks
		mmluPro: 0.697,
		gpqa: 0.486,
		hle: 0.04,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"mistral-large-2-jul-24": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 13.0,
		normalizedScore: 19,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: 0.0,

		// Academic benchmarks
		mmluPro: 0.683,
		gpqa: 0.472,
		hle: 0.032,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"pixtral-large": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 14.0,
		normalizedScore: 20,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: 2.3,

		// Academic benchmarks
		mmluPro: 0.701,
		gpqa: 0.505,
		hle: 0.036,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"mistral-small-3": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 12.7,
		normalizedScore: 18,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: 4.3,

		// Academic benchmarks
		mmluPro: 0.652,
		gpqa: 0.462,
		hle: 0.041,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"mistral-small-sep-24": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 10.2,
		normalizedScore: 15,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.529,
		gpqa: 0.381,
		hle: 0.043,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"mixtral-8x22b-instruct": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 9.8,
		normalizedScore: 14,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.537,
		gpqa: 0.332,
		hle: 0.041,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"mistral-small-feb-24": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 9.0,
		normalizedScore: 13,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.419,
		gpqa: 0.302,
		hle: 0.044,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"mistral-large-feb-24": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 9.9,
		normalizedScore: 14,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.515,
		gpqa: 0.351,
		hle: 0.034,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"mixtral-8x7b-instruct": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 7.7,
		normalizedScore: 11,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.387,
		gpqa: 0.292,
		hle: 0.045,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"mistral-7b-instruct": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 7.4,
		normalizedScore: 11,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.245,
		gpqa: 0.177,
		hle: 0.043,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"mistral-small-3.1": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 14.5,
		normalizedScore: 21,

		// AA specific benchmarks
		codingIndex: 13.9,
		mathIndex: 3.7,

		// Academic benchmarks
		mmluPro: 0.659,
		gpqa: 0.454,
		hle: 0.048,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"magistral-small-1": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 16.8,
		normalizedScore: 24,

		// AA specific benchmarks
		codingIndex: 11.1,
		mathIndex: 41.3,

		// Academic benchmarks
		mmluPro: 0.746,
		gpqa: 0.641,
		hle: 0.072,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"magistral-medium-1": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 18.8,
		normalizedScore: 27,

		// AA specific benchmarks
		codingIndex: 16.0,
		mathIndex: 40.3,

		// Academic benchmarks
		mmluPro: 0.753,
		gpqa: 0.679,
		hle: 0.095,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"mistral-small-3.2": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 15.1,
		normalizedScore: 22,

		// AA specific benchmarks
		codingIndex: 13.3,
		mathIndex: 27.0,

		// Academic benchmarks
		mmluPro: 0.681,
		gpqa: 0.505,
		hle: 0.043,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"devstral-small-jul-25": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 15.2,
		normalizedScore: 22,

		// AA specific benchmarks
		codingIndex: 12.1,
		mathIndex: 29.3,

		// Academic benchmarks
		mmluPro: 0.622,
		gpqa: 0.414,
		hle: 0.037,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"mistral-medium-3": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 18.8,
		normalizedScore: 27,

		// AA specific benchmarks
		codingIndex: 13.6,
		mathIndex: 30.3,

		// Academic benchmarks
		mmluPro: 0.76,
		gpqa: 0.578,
		hle: 0.043,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"devstral-medium": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 18.7,
		normalizedScore: 27,

		// AA specific benchmarks
		codingIndex: 15.9,
		mathIndex: 4.7,

		// Academic benchmarks
		mmluPro: 0.708,
		gpqa: 0.492,
		hle: 0.038,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"mistral-saba": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 12.1,
		normalizedScore: 17,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.611,
		gpqa: 0.424,
		hle: 0.041,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"devstral-small-may-25": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 18.0,
		normalizedScore: 26,

		// AA specific benchmarks
		codingIndex: 12.2,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.632,
		gpqa: 0.434,
		hle: 0.04,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"mistral-medium": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 9.0,
		normalizedScore: 13,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.491,
		gpqa: 0.349,
		hle: 0.034,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"deepseek-r1-distill-qwen-32b": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 17.2,
		normalizedScore: 25,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: 63.0,

		// Academic benchmarks
		mmluPro: 0.739,
		gpqa: 0.615,
		hle: 0.055,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"deepseek-v3-dec-24": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 16.5,
		normalizedScore: 24,

		// AA specific benchmarks
		codingIndex: 16.4,
		mathIndex: 26.0,

		// Academic benchmarks
		mmluPro: 0.752,
		gpqa: 0.557,
		hle: 0.036,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"deepseek-r1-distill-qwen-14b": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 15.8,
		normalizedScore: 23,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: 55.7,

		// Academic benchmarks
		mmluPro: 0.74,
		gpqa: 0.484,
		hle: 0.044,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"deepseek-v2.5-dec-24": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 12.5,
		normalizedScore: 18,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: undefined,
		hle: undefined,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"deepseek-coder-v2": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 10.6,
		normalizedScore: 15,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: undefined,
		hle: undefined,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"deepseek-r1-distill-llama-8b": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 12.1,
		normalizedScore: 17,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: 41.3,

		// Academic benchmarks
		mmluPro: 0.543,
		gpqa: 0.302,
		hle: 0.042,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"deepseek-llm-67b-chat-v1": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 8.4,
		normalizedScore: 12,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: undefined,
		hle: undefined,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"deepseek-r1-distill-qwen-1.5b": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 9.1,
		normalizedScore: 13,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: 22.0,

		// Academic benchmarks
		mmluPro: 0.269,
		gpqa: 0.098,
		hle: 0.033,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"deepseek-r1-jan-25": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 18.8,
		normalizedScore: 27,

		// AA specific benchmarks
		codingIndex: 15.9,
		mathIndex: 68.0,

		// Academic benchmarks
		mmluPro: 0.844,
		gpqa: 0.708,
		hle: 0.093,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"deepseek-v3-0324": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 22.3,
		normalizedScore: 32,

		// AA specific benchmarks
		codingIndex: 22.0,
		mathIndex: 41.0,

		// Academic benchmarks
		mmluPro: 0.819,
		gpqa: 0.655,
		hle: 0.052,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"deepseek-v3.1-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 27.7,
		normalizedScore: 40,

		// AA specific benchmarks
		codingIndex: 29.7,
		mathIndex: 89.7,

		// Academic benchmarks
		mmluPro: 0.851,
		gpqa: 0.779,
		hle: 0.13,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"deepseek-v2-chat": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 9.1,
		normalizedScore: 13,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: undefined,
		hle: undefined,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"deepseek-v3.1-terminus-non-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 28.5,
		normalizedScore: 41,

		// AA specific benchmarks
		codingIndex: 31.9,
		mathIndex: 53.7,

		// Academic benchmarks
		mmluPro: 0.836,
		gpqa: 0.751,
		hle: 0.084,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"deepseek-v3.1-non-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 28.1,
		normalizedScore: 40,

		// AA specific benchmarks
		codingIndex: 28.4,
		mathIndex: 49.7,

		// Academic benchmarks
		mmluPro: 0.833,
		gpqa: 0.735,
		hle: 0.063,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"deepseek-v3.1-terminus-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 33.9,
		normalizedScore: 48,

		// AA specific benchmarks
		codingIndex: 33.7,
		mathIndex: 89.7,

		// Academic benchmarks
		mmluPro: 0.851,
		gpqa: 0.792,
		hle: 0.152,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"deepseek-v3.2-exp-non-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 28.4,
		normalizedScore: 41,

		// AA specific benchmarks
		codingIndex: 30.0,
		mathIndex: 57.7,

		// Academic benchmarks
		mmluPro: 0.836,
		gpqa: 0.738,
		hle: 0.086,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"deepseek-v3.2-exp-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 32.9,
		normalizedScore: 47,

		// AA specific benchmarks
		codingIndex: 33.3,
		mathIndex: 87.7,

		// Academic benchmarks
		mmluPro: 0.85,
		gpqa: 0.797,
		hle: 0.138,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"deepseek-v2.5": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 12.3,
		normalizedScore: 18,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: undefined,
		hle: undefined,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"deepseek-coder-v2-lite-instruct": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 8.5,
		normalizedScore: 12,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.429,
		gpqa: 0.319,
		hle: 0.053,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	sonar: {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 15.5,
		normalizedScore: 22,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.689,
		gpqa: 0.471,
		hle: 0.073,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"sonar-reasoning-pro": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 24.6,
		normalizedScore: 35,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: undefined,
		hle: undefined,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"sonar-pro": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 15.2,
		normalizedScore: 22,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.755,
		gpqa: 0.578,
		hle: 0.079,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"sonar-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 17.9,
		normalizedScore: 26,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.623,
		hle: undefined,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"grok-beta": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 13.3,
		normalizedScore: 19,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.703,
		gpqa: 0.471,
		hle: 0.047,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"grok-4": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 41.5,
		normalizedScore: 59,

		// AA specific benchmarks
		codingIndex: 40.5,
		mathIndex: 92.7,

		// Academic benchmarks
		mmluPro: 0.866,
		gpqa: 0.877,
		hle: 0.239,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"grok-4-fast-non-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 23.1,
		normalizedScore: 33,

		// AA specific benchmarks
		codingIndex: 19.0,
		mathIndex: 41.3,

		// Academic benchmarks
		mmluPro: 0.73,
		gpqa: 0.606,
		hle: 0.05,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"grok-3-reasoning-beta": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 21.6,
		normalizedScore: 31,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: undefined,
		hle: undefined,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"grok-4.1-fast-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 38.6,
		normalizedScore: 55,

		// AA specific benchmarks
		codingIndex: 30.9,
		mathIndex: 89.3,

		// Academic benchmarks
		mmluPro: 0.854,
		gpqa: 0.853,
		hle: 0.176,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"grok-4-fast-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 35.1,
		normalizedScore: 50,

		// AA specific benchmarks
		codingIndex: 27.4,
		mathIndex: 89.7,

		// Academic benchmarks
		mmluPro: 0.85,
		gpqa: 0.847,
		hle: 0.17,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"grok-4.1-fast-non-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 23.6,
		normalizedScore: 34,

		// AA specific benchmarks
		codingIndex: 19.5,
		mathIndex: 34.3,

		// Academic benchmarks
		mmluPro: 0.743,
		gpqa: 0.637,
		hle: 0.05,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"grok-2-dec-24": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 13.9,
		normalizedScore: 20,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.709,
		gpqa: 0.51,
		hle: 0.038,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"grok-3": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 25.2,
		normalizedScore: 36,

		// AA specific benchmarks
		codingIndex: 19.8,
		mathIndex: 58.0,

		// Academic benchmarks
		mmluPro: 0.799,
		gpqa: 0.693,
		hle: 0.051,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"openchat-3.5-1210": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 8.3,
		normalizedScore: 12,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.31,
		gpqa: 0.23,
		hle: 0.048,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"nova-pro": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 13.5,
		normalizedScore: 19,

		// AA specific benchmarks
		codingIndex: 11.0,
		mathIndex: 7.0,

		// Academic benchmarks
		mmluPro: 0.691,
		gpqa: 0.499,
		hle: 0.034,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"nova-lite": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 12.7,
		normalizedScore: 18,

		// AA specific benchmarks
		codingIndex: 5.1,
		mathIndex: 7.0,

		// Academic benchmarks
		mmluPro: 0.59,
		gpqa: 0.433,
		hle: 0.046,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"phi-3-mini-instruct-3.8b": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 10.1,
		normalizedScore: 14,

		// AA specific benchmarks
		codingIndex: 3.0,
		mathIndex: 0.3,

		// Academic benchmarks
		mmluPro: 0.435,
		gpqa: 0.319,
		hle: 0.044,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"lfm-40b": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 8.8,
		normalizedScore: 13,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.425,
		gpqa: 0.327,
		hle: 0.049,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"lfm2-1.2b": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 6.3,
		normalizedScore: 9,

		// AA specific benchmarks
		codingIndex: 0.8,
		mathIndex: 3.3,

		// Academic benchmarks
		mmluPro: 0.257,
		gpqa: 0.228,
		hle: 0.057,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"solar-mini": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 11.9,
		normalizedScore: 17,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: undefined,
		hle: undefined,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"solar-pro-2-preview-non-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 16.0,
		normalizedScore: 23,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.725,
		gpqa: 0.544,
		hle: 0.038,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"solar-pro-2-preview-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 18.8,
		normalizedScore: 27,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.768,
		gpqa: 0.578,
		hle: 0.057,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"dbrx-instruct": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 8.3,
		normalizedScore: 12,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.397,
		gpqa: 0.331,
		hle: 0.066,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"minimax-m2": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 36.1,
		normalizedScore: 52,

		// AA specific benchmarks
		codingIndex: 29.2,
		mathIndex: 78.3,

		// Academic benchmarks
		mmluPro: 0.82,
		gpqa: 0.777,
		hle: 0.125,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"minimax-m2.5": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 41.9,
		normalizedScore: 60,

		// AA specific benchmarks
		codingIndex: 37.4,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.848,
		hle: 0.191,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"minimax-m1-40k": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 20.9,
		normalizedScore: 30,

		// AA specific benchmarks
		codingIndex: 14.1,
		mathIndex: 13.7,

		// Academic benchmarks
		mmluPro: 0.808,
		gpqa: 0.682,
		hle: 0.075,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"minimax-m2.1": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 39.4,
		normalizedScore: 56,

		// AA specific benchmarks
		codingIndex: 32.8,
		mathIndex: 82.7,

		// Academic benchmarks
		mmluPro: 0.875,
		gpqa: 0.83,
		hle: 0.222,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"minimax-m1-80k": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 24.4,
		normalizedScore: 35,

		// AA specific benchmarks
		codingIndex: 14.5,
		mathIndex: 61.0,

		// Academic benchmarks
		mmluPro: 0.816,
		gpqa: 0.697,
		hle: 0.082,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"kimi-k2-thinking": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 40.9,
		normalizedScore: 58,

		// AA specific benchmarks
		codingIndex: 34.8,
		mathIndex: 94.7,

		// Academic benchmarks
		mmluPro: 0.848,
		gpqa: 0.838,
		hle: 0.223,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"kimi-k2": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 26.3,
		normalizedScore: 38,

		// AA specific benchmarks
		codingIndex: 22.1,
		mathIndex: 57.0,

		// Academic benchmarks
		mmluPro: 0.824,
		gpqa: 0.766,
		hle: 0.07,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"kimi-k2-0905": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 30.9,
		normalizedScore: 44,

		// AA specific benchmarks
		codingIndex: 25.9,
		mathIndex: 57.3,

		// Academic benchmarks
		mmluPro: 0.819,
		gpqa: 0.767,
		hle: 0.063,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"llama-3.1-tulu3-405b": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 14.1,
		normalizedScore: 20,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.716,
		gpqa: 0.516,
		hle: 0.035,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"olmo-2-32b": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 10.6,
		normalizedScore: 15,

		// AA specific benchmarks
		codingIndex: 2.7,
		mathIndex: 3.3,

		// Academic benchmarks
		mmluPro: 0.511,
		gpqa: 0.328,
		hle: 0.037,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"olmo-3-32b-think": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 12.1,
		normalizedScore: 17,

		// AA specific benchmarks
		codingIndex: 10.5,
		mathIndex: 73.7,

		// Academic benchmarks
		mmluPro: 0.759,
		gpqa: 0.61,
		hle: 0.059,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"olmo-2-7b": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 9.3,
		normalizedScore: 13,

		// AA specific benchmarks
		codingIndex: 1.2,
		mathIndex: 0.7,

		// Academic benchmarks
		mmluPro: 0.282,
		gpqa: 0.288,
		hle: 0.055,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"granite-3.3-8b-non-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 7.0,
		normalizedScore: 10,

		// AA specific benchmarks
		codingIndex: 3.4,
		mathIndex: 6.7,

		// Academic benchmarks
		mmluPro: 0.468,
		gpqa: 0.338,
		hle: 0.042,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"reka-flash-sep-24": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 12.0,
		normalizedScore: 17,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: undefined,
		hle: undefined,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"hermes-3---llama-3.1-70b": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 10.6,
		normalizedScore: 15,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.571,
		gpqa: 0.401,
		hle: 0.041,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"mimo-v2-flash-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 39.2,
		normalizedScore: 56,

		// AA specific benchmarks
		codingIndex: 31.8,
		mathIndex: 96.3,

		// Academic benchmarks
		mmluPro: 0.843,
		gpqa: 0.846,
		hle: 0.211,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"sarvam-m-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 8.4,
		normalizedScore: 12,

		// AA specific benchmarks
		codingIndex: 7.5,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.696,
		gpqa: 0.416,
		hle: 0.033,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"glm-4.7-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 42.1,
		normalizedScore: 60,

		// AA specific benchmarks
		codingIndex: 36.3,
		mathIndex: 95.0,

		// Academic benchmarks
		mmluPro: 0.856,
		gpqa: 0.859,
		hle: 0.251,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"glm-4.7-flash-non-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 22.1,
		normalizedScore: 32,

		// AA specific benchmarks
		codingIndex: 11.0,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.452,
		hle: 0.049,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"glm-4.7-non-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 34.2,
		normalizedScore: 49,

		// AA specific benchmarks
		codingIndex: 32.0,
		mathIndex: 48.0,

		// Academic benchmarks
		mmluPro: 0.794,
		gpqa: 0.664,
		hle: 0.061,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"glm-4.6-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 32.5,
		normalizedScore: 46,

		// AA specific benchmarks
		codingIndex: 29.5,
		mathIndex: 86.0,

		// Academic benchmarks
		mmluPro: 0.829,
		gpqa: 0.78,
		hle: 0.133,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"glm-4.7-flash-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 30.1,
		normalizedScore: 43,

		// AA specific benchmarks
		codingIndex: 25.9,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.581,
		hle: 0.071,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"glm-4.6-non-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 30.2,
		normalizedScore: 43,

		// AA specific benchmarks
		codingIndex: 30.2,
		mathIndex: 44.3,

		// Academic benchmarks
		mmluPro: 0.784,
		gpqa: 0.632,
		hle: 0.052,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"glm-4.5-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 26.4,
		normalizedScore: 38,

		// AA specific benchmarks
		codingIndex: 26.3,
		mathIndex: 73.7,

		// Academic benchmarks
		mmluPro: 0.835,
		gpqa: 0.782,
		hle: 0.122,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"glm-4.5-air": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 23.2,
		normalizedScore: 33,

		// AA specific benchmarks
		codingIndex: 23.8,
		mathIndex: 80.7,

		// Academic benchmarks
		mmluPro: 0.815,
		gpqa: 0.733,
		hle: 0.068,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"glm-4.5v-non-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 12.7,
		normalizedScore: 18,

		// AA specific benchmarks
		codingIndex: 10.8,
		mathIndex: 15.3,

		// Academic benchmarks
		mmluPro: 0.751,
		gpqa: 0.573,
		hle: 0.036,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"glm-4.5v-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 15.1,
		normalizedScore: 22,

		// AA specific benchmarks
		codingIndex: 10.9,
		mathIndex: 73.0,

		// Academic benchmarks
		mmluPro: 0.788,
		gpqa: 0.684,
		hle: 0.059,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"command-r-apr-24": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 8.3,
		normalizedScore: 12,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.432,
		gpqa: 0.323,
		hle: 0.045,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"command-r-mar-24": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 7.4,
		normalizedScore: 11,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.338,
		gpqa: 0.284,
		hle: 0.048,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"apriel-v1.5-15b-thinker": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 28.3,
		normalizedScore: 40,

		// AA specific benchmarks
		codingIndex: 18.7,
		mathIndex: 87.5,

		// Academic benchmarks
		mmluPro: 0.773,
		gpqa: 0.713,
		hle: 0.12,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"jamba-1.5-large": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 10.7,
		normalizedScore: 15,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.572,
		gpqa: 0.427,
		hle: 0.04,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"jamba-1.5-mini": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 8.0,
		normalizedScore: 11,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.371,
		gpqa: 0.302,
		hle: 0.051,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"jamba-1.6-large": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 10.6,
		normalizedScore: 15,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.565,
		gpqa: 0.387,
		hle: 0.04,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"jamba-1.6-mini": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 7.9,
		normalizedScore: 11,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.367,
		gpqa: 0.3,
		hle: 0.046,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"arctic-instruct": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 8.8,
		normalizedScore: 13,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: undefined,
		hle: undefined,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwen2.5-max": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 16.3,
		normalizedScore: 23,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.762,
		gpqa: 0.587,
		hle: 0.045,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwen2.5-instruct-72b": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 15.6,
		normalizedScore: 22,

		// AA specific benchmarks
		codingIndex: 11.9,
		mathIndex: 14.0,

		// Academic benchmarks
		mmluPro: 0.72,
		gpqa: 0.491,
		hle: 0.042,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwen2.5-coder-instruct-32b": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 12.9,
		normalizedScore: 18,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.635,
		gpqa: 0.417,
		hle: 0.038,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwen2.5-turbo": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 12.0,
		normalizedScore: 17,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.633,
		gpqa: 0.41,
		hle: 0.042,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwen2-instruct-72b": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 11.7,
		normalizedScore: 17,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.622,
		gpqa: 0.371,
		hle: 0.037,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwen3-1.7b-non-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 6.8,
		normalizedScore: 10,

		// AA specific benchmarks
		codingIndex: 2.3,
		mathIndex: 7.3,

		// Academic benchmarks
		mmluPro: 0.411,
		gpqa: 0.283,
		hle: 0.052,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwen3-4b-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 14.2,
		normalizedScore: 20,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: 22.3,

		// Academic benchmarks
		mmluPro: 0.696,
		gpqa: 0.522,
		hle: 0.051,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwen3-4b-2507-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 18.2,
		normalizedScore: 26,

		// AA specific benchmarks
		codingIndex: 9.5,
		mathIndex: 82.7,

		// Academic benchmarks
		mmluPro: 0.743,
		gpqa: 0.667,
		hle: 0.059,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwen3-8b-non-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 10.6,
		normalizedScore: 15,

		// AA specific benchmarks
		codingIndex: 7.1,
		mathIndex: 24.3,

		// Academic benchmarks
		mmluPro: 0.643,
		gpqa: 0.452,
		hle: 0.028,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwen3-32b-non-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 14.5,
		normalizedScore: 21,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: 19.7,

		// Academic benchmarks
		mmluPro: 0.727,
		gpqa: 0.535,
		hle: 0.043,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwen3-235b-a22b-2507-instruct": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 25.0,
		normalizedScore: 36,

		// AA specific benchmarks
		codingIndex: 22.1,
		mathIndex: 71.7,

		// Academic benchmarks
		mmluPro: 0.828,
		gpqa: 0.753,
		hle: 0.106,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwen3-32b-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 16.5,
		normalizedScore: 24,

		// AA specific benchmarks
		codingIndex: 13.8,
		mathIndex: 73.0,

		// Academic benchmarks
		mmluPro: 0.798,
		gpqa: 0.668,
		hle: 0.083,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwen3-vl-30b-a3b-instruct": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 16.1,
		normalizedScore: 23,

		// AA specific benchmarks
		codingIndex: 14.3,
		mathIndex: 72.3,

		// Academic benchmarks
		mmluPro: 0.764,
		gpqa: 0.695,
		hle: 0.064,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwen3-30b-a3b-2507-instruct": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 15.0,
		normalizedScore: 21,

		// AA specific benchmarks
		codingIndex: 14.2,
		mathIndex: 66.3,

		// Academic benchmarks
		mmluPro: 0.777,
		gpqa: 0.659,
		hle: 0.068,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwen3-vl-8b-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 16.7,
		normalizedScore: 24,

		// AA specific benchmarks
		codingIndex: 9.8,
		mathIndex: 30.7,

		// Academic benchmarks
		mmluPro: 0.749,
		gpqa: 0.579,
		hle: 0.033,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwen3-vl-235b-a22b-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 27.6,
		normalizedScore: 39,

		// AA specific benchmarks
		codingIndex: 20.9,
		mathIndex: 88.3,

		// Academic benchmarks
		mmluPro: 0.836,
		gpqa: 0.772,
		hle: 0.101,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwen3-235b-a22b-2507-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 29.5,
		normalizedScore: 42,

		// AA specific benchmarks
		codingIndex: 23.2,
		mathIndex: 91.0,

		// Academic benchmarks
		mmluPro: 0.843,
		gpqa: 0.79,
		hle: 0.15,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwen2.5-instruct-32b": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 13.2,
		normalizedScore: 19,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.697,
		gpqa: 0.466,
		hle: 0.038,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwen3-235b-a22b-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 19.8,
		normalizedScore: 28,

		// AA specific benchmarks
		codingIndex: 17.4,
		mathIndex: 82.0,

		// Academic benchmarks
		mmluPro: 0.828,
		gpqa: 0.7,
		hle: 0.117,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwen3-235b-a22b-non-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 17.0,
		normalizedScore: 24,

		// AA specific benchmarks
		codingIndex: 14.0,
		mathIndex: 23.7,

		// Academic benchmarks
		mmluPro: 0.762,
		gpqa: 0.613,
		hle: 0.047,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwq-32b": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 19.7,
		normalizedScore: 28,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: 29.0,

		// Academic benchmarks
		mmluPro: 0.764,
		gpqa: 0.593,
		hle: 0.082,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwen3-vl-235b-a22b-instruct": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 20.8,
		normalizedScore: 30,

		// AA specific benchmarks
		codingIndex: 16.5,
		mathIndex: 70.7,

		// Academic benchmarks
		mmluPro: 0.823,
		gpqa: 0.712,
		hle: 0.063,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwen3-coder-30b-a3b-instruct": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 20.0,
		normalizedScore: 29,

		// AA specific benchmarks
		codingIndex: 19.4,
		mathIndex: 29.0,

		// Academic benchmarks
		mmluPro: 0.706,
		gpqa: 0.516,
		hle: 0.04,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwen3-8b-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 13.2,
		normalizedScore: 19,

		// AA specific benchmarks
		codingIndex: 9.0,
		mathIndex: 19.0,

		// Academic benchmarks
		mmluPro: 0.743,
		gpqa: 0.589,
		hle: 0.042,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwen3-max": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 31.4,
		normalizedScore: 45,

		// AA specific benchmarks
		codingIndex: 26.4,
		mathIndex: 80.7,

		// Academic benchmarks
		mmluPro: 0.841,
		gpqa: 0.764,
		hle: 0.111,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwen3-vl-32b-instruct": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 17.2,
		normalizedScore: 25,

		// AA specific benchmarks
		codingIndex: 15.6,
		mathIndex: 68.3,

		// Academic benchmarks
		mmluPro: 0.791,
		gpqa: 0.671,
		hle: 0.063,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwen3-30b-a3b-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 15.3,
		normalizedScore: 22,

		// AA specific benchmarks
		codingIndex: 11.0,
		mathIndex: 72.3,

		// Academic benchmarks
		mmluPro: 0.777,
		gpqa: 0.616,
		hle: 0.066,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwen3-max-thinking-preview": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 32.5,
		normalizedScore: 46,

		// AA specific benchmarks
		codingIndex: 24.5,
		mathIndex: 82.3,

		// Academic benchmarks
		mmluPro: 0.824,
		gpqa: 0.776,
		hle: 0.12,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwen3-30b-a3b-2507-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 22.4,
		normalizedScore: 32,

		// AA specific benchmarks
		codingIndex: 14.7,
		mathIndex: 56.3,

		// Academic benchmarks
		mmluPro: 0.805,
		gpqa: 0.707,
		hle: 0.098,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwen3-max-preview": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 26.1,
		normalizedScore: 37,

		// AA specific benchmarks
		codingIndex: 25.5,
		mathIndex: 75.0,

		// Academic benchmarks
		mmluPro: 0.838,
		gpqa: 0.764,
		hle: 0.093,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwen3-vl-8b-instruct": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 14.3,
		normalizedScore: 20,

		// AA specific benchmarks
		codingIndex: 7.3,
		mathIndex: 27.3,

		// Academic benchmarks
		mmluPro: 0.686,
		gpqa: 0.427,
		hle: 0.029,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwen1.5-chat-110b": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 9.5,
		normalizedScore: 14,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: 0.289,
		hle: undefined,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwen3-vl-4b-instruct": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 9.6,
		normalizedScore: 14,

		// AA specific benchmarks
		codingIndex: 4.5,
		mathIndex: 37.0,

		// Academic benchmarks
		mmluPro: 0.634,
		gpqa: 0.371,
		hle: 0.037,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwen3-vl-30b-a3b-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 19.7,
		normalizedScore: 28,

		// AA specific benchmarks
		codingIndex: 13.1,
		mathIndex: 82.3,

		// Academic benchmarks
		mmluPro: 0.807,
		gpqa: 0.72,
		hle: 0.087,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwen3-vl-4b-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 13.7,
		normalizedScore: 20,

		// AA specific benchmarks
		codingIndex: 6.7,
		mathIndex: 25.7,

		// Academic benchmarks
		mmluPro: 0.7,
		gpqa: 0.494,
		hle: 0.044,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwen3-1.7b-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 8.0,
		normalizedScore: 11,

		// AA specific benchmarks
		codingIndex: 1.4,
		mathIndex: 38.7,

		// Academic benchmarks
		mmluPro: 0.57,
		gpqa: 0.356,
		hle: 0.048,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwq-32b-preview": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 15.2,
		normalizedScore: 22,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.648,
		gpqa: 0.557,
		hle: 0.048,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwen-chat-72b": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 8.8,
		normalizedScore: 13,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: undefined,
		gpqa: undefined,
		hle: undefined,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwen3-4b-2507-instruct": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 12.9,
		normalizedScore: 18,

		// AA specific benchmarks
		codingIndex: 9.1,
		mathIndex: 52.3,

		// Academic benchmarks
		mmluPro: 0.672,
		gpqa: 0.517,
		hle: 0.047,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwen3-4b-non-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 12.5,
		normalizedScore: 18,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.586,
		gpqa: 0.398,
		hle: 0.037,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwen3-0.6b-non-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 5.7,
		normalizedScore: 8,

		// AA specific benchmarks
		codingIndex: 1.4,
		mathIndex: 10.3,

		// Academic benchmarks
		mmluPro: 0.231,
		gpqa: 0.231,
		hle: 0.052,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwen3-0.6b-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 6.5,
		normalizedScore: 9,

		// AA specific benchmarks
		codingIndex: 0.9,
		mathIndex: 18.0,

		// Academic benchmarks
		mmluPro: 0.347,
		gpqa: 0.239,
		hle: 0.057,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwen3-14b-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 16.2,
		normalizedScore: 23,

		// AA specific benchmarks
		codingIndex: 13.1,
		mathIndex: 55.7,

		// Academic benchmarks
		mmluPro: 0.774,
		gpqa: 0.604,
		hle: 0.043,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwen3-30b-a3b-non-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 12.5,
		normalizedScore: 18,

		// AA specific benchmarks
		codingIndex: 13.3,
		mathIndex: 21.7,

		// Academic benchmarks
		mmluPro: 0.71,
		gpqa: 0.515,
		hle: 0.046,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwen3-14b-non-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 12.8,
		normalizedScore: 18,

		// AA specific benchmarks
		codingIndex: 12.4,
		mathIndex: 58.0,

		// Academic benchmarks
		mmluPro: 0.675,
		gpqa: 0.47,
		hle: 0.042,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwen2.5-coder-instruct-7b": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 10.0,
		normalizedScore: 14,

		// AA specific benchmarks
		codingIndex: undefined,
		mathIndex: undefined,

		// Academic benchmarks
		mmluPro: 0.473,
		gpqa: 0.339,
		hle: 0.048,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"qwen3-vl-32b-reasoning": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 24.7,
		normalizedScore: 35,

		// AA specific benchmarks
		codingIndex: 14.5,
		mathIndex: 84.7,

		// Academic benchmarks
		mmluPro: 0.818,
		gpqa: 0.733,
		hle: 0.096,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
	},
	"seed-oss-36b-instruct": {
		// AA Intelligence Index (composite score)
		intelligenceIndex: 25.2,
		normalizedScore: 36,

		// AA specific benchmarks
		codingIndex: 16.7,
		mathIndex: 84.7,

		// Academic benchmarks
		mmluPro: 0.815,
		gpqa: 0.726,
		hle: 0.091,

		// Capabilities
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,

		// Metadata
		lastUpdated: "2026-04-01",
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

/**
 * Enhance model name with Coding Index score
 * Returns model name with CI score appended if available
 */
export function enhanceModelNameWithCodingIndex(
	modelName: string,
	modelId: string,
): string {
	const benchmark = findHardcodedBenchmark(modelName, modelId);
	if (benchmark?.codingIndex !== undefined) {
		return `${modelName} [CI: ${benchmark.codingIndex.toFixed(1)}]`;
	}
	return modelName;
}
