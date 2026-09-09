import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
	capMutationFiles,
	DEFAULT_MAX_FILES,
	formatCapNotice,
	mapRelatedTests,
} from "./lib/stryker-diff.ts";

function argumentValue(name: string, fallback: string): string {
	let value = fallback;
	for (let index = 0; index < process.argv.length - 1; index += 1) {
		// A flag without a following value keeps the default instead of
		// assigning undefined (the loop bound only proves index defined).
		if (process.argv[index] === name)
			value = process.argv[index + 1] ?? fallback;
	}
	return value;
}

const base = argumentValue("--base", "origin/master");
const maxFiles = Number(
	argumentValue("--max-files", String(DEFAULT_MAX_FILES)),
);

// NOSONAR (typescript:S4036): "git" is a platform tool resolved via the
// operator's PATH by design — same class as backfill-github-releases.mjs.
// PATH-hardening (its approach) would break the node toolchain the
// mutation children inherit; the lane runs on pinned CI images and local
// dev shells where PATH is already the operator's own.
function changedFiles(): string[] {
	try {
		return execFileSync(
			"git", // NOSONAR -- see justification above
			["diff", "--name-only", "--diff-filter=AM", `${base}...HEAD`],
			{ encoding: "utf8" },
		)
			.split("\n")
			.map((file) => file.trim())
			.filter(Boolean);
	} catch (error) {
		console.error(
			`mutation diff: could not read ${base}...HEAD: ${error instanceof Error ? error.message : String(error)}`,
		);
		process.exit(1);
	}
}

const allFiles = changedFiles();
const { selected: files, skipped } = capMutationFiles(allFiles, maxFiles);
if (skipped.length > 0) {
	console.log(formatCapNotice(files.length, allFiles.length, skipped));
}
if (files.length === 0) {
	console.log("mutation diff: no changed files selected");
	process.exit(0);
}

const { covered, uncovered, tests } = mapRelatedTests(files);
for (const file of uncovered) {
	console.log(`mutation diff: no covering test for ${file}`);
}
if (covered.length === 0) {
	console.log("mutation diff: no covered changed files; no mutants run");
	process.exit(0);
}

console.log(`mutation diff: mutating ${covered.join(", ")}`);
console.log(`mutation diff: running related tests ${tests.join(", ")}`);
const testArgs = tests.length > 0 ? ["--testFiles", tests.join(",")] : [];
// Absolute repo-owned path: no PATH lookup, nothing writable to shadow.
const strykerBin = path.resolve("node_modules", ".bin", "stryker");
const result = spawnSync(
	strykerBin,
	["run", "--mutate", covered.join(","), ...testArgs],
	{ stdio: "inherit", encoding: "utf8" },
);

if (result.error || result.status !== 0) {
	const exitMsg = result.error ? `: ${result.error.message}` : "";
	console.error(
		`mutation diff: Stryker status ${result.status ?? "unknown"}${exitMsg}`,
	);
	process.exit(1);
}

const reportPath = "reports/mutation/mutation.json";
if (!existsSync(reportPath)) {
	console.error("mutation diff: report not found after Stryker run");
	process.exit(1);
}

interface MutantEntry {
	status?: string;
	mutatorName?: string;
	location?: { start?: { line?: number } };
	fileName?: string;
}

try {
	const report = JSON.parse(readFileSync(reportPath, "utf8")) as {
		files?: Record<string, { mutants?: MutantEntry[] }>;
	};
	// The mutation-report schema keys mutants by file; the entries
	// themselves carry no file name, so attach it here.
	const mutants: MutantEntry[] = Object.entries(report.files ?? {}).flatMap(
		([fileName, file]) =>
			(file.mutants ?? []).map((mutant) => ({ ...mutant, fileName })),
	);
	const counts: Record<string, number> = mutants.reduce(
		(out: Record<string, number>, mutant) => {
			const status = mutant.status ?? "unknown";
			out[status] = (out[status] ?? 0) + 1;
			return out;
		},
		{},
	);
	// The schema stores no score; Stryker's definition is
	// (killed + timeout) / (total - ignored - no coverage).
	const killed = (counts.Killed ?? 0) + (counts.Timeout ?? 0);
	const denominator =
		mutants.length - (counts.Ignored ?? 0) - (counts.NoCoverage ?? 0);
	const score =
		denominator > 0 ? ((killed / denominator) * 100).toFixed(2) : "n/a";
	console.log(`mutation diff score: ${score}`);
	console.log(`mutation diff counts: ${JSON.stringify(counts)}`);
	for (const mutant of mutants.filter((entry) => entry.status === "Survived")) {
		const line = mutant.location?.start?.line ?? "?";
		console.log(`survived: ${mutant.fileName}:${line} ${mutant.mutatorName}`);
	}
} catch (error) {
	console.error(
		`mutation diff: report unreadable: ${error instanceof Error ? error.message : String(error)}`,
	);
	process.exit(1);
}

console.log("mutation diff: completed");
