/**
 * Hardcoded benchmark data from Artificial Analysis.
 *
 * The generated JSON is loaded synchronously on first access so importing the
 * provider extension does not parse the benchmark catalog during startup.
 */

import { readFileSync } from "node:fs";

export interface HardcodedBenchmark {
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

type BenchmarkMap = Record<string, HardcodedBenchmark>;

let benchmarkCache: BenchmarkMap | undefined;

function loadBenchmarks(): BenchmarkMap {
	if (!benchmarkCache) {
		benchmarkCache = JSON.parse(
			readFileSync(new URL("./benchmarks.json", import.meta.url), "utf8"),
		) as BenchmarkMap;
	}
	return benchmarkCache;
}

/**
 * Lazily loaded benchmark map. The proxy preserves the historical object API
 * while deferring JSON parsing until a benchmark lookup actually needs it.
 */
export const HARDCODED_BENCHMARKS: BenchmarkMap = new Proxy(
	{} as BenchmarkMap,
	{
		get(_target, property, receiver) {
			return Reflect.get(loadBenchmarks(), property, receiver);
		},
		has(_target, property) {
			return Reflect.has(loadBenchmarks(), property);
		},
		ownKeys() {
			return Reflect.ownKeys(loadBenchmarks());
		},
		getOwnPropertyDescriptor(_target, property) {
			return Reflect.getOwnPropertyDescriptor(loadBenchmarks(), property);
		},
	},
);
