/**
 * Fail-closed guard for the monthly Artificial Analysis catalog refresh.
 *
 * Recurrence (2026-11-01 scheduled run, PR #653): the API answered with 89
 * scored models and not one of them carried
 * `evaluations.artificial_analysis_coding_index` — the catalog it replaced
 * had 259 coding-index entries out of 678. The generator wrote that response
 * straight over `provider-failover/benchmarks.json`, so the refresh replaced
 * the data behind `semantic coding score` with a catalog that cannot answer a
 * single lookup. Nothing in the generator noticed; the regression surfaced
 * later as eight red cases in `tests/benchmark-lookup.test.ts`.
 *
 * The guard judges only what an automated refresh can get wrong: a response
 * shape this code does not recognize. It admits the two shapes the catalog
 * needs to stay usable — a non-empty model set and at least one coding index —
 * and refuses everything else. It never tries to enumerate known-bad API
 * spellings; a future field rename is refused until this file is updated.
 *
 * A refusal writes nothing: the workflow's "Check for changes" step then sees
 * a clean tree and opens no PR, so a bad refresh costs a red scheduled run
 * instead of a silently degraded catalog.
 */

/** Minimum share of the previous catalog a refresh may keep. */
const MIN_CATALOG_SHARE = 0.5;

export interface BenchmarkUpdateAssessment {
	ok: boolean;
	problems: string[];
}

function hasCodingIndex(entry: unknown): boolean {
	if (!entry || typeof entry !== "object") return false;
	const codingIndex = (entry as { codingIndex?: unknown }).codingIndex;
	return typeof codingIndex === "number" && Number.isFinite(codingIndex);
}

function countCodingIndex(catalog: Record<string, unknown>): number {
	return Object.values(catalog).filter(hasCodingIndex).length;
}

/**
 * Judge a generated catalog against the one on disk.
 *
 * `previous` is `{}` on a first run (no catalog yet), which disables only the
 * shrink rule — an unrecognized new response is still refused.
 */
export function assessBenchmarkUpdate(
	next: Record<string, unknown>,
	previous: Record<string, unknown>,
): BenchmarkUpdateAssessment {
	const problems: string[] = [];
	const nextCount = Object.keys(next).length;
	const previousCount = Object.keys(previous).length;

	if (nextCount === 0) {
		problems.push(
			"the refresh produced no models; the API response shape was not recognized",
		);
	} else if (countCodingIndex(next) === 0) {
		problems.push(
			`the refresh produced ${nextCount} models and no codingIndex for any of them; the coding-index field was not recognized in this response`,
		);
	}

	if (previousCount > 0 && nextCount < previousCount * MIN_CATALOG_SHARE) {
		problems.push(
			`the refresh shrank the catalog from ${previousCount} to ${nextCount} models (more than ${Math.round((1 - MIN_CATALOG_SHARE) * 100)}% smaller)`,
		);
	}

	return { ok: problems.length === 0, problems };
}
