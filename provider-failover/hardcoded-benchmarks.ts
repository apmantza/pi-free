/**
 * Hardcoded benchmark data from Artificial Analysis
 * Updated monthly via GitHub Actions
 * Last updated: 2026-03-29
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
