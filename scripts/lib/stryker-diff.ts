import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const IMPORT_SPECIFIER_RE =
	/(?:from\s+|import\s*(?:\(\s*)?|require\(\s*)["']([^"']+)["']/g;

export const DEFAULT_MAX_FILES = 6;

// Mutation targets: library sources. Providers carry catalog/auth
// mechanics whose mutants mostly need network or credentials to kill —
// the pure-logic and lifecycle core (lib/) is where mutation pays.
// Test files, configs, and scripts are never mutated.
export function isMutationFile(file: string): boolean {
	return (
		/^lib\/.*\.ts$/.test(file) &&
		!file.endsWith(".test.ts") &&
		!file.endsWith(".d.ts")
	);
}

function collectTestFiles(dir: string, out: string[] = []): string[] {
	if (!existsSync(dir)) return out;
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) collectTestFiles(full, out);
		else if (entry.name.endsWith(".test.ts")) out.push(full);
	}
	return out;
}

function extractRelativeSpecifiers(content: string): string[] {
	const specifiers: string[] = [];
	IMPORT_SPECIFIER_RE.lastIndex = 0;
	let match = IMPORT_SPECIFIER_RE.exec(content);
	while (match) {
		if (match[1].startsWith(".")) specifiers.push(match[1]);
		match = IMPORT_SPECIFIER_RE.exec(content);
	}
	return specifiers;
}

function normalized(file: string): string {
	return path
		.resolve(file)
		.replaceAll("\\", "/")
		.replace(/\.(?:mts|ts|mjs|js|cjs)$/, "");
}

export function capMutationFiles(
	files: string[],
	maxFiles: number = DEFAULT_MAX_FILES,
): { selected: string[]; skipped: string[] } {
	if (!Number.isInteger(maxFiles) || maxFiles < 0) {
		throw new RangeError("maxFiles must be a non-negative integer");
	}
	const ordered = [...files].sort((a, b) => a.localeCompare(b));
	return {
		selected: ordered.slice(0, maxFiles),
		skipped: ordered.slice(maxFiles),
	};
}

export function formatCapNotice(
	selectedCount: number,
	totalCount: number,
	skipped: string[],
): string {
	return `capped: ${selectedCount} of ${totalCount} changed files mutated; skipped: ${skipped.join(", ")}`;
}

export interface RelatedTests {
	related: Map<string, Set<string>>;
	covered: string[];
	uncovered: string[];
	tests: string[];
}

/**
 * Select tests that cover changed lib files through one-hop relative
 * imports or the conventional tests/<basename>.test.ts sibling
 * (lib/toggle-state.ts <-> tests/toggle-state.test.ts).
 */
export function mapRelatedTests(
	changedFiles: string[],
	options: {
		testFiles?: string[];
		readFile?: (file: string) => string;
	} = {},
): RelatedTests {
	const { testFiles = collectTestFiles("tests"), readFile = defaultRead } =
		options;
	const targets = changedFiles.filter(isMutationFile);
	const related = new Map(targets.map((file) => [file, new Set<string>()]));
	const testContents: Array<[string, string | null]> = testFiles.map((test) => {
		try {
			return [test, readFile(test)] as [string, string];
		} catch {
			return [test, null] as [string, null];
		}
	});

	for (const file of targets) {
		const base = path.basename(file, ".ts");
		const sibling = path.join("tests", `${base}.test.ts`);
		if (testFiles.some((test) => normalized(test) === normalized(sibling))) {
			related.get(file)?.add(sibling);
		}
		const target = normalized(file);
		for (const [test, content] of testContents) {
			if (content === null) continue;
			for (const specifier of extractRelativeSpecifiers(content)) {
				const imported = normalized(
					path.resolve(path.dirname(test), specifier),
				);
				if (imported === target) related.get(file)?.add(test);
			}
		}
	}

	return {
		related,
		covered: targets.filter((file) => (related.get(file)?.size ?? 0) > 0),
		uncovered: targets.filter((file) => (related.get(file)?.size ?? 0) === 0),
		tests: [...new Set([...related.values()].flatMap((files) => [...files]))],
	};
}

function defaultRead(file: string): string {
	return readFileSync(file, "utf8");
}
