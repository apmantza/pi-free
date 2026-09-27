// Type declarations for tlc-coverage.mjs (untyped .mjs imported from a .ts
// test file, the same shape as host-provided-deps.d.mts). #585.

export interface TlcCoverageAction {
	name: string;
	module: string;
	/** Evaluations TLC attributed to the definition. */
	fired: number;
	/** The denominator TLC printed alongside it. */
	total: number;
}

export interface TlcCoveragePredicate {
	name: string;
	module: string;
}

export interface TlcCoverage {
	actions: TlcCoverageAction[];
	predicates: TlcCoveragePredicate[];
}

export function parseTlcCoverage(output: string): TlcCoverage;

export function zeroFireActions(coverage: TlcCoverage): TlcCoverageAction[];

export function formatCoverageReport(
	coverage: TlcCoverage,
	options: { config: string },
): string[];
