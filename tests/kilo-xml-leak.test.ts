import { describe, expect, it } from "vitest";

// Test the XML detection and parsing helpers used in kilo.ts.
// These detect when models output raw XML tool calls instead of using
// native function calling, and parse them into proper tool call arguments.

function detectXmlToolLeak(text: string): boolean {
	const lower = text.toLowerCase();
	return (
		lower.includes("<tool>") ||
		lower.includes("<tool_call>") ||
		lower.includes("<function_call>") ||
		lower.includes("<invoke") ||
		lower.includes("<antml:tool_use>")
	);
}

function findTag(
	text: string,
	tag: string,
	start = 0,
): { start: number; end: number; content: string } | null {
	const open = `<${tag}>`;
	const close = `</${tag}>`;
	const openIdx = text.indexOf(open, start);
	if (openIdx === -1) return null;
	const contentStart = openIdx + open.length;
	const closeIdx = text.indexOf(close, contentStart);
	if (closeIdx === -1) return null;
	return {
		start: openIdx,
		end: closeIdx + close.length,
		content: text.slice(contentStart, closeIdx),
	};
}

function parseXmlToolCalls(
	text: string,
): Array<{ name: string; arguments: Record<string, unknown> }> | null {
	try {
		const calls: Array<{ name: string; arguments: Record<string, unknown> }> =
			[];
		let searchStart = 0;
		while (true) {
			const toolBlock = findTag(text, "tool", searchStart);
			if (!toolBlock) break;
			searchStart = toolBlock.end;

			const nameTag = findTag(toolBlock.content, "name");
			if (!nameTag) continue;
			const name = nameTag.content.trim();
			if (!name) continue;

			const args: Record<string, unknown> = {};
			// Skip the <name>...</name> block we already consumed.
			let paramStart = nameTag.end;
			const paramsText = toolBlock.content;
			while (true) {
				const openIdx = paramsText.indexOf("<", paramStart);
				if (openIdx === -1) break;
				const closeOpenIdx = paramsText.indexOf(">", openIdx);
				if (closeOpenIdx === -1) break;
				const tagName = paramsText.slice(openIdx + 1, closeOpenIdx).trim();
				if (!tagName || tagName.startsWith("/")) {
					paramStart = closeOpenIdx + 1;
					continue;
				}
				const closeTag = `</${tagName}>`;
				const closeIdx = paramsText.indexOf(closeTag, closeOpenIdx + 1);
				if (closeIdx === -1) break;
				const value = paramsText.slice(closeOpenIdx + 1, closeIdx).trim();
				try {
					args[tagName] = JSON.parse(value);
				} catch {
					args[tagName] = value;
				}
				paramStart = closeIdx + closeTag.length;
			}
			calls.push({ name, arguments: args });
		}
		return calls.length > 0 ? calls : null;
	} catch {
		return null;
	}
}

describe("Kilo XML tool leak detection", () => {
	it("detects standard tool XML pattern", () => {
		const lines = [
			"<tool>",
			"  <name>read_file</name>",
			"  <path>src/index.ts</path>",
			"</tool>",
		];
		expect(detectXmlToolLeak(lines.join("\n"))).toBe(true);
	});

	it("detects tool_call pattern", () => {
		const text = "<tool_call>  <name>read_file</name>  </tool_call>";
		expect(detectXmlToolLeak(text)).toBe(true);
	});

	it("detects function_call pattern", () => {
		const text = "<function_call>  <name>read_file</name>  </function_call>";
		expect(detectXmlToolLeak(text)).toBe(true);
	});

	it("detects invoke pattern", () => {
		const text = '<invoke name="search_files">';
		expect(detectXmlToolLeak(text)).toBe(true);
	});

	it("detects antml tool_use pattern", () => {
		const lines = [
			"<antml:tool_use>",
			"  <name>read_file</name>",
			"  <input>{}</input>",
			"</antml:tool_use>",
		];
		expect(detectXmlToolLeak(lines.join("\n"))).toBe(true);
	});

	it("does not detect normal text as XML leak", () => {
		const text = "I'll read the file to understand the codebase structure.";
		expect(detectXmlToolLeak(text)).toBe(false);
	});

	it("does not detect JSON tool calls as XML leak", () => {
		const obj = {
			tool_calls: [
				{ id: "call_123", type: "function", function: { name: "read_file" } },
			],
		};
		expect(detectXmlToolLeak(JSON.stringify(obj))).toBe(false);
	});

	it("detects XML leak mixed with normal text", () => {
		const lines = [
			"I'll read the file now.",
			"",
			"<tool>",
			"  <name>read_file</name>",
			"  <path>src/index.ts</path>",
			"</tool>",
			"",
			"Here's what I found:",
		];
		expect(detectXmlToolLeak(lines.join("\n"))).toBe(true);
	});
});

describe("Kilo XML tool call parsing", () => {
	it("parses single tool call", () => {
		const lines = [
			"<tool>",
			"  <name>read_file</name>",
			"  <path>src/index.ts</path>",
			"</tool>",
		];
		const result = parseXmlToolCalls(lines.join("\n"));
		expect(result).toEqual([
			{ name: "read_file", arguments: { path: "src/index.ts" } },
		]);
	});

	it("parses multiple tool calls", () => {
		const lines = [
			"<tool>",
			"  <name>read_file</name>",
			"  <path>src/index.ts</path>",
			"</tool>",
			"",
			"<tool>",
			"  <name>write_to_file</name>",
			"  <path>src/utils.ts</path>",
			'  <content>export const foo = "bar";</content>',
			"</tool>",
		];
		const result = parseXmlToolCalls(lines.join("\n"));
		expect(result).toEqual([
			{ name: "read_file", arguments: { path: "src/index.ts" } },
			{
				name: "write_to_file",
				arguments: {
					path: "src/utils.ts",
					content: 'export const foo = "bar";',
				},
			},
		]);
	});

	it("parses JSON arguments", () => {
		const lines = [
			"<tool>",
			"  <name>search_files</name>",
			'  <query>{"pattern": "*.ts"}</query>',
			"</tool>",
		];
		const result = parseXmlToolCalls(lines.join("\n"));
		expect(result).toEqual([
			{ name: "search_files", arguments: { query: { pattern: "*.ts" } } },
		]);
	});

	it("returns null for text without tool calls", () => {
		expect(parseXmlToolCalls("This is just regular text.")).toBeNull();
	});

	it("handles malformed XML gracefully", () => {
		const lines = [
			"<tool>",
			"  <name>read_file</name>",
			"  <path>src/index.ts",
			"</tool>",
		];
		// Parser is lenient: name is parsed, malformed param is skipped.
		expect(parseXmlToolCalls(lines.join("\n"))).toEqual([
			{ name: "read_file", arguments: {} },
		]);
	});

	it("returns null when no complete tool block exists", () => {
		const lines = ["<tool>", "  <path>src/index.ts</path>", "</tool>"];
		// No <name> tag, so no valid tool call is produced.
		expect(parseXmlToolCalls(lines.join("\n"))).toBeNull();
	});

	it("does not throw on deeply nested XML-like content", () => {
		const lines = [
			"<tool>",
			"  <name>write_to_file</name>",
			"  <path>test.ts</path>",
			"  <content>function hello() { return \"<div>Hello</div>\"; }</content>",
			"</tool>",
		];
		expect(() => parseXmlToolCalls(lines.join("\n"))).not.toThrow();
	});
});
