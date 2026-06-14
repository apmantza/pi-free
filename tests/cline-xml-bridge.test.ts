import type { Tool } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { __test__ } from "../providers/cline/cline-xml-bridge.ts";

function tool(name: string): Tool {
	return {
		name,
		description: `${name} tool`,
		parameters: { type: "object", properties: {} } as Tool["parameters"],
	};
}

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
