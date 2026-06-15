import type { Context, Model, Tool } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	__test__,
	streamClineXml,
} from "../providers/cline/cline-xml-bridge.ts";

function tool(name: string): Tool {
	return {
		name,
		description: `${name} tool`,
		parameters: { type: "object", properties: {} } as Tool["parameters"],
	};
}

function clineModel(id = "xiaomi/mimo-v2.5"): Model<string> {
	return {
		id,
		name: id,
		api: "cline-xml-tools",
		provider: "cline",
	} as Model<string>;
}

function clineContext(): Context {
	return {
		systemPrompt: "system",
		messages: [
			{
				role: "user",
				content: [{ type: "text", text: "continue" }],
				timestamp: 1,
			},
		],
		tools: [tool("read")],
	};
}

function sseResponse(chunks: unknown[], status = 200): Response {
	const body = `${chunks
		.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
		.join("")}data: [DONE]\n\n`;
	return new Response(body, { status });
}

function requestBody(fetchMock: ReturnType<typeof vi.spyOn>, index: number) {
	const init = fetchMock.mock.calls[index]?.[1] as RequestInit | undefined;
	return JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("Cline XML bridge", () => {
	describe("parseXmlToolCalls", () => {
		it("maps Cline execute_command XML to Pi bash tool calls", () => {
			const parsed = __test__.parseXmlToolCalls(
				[
					"<execute_command>",
					' <command>cat C:/Users/R3LiC/Desktop/pi-free/.github/workflows/ci.yml 2&gt;/dev/null || echo "No ci.yml"</command>',
					"</execute_command>",
				].join("\n"),
				[tool("bash")],
			);

			expect(parsed.text).toBe("");
			expect(parsed.toolCalls).toEqual([
				{
					name: "bash",
					arguments: {
						command:
							'cat C:/Users/R3LiC/Desktop/pi-free/.github/workflows/ci.yml 2>/dev/null || echo "No ci.yml"',
					},
				},
			]);
		});

		it("recognizes core Cline tool names even if the context tool list is missing", () => {
			const parsed = __test__.parseXmlToolCalls(
				"<execute_command>\n<command>npm test</command>\n</execute_command>",
				undefined,
			);

			expect(parsed.toolCalls).toEqual([
				{ name: "bash", arguments: { command: "npm test" } },
			]);
		});

		it("recovers Cline heredoc file writes as Pi write tool calls", () => {
			const parsed = __test__.parseXmlToolCalls(
				[
					"The user wants to continue scaffolding. Let me write the package.json properly.",
					"</thinking>",
					"<execute_command>",
					"<command>cat > \"C:/Users/R3LiC/Desktop/pi-plegma/.pi/extensions/plegma/package.json\" << 'JSONEOF'",
					"{",
					'  "name": "plegma",',
					'  "version": "0.1.0",',
					'  "type": "module",',
					'  "main": "./index.ts",',
					'  "private": true,',
					'  "pi": {',
					'    "extensions": ["./index.ts"]',
					"  }",
					"}",
					"JSONEOF",
					'cat "C:/Users/R3LiC/Desktop/pi-plegma/.pi/extensions/plegma/package.json"</command>',
					"</execute_command>",
				].join("\n"),
				[tool("bash"), tool("write")],
			);

			expect(parsed.text).toBe("");
			expect(parsed.toolCalls).toEqual([
				{
					name: "write",
					arguments: {
						path: "C:/Users/R3LiC/Desktop/pi-plegma/.pi/extensions/plegma/package.json",
						content: [
							"{",
							'  "name": "plegma",',
							'  "version": "0.1.0",',
							'  "type": "module",',
							'  "main": "./index.ts",',
							'  "private": true,',
							'  "pi": {',
							'    "extensions": ["./index.ts"]',
							"  }",
							"}",
						].join("\n"),
					},
				},
			]);
		});

		it("recovers top-level escaped XML tool calls", () => {
			const parsed = __test__.parseXmlToolCalls(
				"&lt;read_file&gt;&lt;path&gt;package.json&lt;/path&gt;&lt;/read_file&gt;",
				[tool("read")],
			);

			expect(parsed.toolCalls).toEqual([
				{ name: "read", arguments: { path: "package.json" } },
			]);
		});

		it("strips orphan thinking close tags before multiple Cline read calls", () => {
			const parsed = __test__.parseXmlToolCalls(
				String.raw`</thinking>
<read_file>
<path>C:\Users\R3LiC\AppData\Roaming\npm\node_modules\@earendil-works\pi-coding-agent\docs\sdk.md</path>
</read_file>
<read_file>
<path>C:\Users\R3LiC\AppData\Roaming\npm\node_modules\@earendil-works\pi-coding-agent\docs\session-format.md</path>
</read_file>
<read_file>
<path>C:\Users\R3LiC\AppData\Roaming\npm\node_modules\@earendil-works\pi-coding-agent\docs\tui.md</path>
</read_file>`,
				[tool("read")],
			);

			expect(parsed.text).toBe("");
			expect(parsed.toolCalls).toEqual([
				{
					name: "read",
					arguments: {
						path: String.raw`C:\Users\R3LiC\AppData\Roaming\npm\node_modules\@earendil-works\pi-coding-agent\docs\sdk.md`,
					},
				},
				{
					name: "read",
					arguments: {
						path: String.raw`C:\Users\R3LiC\AppData\Roaming\npm\node_modules\@earendil-works\pi-coding-agent\docs\session-format.md`,
					},
				},
				{
					name: "read",
					arguments: {
						path: String.raw`C:\Users\R3LiC\AppData\Roaming\npm\node_modules\@earendil-works\pi-coding-agent\docs\tui.md`,
					},
				},
			]);
		});

		it("strips XML thinking blocks before Cline tool calls", () => {
			const parsed = __test__.parseXmlToolCalls(
				[
					"<thinking>",
					"I should inspect the docs first.",
					"</thinking>",
					"<read_file>",
					"<path>README.md</path>",
					"</read_file>",
				].join("\n"),
				[tool("read")],
			);

			expect(parsed.text).toBe("");
			expect(parsed.toolCalls).toEqual([
				{ name: "read", arguments: { path: "README.md" } },
			]);
		});

		it("treats plain text before dangling thinking close as thinking", () => {
			const parsed = __test__.parseXmlToolCalls(
				[
					"We need create new file pi capabilities.md and update proposed implementation to reference it.",
					"Probably add section referencing pi capabilities. Need edit implementation to add section about leveraging pi capabilities. Use edit.",
					"</thinking>",
				].join("\n"),
				[tool("edit"), tool("write")],
			);

			expect(parsed.text).toBe("");
			expect(parsed.toolCalls).toEqual([]);
		});

		it("treats plain text before dangling summary close as hidden thinking", () => {
			const parsed = __test__.parseXmlToolCalls(
				[
					"The user makes a good point about worker diversity.",
					"Let me check if the diversePanel function already handles this.",
					"</summary>",
				].join("\n"),
				[tool("edit"), tool("write")],
			);

			expect(parsed.text).toBe("");
			expect(parsed.toolCalls).toEqual([]);
		});

		it("treats plain text before dangling persistent issue close as hidden thinking", () => {
			const parsed = __test__.parseXmlToolCalls(
				[
					"The user wants me to continue. Let me fix the issues found by the diagnostics.",
					"The main things to fix are remove unused imports and fix empty catch blocks.",
					"</persistent_issue_checking>",
				].join("\n"),
				[tool("edit"), tool("write")],
			);

			expect(parsed.text).toBe("");
			expect(parsed.toolCalls).toEqual([]);
		});

		it("does not execute tool calls hidden in visible summary wrappers", () => {
			const parsed = __test__.parseXmlToolCalls(
				[
					"<summary>",
					"The user wants me to inspect the file first.",
					"<read_file>",
					"<path>README.md</path>",
					"</read_file>",
					"</summary>",
				].join("\n"),
				[tool("read")],
			);

			expect(parsed.text).toBe("");
			expect(parsed.toolCalls).toEqual([]);
		});

		it("does not execute tool calls hidden in visible persistent issue wrappers", () => {
			const parsed = __test__.parseXmlToolCalls(
				[
					"<persistent_issue_checking>",
					"Let me fix the formatter issues now.",
					"<execute_command>",
					"<command>npm run check</command>",
					"</execute_command>",
					"</persistent_issue_checking>",
				].join("\n"),
				[tool("bash")],
			);

			expect(parsed.text).toBe("");
			expect(parsed.toolCalls).toEqual([]);
		});

		it("recovers tool calls inside reasoning-channel hidden wrappers", () => {
			const parsed = __test__.parseReasoningHiddenToolCalls(
				[
					[
						"The user wants me to inspect the file first.",
						"<read_file>",
						"<path>README.md</path>",
						"</read_file>",
					].join("\n"),
				],
				[tool("read")],
			);

			expect(parsed.thinking).toEqual([
				"The user wants me to inspect the file first.",
			]);
			expect(parsed.toolCalls).toEqual([
				{ name: "read", arguments: { path: "README.md" } },
			]);
		});

		it("treats DeepSeek-style <think> block content as thinking", () => {
			const parsed = __test__.parseXmlToolCalls(
				[
					"<think>",
					"The user wants me to continue. Let me check what still needs to be done.",
					"</thinking>",
					"<read_file>",
					"<path>C:/Users/R3LiC/Desktop/pi-plegma/proposed implementation.md</path>",
					"<offset>1100</offset>",
					"<limit>50</limit>",
					"</read_file>",
				].join("\n"),
				[tool("read")],
			);

			expect(parsed.text).toBe("");
			expect(parsed.toolCalls).toEqual([
				{
					name: "read",
					arguments: {
						path: "C:/Users/R3LiC/Desktop/pi-plegma/proposed implementation.md",
					},
				},
			]);
		});

		it("parses Cline write_to_file with Windows path and multi-line content", () => {
			const parsed = __test__.parseXmlToolCalls(
				[
					"<write_to_file>",
					" <path>C:/Users/R3LiC/Desktop/pi-plegma/pi capabilities.md</path>",
					" <content># Pi SDK Capabilities for Plegma",
					"This document maps pi's existing SDK capabilities to Plegma's requirements.</content>",
					"</write_to_file>",
				].join("\n"),
				[tool("write")],
			);

			expect(parsed.text).toBe("");
			expect(parsed.toolCalls).toEqual([
				{
					name: "write",
					arguments: {
						path: "C:/Users/R3LiC/Desktop/pi-plegma/pi capabilities.md",
						content:
							"# Pi SDK Capabilities for Plegma\nThis document maps pi's existing SDK capabilities to Plegma's requirements.",
					},
				},
			]);
		});

		it("recovers write_to_file emitted in the reasoning channel", () => {
			const parsed = __test__.parseReasoningToolCalls(
				[
					"Good, the package.json is created correctly. Now I need to write index.ts.",
					"</thinking>",
					"<write_to_file>",
					"<path>C:/Users/R3LiC/Desktop/pi-plegma/.pi/extensions/plegma/index.ts</path>",
					"<content>/**",
					" * Plegma extension",
					" */",
					"const branch = `plegma-${runId}-${role}`;",
					"</content>",
					"</write_to_file>",
				].join("\n"),
				[tool("write")],
			);

			expect(parsed.thinking).toEqual([
				"Good, the package.json is created correctly. Now I need to write index.ts.",
			]);
			expect(parsed.toolCalls).toEqual([
				{
					name: "write",
					arguments: {
						path: "C:/Users/R3LiC/Desktop/pi-plegma/.pi/extensions/plegma/index.ts",
						content: [
							"/**",
							" * Plegma extension",
							" */",
							"const branch = `plegma-${runId}-${role}`;",
						].join("\n"),
					},
				},
			]);
		});

		it("does not leak XML code fence markers as text", () => {
			const parsed = __test__.parseXmlToolCalls(
				[
					"```xml",
					"<read_file>",
					"<path>package.json</path>",
					"</read_file>",
					"```",
				].join("\n"),
				[tool("read")],
			);

			expect(parsed.text).toBe("");
			expect(parsed.toolCalls).toEqual([
				{ name: "read", arguments: { path: "package.json" } },
			]);
		});

		it("parses a final incomplete Cline tool block instead of leaking it as text", () => {
			const parsed = __test__.parseXmlToolCalls(
				"<execute_command>\n<command>npm run test:run</command>",
				[tool("bash")],
			);

			expect(parsed.text).toBe("");
			expect(parsed.toolCalls).toEqual([
				{ name: "bash", arguments: { command: "npm run test:run" } },
			]);
		});

		it("maps Cline write_to_file XML to Pi write tool calls", () => {
			const parsed = __test__.parseXmlToolCalls(
				[
					"<write_to_file>",
					"<path>src/new-file.ts</path>",
					"<content>export const value = 1;</content>",
					"</write_to_file>",
				].join("\n"),
				[tool("write")],
			);

			expect(parsed.toolCalls).toEqual([
				{
					name: "write",
					arguments: {
						path: "src/new-file.ts",
						content: "export const value = 1;",
					},
				},
			]);
		});

		it("preserves JSON file content as a string in write_to_file", () => {
			const jsonContent = JSON.stringify(
				{
					name: "plegma",
					version: "0.1.0",
					pi: { extensions: ["./index.ts"] },
				},
				null,
				2,
			);
			const parsed = __test__.parseXmlToolCalls(
				[
					"<write_to_file>",
					"<path>C:/Users/R3LiC/Desktop/pi-plegma/.pi/extensions/plegma/package.json</path>",
					`<content>${jsonContent}</content>`,
					"</write_to_file>",
				].join("\n"),
				[tool("write")],
			);

			expect(parsed.toolCalls).toEqual([
				{
					name: "write",
					arguments: {
						path: "C:/Users/R3LiC/Desktop/pi-plegma/.pi/extensions/plegma/package.json",
						content: jsonContent,
					},
				},
			]);
		});

		it("maps Cline replace_in_file XML to Pi edit tool calls", () => {
			const parsed = __test__.parseXmlToolCalls(
				[
					"<replace_in_file>",
					"<path>src/example.ts</path>",
					"<diff>",
					"------- SEARCH",
					"const value = 1;",
					"=======",
					"const value = 2;",
					"+++++++ REPLACE",
					"</diff>",
					"</replace_in_file>",
				].join("\n"),
				[tool("edit")],
			);

			expect(parsed.toolCalls).toEqual([
				{
					name: "edit",
					arguments: {
						path: "src/example.ts",
						edits: [
							{ oldText: "const value = 1;", newText: "const value = 2;" },
						],
					},
				},
			]);
		});

		it("maps multi-block Cline replace_in_file XML to one Pi edit call", () => {
			const parsed = __test__.parseXmlToolCalls(
				[
					"<replace_in_file>",
					"<path>src/example.ts</path>",
					"<diff>",
					"------- SEARCH",
					"const first = 1;",
					"=======",
					"const first = 2;",
					"+++++++ REPLACE",
					"------- SEARCH",
					"const second = 1;",
					"=======",
					"const second = 2;",
					"+++++++ REPLACE",
					"</diff>",
					"</replace_in_file>",
				].join("\n"),
				[tool("edit")],
			);

			expect(parsed.toolCalls).toEqual([
				{
					name: "edit",
					arguments: {
						path: "src/example.ts",
						edits: [
							{ oldText: "const first = 1;", newText: "const first = 2;" },
							{ oldText: "const second = 1;", newText: "const second = 2;" },
						],
					},
				},
			]);
		});

		it("maps Cline list_files to a safe bash-backed command", () => {
			const parsed = __test__.parseXmlToolCalls(
				"<list_files>\n<path>src</path>\n<recursive>true</recursive>\n</list_files>",
				[tool("bash")],
			);

			expect(parsed.toolCalls).toEqual([
				{ name: "bash", arguments: { command: "find 'src' | sort" } },
			]);
		});

		it("maps Cline search_files to ripgrep through bash", () => {
			const parsed = __test__.parseXmlToolCalls(
				[
					"<search_files>",
					"<path>.</path>",
					"<regex>streamClineXml</regex>",
					"<file_pattern>*.ts</file_pattern>",
					"</search_files>",
				].join("\n"),
				[tool("bash")],
			);

			expect(parsed.toolCalls).toEqual([
				{
					name: "bash",
					arguments: {
						command:
							"rg -n --no-heading --color never -g '*.ts' -e 'streamClineXml' '.'",
					},
				},
			]);
		});

		it("maps Cline list_code_definition_names to ripgrep through bash", () => {
			const parsed = __test__.parseXmlToolCalls(
				"<list_code_definition_names>\n<path>providers</path>\n</list_code_definition_names>",
				[tool("bash")],
			);

			expect(parsed.toolCalls[0]?.name).toBe("bash");
			expect(parsed.toolCalls[0]?.arguments.command).toContain("rg -n");
			expect(parsed.toolCalls[0]?.arguments.command).toContain("'providers'");
		});
	});

	describe("streamClineXml", () => {
		it("retries MiMo generic stream errors once without include_reasoning", async () => {
			const fetchMock = vi
				.spyOn(globalThis, "fetch")
				.mockResolvedValueOnce(
					sseResponse([
						{
							error: {
								code: "error",
								message: "Stream error occurred",
							},
						},
					]),
				)
				.mockResolvedValueOnce(
					sseResponse([
						{
							choices: [
								{
									delta: { content: "Recovered without reasoning" },
									finish_reason: "stop",
								},
							],
						},
					]),
				);

			const stream = streamClineXml(
				clineModel(),
				clineContext(),
				{ apiKey: "token" },
				{},
			);
			const result = await stream.result();

			expect(fetchMock).toHaveBeenCalledTimes(2);
			expect(requestBody(fetchMock, 0).include_reasoning).toBe(true);
			expect(requestBody(fetchMock, 1)).not.toHaveProperty("include_reasoning");
			expect(result.stopReason).toBe("stop");
			expect(result.content).toContainEqual({
				type: "text",
				text: "Recovered without reasoning",
			});
		});

		it("returns an error instead of a blank stop when Cline streams no content", async () => {
			vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(sseResponse([]));

			const stream = streamClineXml(
				clineModel(),
				clineContext(),
				{ apiKey: "token" },
				{},
			);
			const result = await stream.result();

			expect(result.stopReason).toBe("error");
			expect(result.errorMessage).toBe("Cline returned empty response");
			expect(result.content).toEqual([]);
		});
	});

	describe("isRetryableClineReasoningStreamError", () => {
		it("retries generic Cline stream errors without reasoning", () => {
			expect(
				__test__.isRetryableClineReasoningStreamError(
					new Error("error: Stream error occurred"),
				),
			).toBe(true);
		});

		it("does not retry quota or auth errors", () => {
			expect(
				__test__.isRetryableClineReasoningStreamError(
					new Error("Cline API error 429: Daily free limit reached"),
				),
			).toBe(false);
		});
	});

	describe("prepareClineXmlOutput", () => {
		it("returns a visible fallback for reasoning-only Cline responses instead of blank stopping", () => {
			const reasoning =
				"Yes — that UX matches. Keep `/toggle-plegma` as the simple activation switch.";
			const output = __test__.prepareClineXmlOutput("", [], [reasoning], []);

			expect(output.visibleText).toContain(
				"Cline returned internal reasoning only",
			);
			expect(output.thinkingText).toBe(reasoning);
			expect(output.toolCalls).toEqual([]);
		});

		it("does not surface internal planning from reasoning-only Cline responses", () => {
			const internal =
				"The user is prompting me to continue. Let me respond with my thoughts on this UX design.";
			const output = __test__.prepareClineXmlOutput("", [], [internal], []);

			expect(output.visibleText).toContain(
				"Cline returned internal reasoning only",
			);
			expect(output.thinkingText).toBe(internal);
			expect(output.toolCalls).toEqual([]);
		});

		it("keeps reasoning hidden when visible text is present", () => {
			const output = __test__.prepareClineXmlOutput(
				"Visible answer",
				[],
				["Private plan"],
				[],
			);

			expect(output).toEqual({
				visibleText: "Visible answer",
				thinkingText: "Private plan",
				toolCalls: [],
			});
		});

		it("keeps reasoning hidden when tool calls are present", () => {
			const toolCalls = [{ name: "read", arguments: { path: "README.md" } }];
			const output = __test__.prepareClineXmlOutput(
				"",
				[],
				["I should inspect the file."],
				toolCalls,
			);

			expect(output).toEqual({
				visibleText: "",
				thinkingText: "I should inspect the file.",
				toolCalls,
			});
		});
	});

	describe("normalizeDecoratedXmlTags", () => {
		it("strips Unicode math-italic prefixes from MiMo/Cline thinking tags", () => {
			const input =
				"<\u{1D41A}\u{1D42C}\u{1D429}\u{1D428}\u{1D427}:thinking>\nLet me read the file.\n</\u{1D41A}\u{1D42C}\u{1D429}\u{1D428}\u{1D427}:thinking>";
			const result = __test__.normalizeDecoratedXmlTags(input);
			expect(result).toContain("<thinking>");
			expect(result).toContain("</thinking>");
			expect(result).not.toContain("\u{1D41A}");
		});

		it("strips Unicode math-italic prefixes from MiMo/Cline tool tags", () => {
			const input =
				"<\u{1D41A}\u{1D42C}\u{1D429}\u{1D428}\u{1D427}:read_file>\n<path>README.md</path>\n</\u{1D41A}\u{1D42C}\u{1D429}\u{1D428}\u{1D427}:read_file>";
			const result = __test__.normalizeDecoratedXmlTags(input);
			expect(result).toContain("<read_file>");
			expect(result).toContain("</read_file>");
			expect(result).not.toContain("\u{1D41A}");
		});

		it("leaves normal ASCII XML tags unchanged", () => {
			const input =
				"<thinking>\nLet me read the file.\n</thinking>\n<read_file>\n<path>README.md</path>\n</read_file>";
			expect(__test__.normalizeDecoratedXmlTags(input)).toBe(input);
		});

		it("handles mixed decorated and plain tags", () => {
			const input =
				"<\u{1D41A}\u{1D42C}\u{1D429}\u{1D428}\u{1D427}:thinking>plan</\u{1D41A}\u{1D42C}\u{1D429}\u{1D428}\u{1D427}:thinking>\n<read_file>\n<path>x</path>\n</read_file>";
			const result = __test__.normalizeDecoratedXmlTags(input);
			expect(result).toContain("<thinking>");
			expect(result).toContain("<read_file>");
			expect(result).not.toContain("\u{1D41A}");
		});
	});

	describe("extractFunctionTagToolCalls", () => {
		it("parses <function=name> Pi SDK format directly to tool calls", () => {
			const input =
				'<function=read_file>\n<param name="path">README.md</param>\n</function>';
			const result = __test__.extractFunctionTagToolCalls(input, new Map());
			expect(result.toolCalls).toHaveLength(1);
			expect(result.toolCalls[0].name).toBe("read_file");
			expect(result.toolCalls[0].arguments).toEqual({ path: "README.md" });
			expect(result.text).toBe("");
		});

		it("parses multiple <function=name> blocks", () => {
			const input =
				'<function=read_file>\n<param name="path">a.txt</param>\n</function>\n<function=write_to_file>\n<param name="path">b.txt</param>\n<param name="content">hello</param>\n</function>';
			const result = __test__.extractFunctionTagToolCalls(input, new Map());
			expect(result.toolCalls).toHaveLength(2);
			expect(result.toolCalls[0].name).toBe("read_file");
			expect(result.toolCalls[0].arguments).toEqual({ path: "a.txt" });
			expect(result.toolCalls[1].name).toBe("write_to_file");
			expect(result.toolCalls[1].arguments).toEqual({ path: "b.txt", content: "hello" });
		});

		it("preserves surrounding text", () => {
			const input = "Let me read the file.\n<function=read_file>\n<param name=\"path\">x.txt</param>\n</function>\nDone.";
			const result = __test__.extractFunctionTagToolCalls(input, new Map());
			expect(result.toolCalls).toHaveLength(1);
			expect(result.text).toContain("Let me read the file.");
			expect(result.text).toContain("Done.");
		});

		it("leaves normal Cline XML untouched", () => {
			const input = "<read_file>\n<path>README.md</path>\n</read_file>";
			const result = __test__.extractFunctionTagToolCalls(input, new Map());
			expect(result.toolCalls).toHaveLength(0);
			expect(result.text).toContain("<read_file>");
		});
	});

	describe("buildClineXmlMessages", () => {
		it("advertises Pi edit as Cline replace_in_file with SEARCH/REPLACE format", () => {
			const messages = __test__.buildClineXmlMessages({
				systemPrompt: "system",
				tools: [tool("edit")],
				messages: [
					{
						role: "user",
						content: [{ type: "text", text: "edit file" }],
						timestamp: Date.now(),
					},
				],
			});

			expect(messages[0]?.content).toContain("Tool: replace_in_file");
			expect(messages[0]?.content).toContain("<diff>");
			expect(messages[0]?.content).toContain("------- SEARCH");
			expect(messages[0]?.content).toContain("+++++++ REPLACE");
		});

		it("serializes previous Pi edit calls back to Cline replace_in_file XML", () => {
			const messages = __test__.buildClineXmlMessages({
				systemPrompt: "system",
				tools: [tool("edit")],
				messages: [
					{
						role: "user",
						content: [{ type: "text", text: "edit file" }],
						timestamp: Date.now(),
					},
					{
						role: "assistant",
						api: "cline-xml-tools",
						provider: "cline",
						model: "mimo",
						usage: {
							input: 0,
							output: 0,
							cacheRead: 0,
							cacheWrite: 0,
							totalTokens: 0,
							cost: {
								input: 0,
								output: 0,
								cacheRead: 0,
								cacheWrite: 0,
								total: 0,
							},
						},
						stopReason: "toolUse",
						timestamp: Date.now(),
						content: [
							{
								type: "toolCall",
								id: "call_1",
								name: "edit",
								arguments: {
									path: "src/example.ts",
									edits: [
										{
											oldText: "const value = 1;",
											newText: "const value = 2;",
										},
									],
								},
							},
						],
					},
				],
			});

			expect(messages[2]?.content).toContain("<replace_in_file>");
			expect(messages[2]?.content).toContain("<path>src/example.ts</path>");
			expect(messages[2]?.content).toContain("------- SEARCH");
			expect(messages[2]?.content).toContain("const value = 1;");
			expect(messages[2]?.content).toContain("const value = 2;");
		});

		it("serializes previous Pi bash calls back to Cline execute_command XML", () => {
			const messages = __test__.buildClineXmlMessages({
				systemPrompt: "system",
				tools: [tool("bash")],
				messages: [
					{
						role: "user",
						content: [{ type: "text", text: "run tests" }],
						timestamp: Date.now(),
					},
					{
						role: "assistant",
						api: "cline-xml-tools",
						provider: "cline",
						model: "mimo",
						usage: {
							input: 0,
							output: 0,
							cacheRead: 0,
							cacheWrite: 0,
							totalTokens: 0,
							cost: {
								input: 0,
								output: 0,
								cacheRead: 0,
								cacheWrite: 0,
								total: 0,
							},
						},
						stopReason: "toolUse",
						timestamp: Date.now(),
						content: [
							{
								type: "toolCall",
								id: "call_1",
								name: "bash",
								arguments: { command: "npm test" },
							},
						],
					},
				],
			});

			expect(messages[2]?.content).toContain("<execute_command>");
			expect(messages[2]?.content).toContain("<command>npm test</command>");
		});
	});
});
