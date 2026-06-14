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
