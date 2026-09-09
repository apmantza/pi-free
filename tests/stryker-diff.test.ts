import { describe, expect, it } from "vitest";
import {
	capMutationFiles,
	formatCapNotice,
	isMutationFile,
	mapRelatedTests,
} from "../scripts/lib/stryker-diff.ts";

describe("isMutationFile", () => {
	it("selects lib sources, never tests/configs/scripts", () => {
		expect(isMutationFile("lib/toggle-state.ts")).toBe(true);
		expect(isMutationFile("lib/auto-fallback/index.ts")).toBe(true);
		expect(isMutationFile("lib/toggle-state.test.ts")).toBe(false);
		expect(isMutationFile("providers/kilo/kilo.ts")).toBe(false);
		expect(isMutationFile("scripts/check-tarball.mjs")).toBe(false);
		expect(isMutationFile("index.ts")).toBe(false);
		expect(isMutationFile("lib/logger.d.ts")).toBe(false);
	});
});

describe("capMutationFiles", () => {
	it("sorts and caps, reporting the skipped", () => {
		const { selected, skipped } = capMutationFiles(
			["lib/b.ts", "lib/a.ts", "lib/c.ts"],
			2,
		);
		expect(selected).toEqual(["lib/a.ts", "lib/b.ts"]);
		expect(skipped).toEqual(["lib/c.ts"]);
	});

	it("rejects a non-integer cap", () => {
		expect(() => capMutationFiles(["lib/a.ts"], -1)).toThrow(RangeError);
	});

	it("formats the cap notice", () => {
		expect(formatCapNotice(2, 3, ["lib/c.ts"])).toContain("2 of 3");
	});
});

describe("mapRelatedTests", () => {
	const readFile =
		(files: Record<string, string>) =>
		(file: string): string => {
			if (!(file in files)) throw new Error(`no fixture: ${file}`);
			return files[file];
		};

	it("maps siblings and one-hop importers", () => {
		const { covered, uncovered, tests } = mapRelatedTests(
			["lib/toggle-state.ts", "lib/lonely.ts"],
			{
				testFiles: ["tests/toggle-state.test.ts", "tests/other.test.ts"],
				readFile: readFile({
					"tests/toggle-state.test.ts": `import "../lib/toggle-state.ts";`,
					"tests/other.test.ts": `import "../lib/toggle-state.ts";`,
				}),
			},
		);
		expect(covered).toEqual(["lib/toggle-state.ts"]);
		expect(uncovered).toEqual(["lib/lonely.ts"]);
		expect(tests).toContain("tests/toggle-state.test.ts");
		expect(tests).toContain("tests/other.test.ts");
	});

	it("ignores non-mutation files in the changed set", () => {
		const { covered, tests } = mapRelatedTests(["index.ts", "lib/real.ts"], {
			testFiles: ["tests/real.test.ts"],
			readFile: readFile({ "tests/real.test.ts": `import "../lib/real.ts";` }),
		});
		expect(covered).toEqual(["lib/real.ts"]);
		expect(tests).toEqual(["tests/real.test.ts"]);
	});
});
