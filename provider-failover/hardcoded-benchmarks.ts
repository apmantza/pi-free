/**
 * Hardcoded benchmark data from Artificial Analysis
 * Updated monthly via GitHub Actions
 * Last updated: 2026-04-06
 *
 * This file contains cached benchmark scores so users don't need API keys.
 * Scores are Artificial Analysis Intelligence Index (0-70 scale)
 * Normalized to 0-100 for our ranking system.
 *
 * Data is split into chunk files (benchmarks-chunk-*.ts) to keep files
 * under the 3000-line limit. This file re-exports the merged result.
 *
 * To update: Run scripts/update-benchmarks.ts with ARTIFICIAL_ANALYSIS_API_KEY
 * The script auto-updates this file's imports and spread when chunk count changes.
 */

import { BENCHMARKS_CHUNK_0 } from "./benchmarks-chunk-0.ts";
import { BENCHMARKS_CHUNK_1 } from "./benchmarks-chunk-1.ts";
import { BENCHMARKS_CHUNK_2 } from "./benchmarks-chunk-2.ts";
import { BENCHMARKS_CHUNK_3 } from "./benchmarks-chunk-3.ts";
import { BENCHMARKS_CHUNK_4 } from "./benchmarks-chunk-4.ts";

export interface HardcodedBenchmark {
	intelligenceIndex: number; // AA score 0-70
	normalizedScore: number; // Our score 0-100
	codingIndex?: number;
	mathIndex?: number;
	agenticIndex?: number;
	reasoningIndex?: number;
	mmluPro?: number;
	gpqa?: number;
	hle?: number;
	contextWindow: number;
	supportsReasoning: boolean;
	supportsVision: boolean;
	lastUpdated: string;

	/**
	 * Original model name from the source API (for debugging name collisions).
	 * Only present when regenerated; absent in shipped data.
	 */
	originalModel?: string;
}

/**
 * Merged benchmark data from all chunk files.
 * Keys are normalized model names (lowercase, no special chars).
 */
export const HARDCODED_BENCHMARKS: Record<string, HardcodedBenchmark> = {
	...BENCHMARKS_CHUNK_0,
	...BENCHMARKS_CHUNK_1,
	...BENCHMARKS_CHUNK_2,
	...BENCHMARKS_CHUNK_3,
	...BENCHMARKS_CHUNK_4,
};
