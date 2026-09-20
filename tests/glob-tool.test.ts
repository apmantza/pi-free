/**
 * `glob` tool wiring (issue #544).
 *
 * Recurrence this prevents: OpenCode Zen's free-tier gate requires the request
 * `tools[]` to carry `bash, edit, glob, grep, read`; Pi's file finder is named
 * `find` and its defaults omit `grep`, so an opencode-free request presented
 * fewer than the five and was refused with 403 FreeTierError.
 *
 * The find backend is stubbed via `FindOperations`, so the suite runs on any OS
 * with no `fd`/`rg` installed.
 */
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
	addOpenCodeFreeGateTools,
	GLOB_TOOL_NAME,
	registerGlobTool,
} from "../lib/glob-tool.ts";

interface CapturedPi {
	tools: ToolDefinition[];
}

function fakePi(): ExtensionAPI & CapturedPi {
	const tools: ToolDefinition[] = [];
	return {
		tools,
		registerTool: (tool: ToolDefinition) => {
			tools.push(tool);
		},
	} as unknown as ExtensionAPI & CapturedPi;
}

/** OS-neutral fake root; the stubbed operations never touch the filesystem. */
const FAKE_CWD = join(tmpdir(), "pi-free-glob-tool-test");

describe("registerGlobTool", () => {
	it("registers find's definition under the name glob", async () => {
		const pi = fakePi();
		await registerGlobTool(pi, FAKE_CWD, {
			operations: {
				exists: () => true,
				glob: () => ["alpha.ts", "beta.ts"],
			},
		});

		expect(pi.tools).toHaveLength(1);
		const tool = pi.tools[0]!;
		expect(tool.name).toBe(GLOB_TOOL_NAME);
		expect(tool.name).toBe("glob");
		expect(tool.label).toBe("glob");
		// Find's own schema is reused verbatim (pattern + optional path/limit).
		expect(tool.parameters).toBeDefined();

		const result = (await tool.execute(
			"call-1",
			{ pattern: "**/*.ts" } as never,
			undefined,
			undefined,
			{ cwd: FAKE_CWD } as never,
		)) as { content: Array<{ type: string; text?: string }> };
		const text = result.content.map((part) => part.text ?? "").join("");
		expect(text).toContain("alpha.ts");
		expect(text).toContain("beta.ts");
	});
});

describe("addOpenCodeFreeGateTools", () => {
	it("adds glob and grep for opencode-free, preserving the current selection", () => {
		const event = {
			systemPromptOptions: { selectedTools: ["read", "bash", "edit"] },
		};
		addOpenCodeFreeGateTools(event, "opencode-free");
		expect(event.systemPromptOptions.selectedTools).toEqual([
			"read",
			"bash",
			"edit",
			"glob",
			"grep",
		]);
	});

	it("is idempotent across repeated turns", () => {
		const event = {
			systemPromptOptions: { selectedTools: ["read", "bash", "edit"] },
		};
		addOpenCodeFreeGateTools(event, "opencode-free");
		addOpenCodeFreeGateTools(event, "opencode-free");
		expect(event.systemPromptOptions.selectedTools).toEqual([
			"read",
			"bash",
			"edit",
			"glob",
			"grep",
		]);
	});

	it("does not touch other providers", () => {
		const event = { systemPromptOptions: { selectedTools: ["read"] } };
		addOpenCodeFreeGateTools(event, "zenmux");
		addOpenCodeFreeGateTools(event, undefined);
		expect(event.systemPromptOptions.selectedTools).toEqual(["read"]);
	});
});
