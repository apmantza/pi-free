/**
 * Mutation config for the diff-scoped advisory lane
 * (scripts/stryker-diff.mjs + .github/workflows/mutation.yml).
 *
 * Vitest runner (not command runner): pi-free's tests already run under
 * vitest with @vitest/coverage-v8 present. No typescript checker — type
 * errors in mutants surface as ordinary test failures, which is fine for
 * an advisory lane. Thresholds never break the build; the diff script
 * reports the score and the survivors, and a human decides.
 */
export default {
	// inPlace: Stryker's sandbox copy runs a tsconfig preprocessor that
	// calls ts.parseConfigFileTextToJson, which the TypeScript 7 native API
	// does not export (TypeError on every run). Mutating in place skips
	// that preprocessor; Stryker restores files after each mutant.
	inPlace: true,
	testRunner: "vitest",
	reporters: ["clear-text", "json"],
	jsonReporter: { fileName: "reports/mutation/mutation.json" },
	thresholds: { high: 60, low: 20, break: 0 },
	concurrency: 2,
	timeoutMS: 60000,
	timeoutFactor: 1.5,
};
