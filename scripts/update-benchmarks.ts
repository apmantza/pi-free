/**
 * Script to update hardcoded benchmark data
 * Run: ARTIFICIAL_ANALYSIS_API_KEY=xxx node --import tsx scripts/update-benchmarks.ts
 *
 * This fetches fresh data from Artificial Analysis API and writes
 * provider-failover/benchmarks.json, the lazily loaded runtime
 * catalog used by provider-failover/hardcoded-benchmarks.ts.
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

const OUTPUT_DIR = join(process.cwd(), "provider-failover");

interface AAModel {
	id: string;
	name: string;
	slug: string;
	model_creator: {
		id: string;
		name: string;
		slug: string;
	};
	release_date: string;
	evaluations: {
		artificial_analysis_intelligence_index: number | null;
		artificial_analysis_coding_index: number | null;
		artificial_analysis_math_index: number | null;
		mmlu_pro: number | null;
		gpqa: number | null;
		hle: number | null;
	};
	context_window?: number;
	supports_reasoning?: boolean;
	supports_vision?: boolean;
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

function sanitizeString(s: string): string {
	// Strip CRLF characters to prevent log injection (SonarCloud S1075)
	return s.replaceAll(/[\n\r]/g, "_");
}

/**
 * Sanitize a value for safe console.log output.
 * Prevents log injection from external/untrusted data (SonarCloud S5693).
 */
function sanitizeForLog(value: unknown): string {
	const s = String(value);
	// Replace CR, LF, and tab characters that could forge log entries
	return s.replaceAll(/[\n\r\t]/g, " ");
}

function normalizeModelName(name: string): string {
	name = sanitizeString(name);
	name = name.toLowerCase().replace(/[^-a-z0-9.+]+/g, "-");
	// Strip leading/trailing dashes (no regex — avoids backtracking flags)
	while (name.startsWith("-")) name = name.slice(1);
	while (name.endsWith("-")) name = name.slice(0, -1);
	return name;
}

function generateBenchmarkJson(models: AAModel[]): Record<string, unknown> {
	const today = new Date().toISOString().split("T")[0];
	const benchmarks: Record<string, unknown> = {};

	for (const model of models) {
		const e = model.evaluations;
		const benchmark: Record<string, unknown> = {
			contextWindow: model.context_window || 8192,
			supportsReasoning: model.supports_reasoning || false,
			supportsVision: model.supports_vision || false,
			lastUpdated: today,
			originalModel: model.name.replaceAll(/[\n\r]/g, "_"),
		};
		const addNumber = (key: string, value: number | null): void => {
			if (value !== null) benchmark[key] = Number(value.toFixed(3));
		};
		addNumber("codingIndex", e.artificial_analysis_coding_index);
		addNumber("mathIndex", e.artificial_analysis_math_index);
		addNumber("mmluPro", e.mmlu_pro);
		addNumber("gpqa", e.gpqa);
		addNumber("hle", e.hle);
		benchmarks[normalizeModelName(model.name)] = benchmark;
	}

	return benchmarks;
}

function writeBenchmarksJson(models: AAModel[]): void {
	// Filter to models with intelligence scores (allow 0, reject null/undefined)
	const scoredModels = models.filter(
		(m) => m.evaluations?.artificial_analysis_intelligence_index != null,
	);

	console.log(
		`✅ Found ${sanitizeForLog(scoredModels.length)}/${sanitizeForLog(models.length)} models with benchmark scores`,
	);

	const jsonFile = join(OUTPUT_DIR, "benchmarks.json");
	writeFileSync(
		jsonFile,
		`${JSON.stringify(generateBenchmarkJson(scoredModels), null, "\t")}\n`,
		"utf-8",
	);
	console.log(`\n✅ Generated ${jsonFile}`);
}

async function main() {
	try {
		console.log("🔄 Benchmark Data Updater\n");

		const models = await fetchAIData();
		writeBenchmarksJson(models);

		console.log("\n📝 Next steps:");
		console.log("  1. Review the benchmarks.json changes");
		console.log("  2. Run tests: npm run test:run");
		console.log("  3. Commit and push");
		console.log("  4. Create PR if this was an automated update");
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "An unknown error occurred";
		console.error("\n❌ Error:", sanitizeForLog(message));
		process.exit(1);
	}
}

// Top-level await — SonarCloud S7785
main().catch((err: unknown) => {
	const message =
		err instanceof Error ? err.message : "An unknown error occurred";
	console.error("Fatal:", sanitizeForLog(message));
	process.exit(1);
});
