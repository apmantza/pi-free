/**
 * Benchmark refresh guard tests.
 *
 * Recurrence: the 2026-11-01 scheduled refresh (PR #653) wrote a catalog
 * where 0 of 89 models carried `codingIndex` (the replaced catalog had 259 of
 * 678), and the generator did not notice. These cases pin both recognized
 * shapes and the two refusals.
 */

import { describe, expect, it } from "vitest";

import { assessBenchmarkUpdate } from "../scripts/lib/benchmark-update-guard.ts";

function model(codingIndex?: number) {
	return {
		contextWindow: 8192,
		supportsReasoning: false,
		supportsVision: false,
		lastUpdated: "2026-11-01",
		originalModel: "Some Model",
		...(codingIndex === undefined ? { hle: 0.5, gpqa: 0.8 } : { codingIndex }),
	};
}

function catalog(count: number, codingIndex?: number) {
	return Object.fromEntries(
		Array.from({ length: count }, (_, index) => [
			`model-${index}`,
			model(codingIndex),
		]),
	);
}

describe("assessBenchmarkUpdate", () => {
	it("admits a refresh that keeps the catalog and its coding indices", () => {
		const assessment = assessBenchmarkUpdate(
			catalog(4, 61.2),
			catalog(4, 60.8),
		);

		expect(assessment).toEqual({ ok: true, problems: [] });
	});

	it("refuses a refresh with no coding index for any model", () => {
		// The 2026-11-01 response: intelligence-scored models, other
		// evaluations present, coding index absent everywhere.
		const assessment = assessBenchmarkUpdate(catalog(89), catalog(678, 55));

		expect(assessment.ok).toBe(false);
		expect(assessment.problems.join("\n")).toMatch(/no codingIndex/);
	});

	it("refuses an implausible shrink even when coding indices survive", () => {
		const assessment = assessBenchmarkUpdate(catalog(89, 50), catalog(678, 55));

		expect(assessment.ok).toBe(false);
		expect(assessment.problems.join("\n")).toMatch(
			/shrank the catalog from 678 to 89 models/,
		);
	});

	it("refuses an empty refresh", () => {
		const assessment = assessBenchmarkUpdate({}, catalog(10, 50));

		expect(assessment.ok).toBe(false);
		expect(assessment.problems.join("\n")).toMatch(/no models/);
	});

	it("does not apply the shrink rule on a first run with no catalog", () => {
		const assessment = assessBenchmarkUpdate(catalog(3, 50), {});

		expect(assessment).toEqual({ ok: true, problems: [] });
	});
});
