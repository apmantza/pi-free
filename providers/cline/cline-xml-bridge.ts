import type {
	AssistantMessage,
	Context,
	Message,
	Model,
	SimpleStreamOptions,
	Tool,
	ToolCall,
	ToolResultMessage,
	Usage,
} from "@earendil-works/pi-ai/compat";
import { createAssistantMessageEventStream } from "../../lib/assistant-message-event-stream.ts";
import { createLogger } from "../../lib/logger.ts";
import { BASE_URL_CLINE, PROVIDER_CLINE } from "../../constants.ts";

const _logger = createLogger("cline-xml-bridge");

const DEFAULT_USAGE: Usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

type ClineToolCall = {
	id: string;
	name: string;
	arguments: Record<string, unknown>;
};

type ClineXmlChatMessage = {
	role: "assistant" | "system" | "user";
	content: string | Array<{ type: "text"; text: string }>;
};

type ClineToolDefinition = {
	type: "function";
	function: {
		name: string;
		description: string;
		parameters: unknown;
	};
};

type ClineXmlChunk = {
	error?: { message?: string; code?: string };
	usage?: {
		prompt_tokens?: number;
		completion_tokens?: number;
		total_tokens?: number;
	};
	choices?: Array<{
		delta?: {
			content?: string | null;
			reasoning?: string | null;
			tool_calls?: Array<{
				index?: number;
				id?: string;
				function?: { name?: string; arguments?: string };
			}>;
			function_call?: { name?: string; arguments?: string };
		};
		finish_reason?: string | null;
		error?: { message?: string; code?: string };
	}>;
};

function normalizeApiModelId(modelId: string): string {
	return modelId.startsWith(`${PROVIDER_CLINE}/`)
		? modelId.slice(`${PROVIDER_CLINE}/`.length)
		: modelId;
}

/**
 * Some MiMo/Cline models emit XML tags wrapped in Unicode math-italic
 * characters that spell out "anthml:" before the real tag name:
 *   <𝑎𝑛𝑡𝑚𝑙:thinking>...</𝑎𝑛𝑡𝑚𝑙:thinking>
 *   <𝑎𝑛𝑡𝑚𝑙:read_file>...</𝑎𝑛𝑡𝑚𝑙:read_file>
 *
 * This function strips the Unicode-decorated prefix so the rest of the
 * parser sees standard ASCII XML tags.
 */
function normalizeDecoratedXmlTags(text: string): string {
	const parts: string[] = [];
	let cursor = 0;

	while (cursor < text.length) {
		const ltIndex = text.indexOf("<", cursor);
		if (ltIndex === -1) {
			parts.push(text.slice(cursor));
			break;
		}

		parts.push(text.slice(cursor, ltIndex));
		let contentStart = ltIndex + 1;
		let prefix = "<";

		// Handle closing tags: </𝑎𝑛𝑡𝑚𝑙:thinking> → </thinking>
		if (contentStart < text.length && text[contentStart] === "/") {
			prefix = "</";
			contentStart += 1;
		}

		const gtIndex = text.indexOf(">", contentStart);
		const colonIndex = text.indexOf(":", contentStart);
		const spaceIndex = text.indexOf(" ", contentStart);
		if (
			colonIndex === -1 ||
			colonIndex === contentStart ||
			(gtIndex !== -1 && colonIndex > gtIndex) ||
			(spaceIndex !== -1 && spaceIndex < colonIndex)
		) {
			parts.push(prefix);
			cursor = contentStart;
			continue;
		}

		// Strip non-ASCII bytes between prefix and : to undo Unicode-decorated
		// prefixes like <𝑎𝑛𝑡𝑚𝑙:thinking> → <thinking>.
		let hasNonAscii = false;
		for (let i = contentStart; i < colonIndex; i++) {
			if (text.charCodeAt(i) > 127) {
				hasNonAscii = true;
				break;
			}
		}

		if (hasNonAscii) {
			parts.push(prefix);
			cursor = colonIndex + 1;
		} else {
			// No decorated prefix - emit < and re-include everything after it
			parts.push("<");
			cursor = ltIndex + 1;
		}
	}

	return parts.join("");
}

function xmlEscape(value: unknown): string {
	return String(value)
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}

function decodeXmlEntities(value: string): string {
	return value
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replaceAll("&quot;", '"')
		.replaceAll("&#39;", "'")
		.replaceAll("&amp;", "&");
}

function contentToText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part) => {
			if (part?.type === "text" && typeof part.text === "string") {
				return part.text;
			}
			if (part?.type === "image")
				return `[image:${part.mimeType ?? "unknown"}]`;
			return "";
		})
		.filter(Boolean)
		.join("\n");
}

function toolResultToText(message: ToolResultMessage): string {
	return message.content.map((part) => contentToText([part])).join("\n");
}

type ToolBridge = {
	remoteName: string;
	runtimeName: string;
	description?: string;
	parameters: string[];
	toRuntimeArgs(args: Record<string, unknown>): Record<string, unknown>;
	fromRuntimeArgs(args: Record<string, unknown>): Record<string, unknown>;
};

const CORE_CLINE_TOOL_NAMES = [
	"read_file",
	"write_to_file",
	"replace_in_file",
	"execute_command",
	"list_files",
	"search_files",
	"list_code_definition_names",
] as const;

function stringArg(args: Record<string, unknown>, key: string): string {
	const value = args[key];
	if (typeof value === "string") return value;
	if (value == null) return "";
	return String(value);
}

function booleanArg(args: Record<string, unknown>, key: string): boolean {
	return String(args[key]).toLowerCase() === "true";
}

function shellQuote(value: string): string {
	const escaped = value.replaceAll("'", `'"'"'`);
	return `'${escaped}'`;
}

function buildListFilesCommand(args: Record<string, unknown>): string {
	const path = shellQuote(stringArg(args, "path") || ".");
	return booleanArg(args, "recursive")
		? `find ${path} | sort`
		: `find ${path} -mindepth 1 -maxdepth 1 | sort`;
}

function buildSearchFilesCommand(args: Record<string, unknown>): string {
	const path = shellQuote(stringArg(args, "path") || ".");
	const regex = shellQuote(stringArg(args, "regex"));
	const filePattern = stringArg(args, "file_pattern");
	return [
		"rg",
		"-n",
		"--no-heading",
		"--color",
		"never",
		filePattern ? `-g ${shellQuote(filePattern)}` : "",
		`-e ${regex}`,
		path,
	]
		.filter(Boolean)
		.join(" ");
}

function buildSearchReplaceDiff(
	edits: Array<{ oldText: string; newText: string }>,
): string {
	return edits
		.map((edit) =>
			[
				"------- SEARCH",
				edit.oldText,
				"=======",
				edit.newText,
				"+++++++ REPLACE",
			].join("\n"),
		)
		.join("\n");
}

function parseSearchReplaceBlocks(
	diff: string,
): Array<{ oldText: string; newText: string }> {
	const edits: Array<{ oldText: string; newText: string }> = [];
	const lines = diff.replaceAll("\r\n", "\n").split("\n");
	const markerIndents = lines
		.filter((line) =>
			/^(?:\s*)(?:------- SEARCH|=======|\+{7} REPLACE)\s*$/.test(line),
		)
		.map((line) => line.length - line.trimStart().length)
		.filter((indent) => indent > 0);
	const commonIndent =
		markerIndents.length > 0 ? Math.min(...markerIndents) : 0;
	const normalized = lines
		.map((line) => {
			const indent = line.length - line.trimStart().length;
			return commonIndent > 0 && indent >= commonIndent
				? line.slice(commonIndent)
				: line;
		})
		.join("\n");
	let cursor = 0;

	while (cursor < normalized.length) {
		const searchMarker = "------- SEARCH\n";
		const replaceMarker = "\n=======\n";
		const endMarker = "\n+++++++ REPLACE";
		const searchStart = normalized.indexOf(searchMarker, cursor);
		if (searchStart === -1) break;
		const oldTextStart = searchStart + searchMarker.length;
		const replaceStart = normalized.indexOf(replaceMarker, oldTextStart);
		if (replaceStart === -1) break;
		const newTextStart = replaceStart + replaceMarker.length;
		const endStart = normalized.indexOf(endMarker, newTextStart);
		if (endStart === -1) break;
		edits.push({
			oldText: normalized.slice(oldTextStart, replaceStart),
			newText: normalized.slice(newTextStart, endStart),
		});
		cursor = endStart + endMarker.length;
	}

	return edits;
}

function buildListCodeDefinitionNamesCommand(
	args: Record<string, unknown>,
): string {
	const path = shellQuote(stringArg(args, "path") || ".");
	const globArgs = [
		"-g '*.ts'",
		"-g '*.tsx'",
		"-g '*.js'",
		"-g '*.jsx'",
		"-g '*.mjs'",
		"-g '*.cjs'",
		"-g '*.py'",
		"-g '*.go'",
		"-g '*.rs'",
		"-g '*.java'",
		"-g '*.kt'",
		"-g '*.swift'",
	].join(" ");
	const regex =
		"^(export\\s+)?(async\\s+function|function|class|interface|type|enum)\\s+[A-Za-z_][A-Za-z0-9_]*|^(export\\s+)?const\\s+[A-Za-z_][A-Za-z0-9_]*\\s*=\\s*(async\\s*)?\\(";
	return [
		"rg",
		"-n",
		"--no-heading",
		"--color",
		"never",
		globArgs,
		`-e ${shellQuote(regex)}`,
		path,
	].join(" ");
}

function readFileBridge(tool?: Tool): ToolBridge {
	return {
		remoteName: "read_file",
		runtimeName: tool?.name === "read_file" ? "read_file" : "read",
		description: tool?.description ?? "Read a file from disk",
		parameters: ["path"],
		toRuntimeArgs: (args) => ({ path: stringArg(args, "path") }),
		fromRuntimeArgs: (args) => ({ path: args.path }),
	};
}

function writeToFileBridge(tool?: Tool): ToolBridge {
	return {
		remoteName: "write_to_file",
		runtimeName: tool?.name === "write_to_file" ? "write_to_file" : "write",
		description: tool?.description ?? "Write content to a file",
		parameters: ["path", "content"],
		toRuntimeArgs: (args) => ({
			path: stringArg(args, "path"),
			content: stringArg(args, "content"),
		}),
		fromRuntimeArgs: (args) => ({ path: args.path, content: args.content }),
	};
}

function replaceInFileBridge(tool?: Tool): ToolBridge {
	return {
		remoteName: "replace_in_file",
		runtimeName: tool?.name === "replace_in_file" ? "replace_in_file" : "edit",
		description:
			tool?.description ?? "Edit a file using Cline SEARCH/REPLACE blocks",
		parameters: ["path", "diff"],
		toRuntimeArgs: (args) => {
			// Pi native <edit> form sends <edits>[{oldText,newText},...]</edits>
			// as JSON. Cline <replace_in_file> form uses SEARCH/REPLACE <diff>.
			if (Array.isArray(args.edits)) {
				return {
					path: stringArg(args, "path"),
					edits: args.edits
						.map((edit) => ({
							oldText: stringArg(edit as Record<string, unknown>, "oldText"),
							newText: stringArg(edit as Record<string, unknown>, "newText"),
						}))
						.filter((edit) => edit.oldText || edit.newText),
				};
			}
			return {
				path: stringArg(args, "path"),
				edits: parseSearchReplaceBlocks(stringArg(args, "diff")),
			};
		},
		fromRuntimeArgs: (args) => {
			const edits = Array.isArray(args.edits)
				? args.edits
						.map((edit) => ({
							oldText: stringArg(edit as Record<string, unknown>, "oldText"),
							newText: stringArg(edit as Record<string, unknown>, "newText"),
						}))
						.filter((edit) => edit.oldText || edit.newText)
				: [
						{
							oldText: stringArg(args, "oldText"),
							newText: stringArg(args, "newText"),
						},
					].filter((edit) => edit.oldText || edit.newText);
			return {
				path: args.path,
				diff: buildSearchReplaceDiff(edits),
			};
		},
	};
}

function executeCommandBridge(tool?: Tool): ToolBridge {
	return {
		remoteName: "execute_command",
		runtimeName: tool?.name === "execute_command" ? "execute_command" : "bash",
		description: tool?.description ?? "Execute a shell command",
		parameters: ["command", "timeout"],
		toRuntimeArgs: (args) => ({
			command: stringArg(args, "command"),
			...(args.timeout !== undefined ? { timeout: Number(args.timeout) } : {}),
		}),
		fromRuntimeArgs: (args) => ({
			command: args.command,
			...(args.timeout !== undefined ? { timeout: args.timeout } : {}),
		}),
	};
}

type HeredocWriteCommand = {
	path: string;
	content: string;
};

function shellSplitLine(line: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let quote: '"' | "'" | undefined;

	for (let i = 0; i < line.length; i++) {
		const char = line[i];
		if (quote) {
			if (char === quote) {
				quote = undefined;
			} else {
				current += char;
			}
			continue;
		}
		if (char === '"' || char === "'") {
			quote = char;
			continue;
		}
		if (char === " " || char === "\t") {
			if (current) {
				tokens.push(current);
				current = "";
			}
			continue;
		}
		current += char;
	}

	if (current) tokens.push(current);
	return tokens;
}

function parseCatHeredocWriteCommand(
	command: string,
): HeredocWriteCommand | undefined {
	const normalized = command.replaceAll("\r\n", "\n").trim();
	const lines = normalized.split("\n");
	if (lines.length < 3) return undefined;

	const tokens = shellSplitLine(lines[0].trim());
	if (tokens[0] !== "cat") return undefined;
	const redirectIndex = tokens.indexOf(">");
	if (redirectIndex === -1) return undefined;
	const path = tokens[redirectIndex + 1];
	if (!path) return undefined;

	let delimiter = "";
	for (let i = redirectIndex + 2; i < tokens.length; i++) {
		const token = tokens[i];
		if (token === "<<") {
			delimiter = tokens[i + 1] ?? "";
			break;
		}
		if (token.startsWith("<<")) {
			delimiter = token.slice(2);
			break;
		}
	}
	if (!delimiter) return undefined;

	let delimiterLine = -1;
	for (let i = 1; i < lines.length; i++) {
		if (lines[i].trim() === delimiter) {
			delimiterLine = i;
			break;
		}
	}
	if (delimiterLine === -1) return undefined;

	const trailing = lines
		.slice(delimiterLine + 1)
		.join("\n")
		.trim();
	if (trailing) {
		const trailingLines = trailing.split("\n").filter((line) => line.trim());
		if (trailingLines.length !== 1) return undefined;
		const trailingTokens = shellSplitLine(trailingLines[0].trim());
		if (trailingTokens.length !== 2 || trailingTokens[0] !== "cat") {
			return undefined;
		}
		if (trailingTokens[1] !== path) return undefined;
	}

	return {
		path,
		content: lines.slice(1, delimiterLine).join("\n"),
	};
}

function getWriteRuntimeToolName(
	tools: Tool[] | undefined,
): string | undefined {
	if ((tools ?? []).some((tool) => tool.name === "write_to_file")) {
		return "write_to_file";
	}
	if ((tools ?? []).some((tool) => tool.name === "write")) return "write";
	return undefined;
}

function listFilesBridge(): ToolBridge {
	return {
		remoteName: "list_files",
		runtimeName: "bash",
		description: "List files in a directory",
		parameters: ["path", "recursive"],
		toRuntimeArgs: (args) => ({ command: buildListFilesCommand(args) }),
		fromRuntimeArgs: (args) => ({ command: args.command }),
	};
}

function searchFilesBridge(): ToolBridge {
	return {
		remoteName: "search_files",
		runtimeName: "bash",
		description: "Search files by regex",
		parameters: ["path", "regex", "file_pattern"],
		toRuntimeArgs: (args) => ({ command: buildSearchFilesCommand(args) }),
		fromRuntimeArgs: (args) => ({ command: args.command }),
	};
}

function listCodeDefinitionNamesBridge(): ToolBridge {
	return {
		remoteName: "list_code_definition_names",
		runtimeName: "bash",
		description: "List code definition names in source files",
		parameters: ["path"],
		toRuntimeArgs: (args) => ({
			command: buildListCodeDefinitionNamesCommand(args),
		}),
		fromRuntimeArgs: (args) => ({ command: args.command }),
	};
}

function getToolBridge(tool: Tool): ToolBridge {
	if (tool.name === "read" || tool.name === "read_file") {
		return readFileBridge(tool);
	}
	if (tool.name === "write" || tool.name === "write_to_file") {
		return writeToFileBridge(tool);
	}
	if (tool.name === "edit" || tool.name === "replace_in_file") {
		return replaceInFileBridge(tool);
	}
	if (tool.name === "bash" || tool.name === "execute_command") {
		return executeCommandBridge(tool);
	}
	const parameters = schemaProperties(tool);
	return {
		remoteName: tool.name,
		runtimeName: tool.name,
		description: tool.description,
		parameters,
		toRuntimeArgs: (args) => args,
		fromRuntimeArgs: (args) => args,
	};
}

function getToolBridges(tools: Tool[] | undefined): ToolBridge[] {
	const bridges: ToolBridge[] = [];
	for (const tool of tools ?? []) {
		bridges.push(getToolBridge(tool));
		if (tool.name === "bash" || tool.name === "execute_command") {
			bridges.push(
				listFilesBridge(),
				searchFilesBridge(),
				listCodeDefinitionNamesBridge(),
			);
		}
	}
	return bridges;
}

function getParseToolBridges(tools: Tool[] | undefined): ToolBridge[] {
	const bridges = getToolBridges(tools);
	const remoteNames = new Set(bridges.map((bridge) => bridge.remoteName));
	const toolsByName = new Map((tools ?? []).map((tool) => [tool.name, tool]));

	for (const remoteName of CORE_CLINE_TOOL_NAMES) {
		if (remoteNames.has(remoteName)) continue;
		if (remoteName === "read_file") {
			bridges.push(readFileBridge(toolsByName.get("read_file")));
		}
		if (remoteName === "write_to_file") {
			bridges.push(writeToFileBridge(toolsByName.get("write_to_file")));
		}
		if (remoteName === "replace_in_file") {
			bridges.push(replaceInFileBridge(toolsByName.get("replace_in_file")));
		}
		if (remoteName === "execute_command") {
			bridges.push(executeCommandBridge(toolsByName.get("execute_command")));
		}
		if (remoteName === "list_files") {
			bridges.push(listFilesBridge());
		}
		if (remoteName === "search_files") {
			bridges.push(searchFilesBridge());
		}
		if (remoteName === "list_code_definition_names") {
			bridges.push(listCodeDefinitionNamesBridge());
		}
	}

	return bridges;
}

function serializeXmlToolCall(
	name: string,
	args: Record<string, unknown>,
): string {
	const parts = [`<${name}>`];
	for (const [key, value] of Object.entries(args)) {
		const text = typeof value === "string" ? value : JSON.stringify(value);
		parts.push(`<${key}>${xmlEscape(text)}</${key}>`);
	}
	parts.push(`</${name}>`);
	return parts.join("\n");
}

function assistantMessageToText(
	message: Extract<Message, { role: "assistant" }>,
	tools: Tool[] | undefined,
): string {
	const bridgeByRuntimeName = new Map<string, ToolBridge>();
	for (const bridge of getToolBridges(tools)) {
		if (!bridgeByRuntimeName.has(bridge.runtimeName)) {
			bridgeByRuntimeName.set(bridge.runtimeName, bridge);
		}
	}
	return message.content
		.map((part) => {
			if (part.type === "text") return part.text;
			if (part.type === "thinking") {
				return `<thinking>\n${xmlEscape(part.thinking)}\n</thinking>`;
			}
			if (part.type === "toolCall") {
				const bridge = bridgeByRuntimeName.get(part.name);
				return serializeXmlToolCall(
					bridge?.remoteName ?? part.name,
					bridge?.fromRuntimeArgs(part.arguments) ?? part.arguments,
				);
			}
			return "";
		})
		.filter(Boolean)
		.join("\n\n");
}

function getCustomToolParameters(
	bridge: ToolBridge,
	tools: Tool[] | undefined,
): unknown {
	if (bridge.remoteName !== bridge.runtimeName) return undefined;
	return tools?.find((tool) => tool.name === bridge.remoteName)?.parameters;
}

function buildClineToolDefinitions(
	tools: Tool[] | undefined,
): ClineToolDefinition[] {
	const definitions: ClineToolDefinition[] = [];
	const seen = new Set<string>();
	for (const bridge of getToolBridges(tools)) {
		if (seen.has(bridge.remoteName)) continue;
		seen.add(bridge.remoteName);
		const customParameters = getCustomToolParameters(bridge, tools);
		const parameters =
			customParameters ??
			(bridge.remoteName === "replace_in_file"
				? {
						type: "object",
						properties: {
							path: { type: "string" },
							diff: { type: "string" },
						},
						required: ["path", "diff"],
					}
				: {
						type: "object",
						properties: Object.fromEntries(
							bridge.parameters.map((name) => [name, { type: "string" }]),
						),
						required: bridge.parameters,
					});
		definitions.push({
			type: "function",
			function: {
				name: bridge.remoteName,
				description: bridge.description ?? bridge.runtimeName,
				parameters,
			},
		});
	}
	return definitions;
}

function schemaProperties(tool: Tool): string[] {
	const parameters = tool.parameters as unknown as {
		properties?: Record<string, unknown>;
	};
	return Object.keys(parameters.properties ?? {});
}

function unwrapDsmlArgumentWrapper(
	args: Record<string, unknown>,
	bridge: ToolBridge | undefined,
): Record<string, unknown> {
	if (!bridge) return args;
	const wrapper = ["arguments", "input"].find(
		(name) => name in args && !bridge.parameters.includes(name),
	);
	if (!wrapper) return args;

	let inner = args[wrapper];
	if (typeof inner === "string") {
		try {
			inner = JSON.parse(inner) as unknown;
		} catch {
			return args;
		}
	}
	if (!inner || typeof inner !== "object" || Array.isArray(inner)) return args;

	const innerArgs = inner as Record<string, unknown>;
	const allowed = new Set(bridge.parameters);
	return Object.keys(innerArgs).every((key) => allowed.has(key))
		? innerArgs
		: args;
}

function buildToolInstructions(tools: Tool[] | undefined): string {
	const bridges = getToolBridges(tools);
	if (bridges.length === 0) return "";

	const sections = bridges.map((bridge) => {
		let params: string;
		if (bridge.remoteName === "replace_in_file") {
			params = [
				"  <path>path/to/file</path>",
				"  <diff>",
				"------- SEARCH",
				"exact text to replace",
				"=======",
				"new text",
				"+++++++ REPLACE",
				"  </diff>",
			].join("\n");
		} else if (bridge.parameters.length) {
			params = bridge.parameters
				.map((name) => `  <${name}>value</${name}>`)
				.join("\n");
		} else {
			params = "  <arguments>{}</arguments>";
		}
		return [
			`Tool: ${bridge.remoteName}`,
			`Description: ${bridge.description ?? bridge.runtimeName}`,
			"XML usage:",
			`<${bridge.remoteName}>`,
			params,
			`</${bridge.remoteName}>`,
		].join("\n");
	});

	return [
		"You have access to tools. Prefer a native tool call when available; XML tool calls are supported as a fallback.",
		"When you need a tool, call exactly one available tool. If using XML, output exactly one XML tool call using one of the tool names below.",
		"Do not wrap XML tool calls in markdown fences. Do not invent tool names.",
		"Available tools:",
		sections.join("\n\n"),
	].join("\n\n");
}

function buildClineXmlMessages(context: Context): ClineXmlChatMessage[] {
	const messages: ClineXmlChatMessage[] = [];
	const systemParts = [
		context.systemPrompt,
		buildToolInstructions(context.tools),
	]
		.filter(Boolean)
		.join("\n\n");
	if (systemParts) messages.push({ role: "system", content: systemParts });

	let firstUser = true;
	for (const message of context.messages) {
		if (message.role === "user") {
			const text = contentToText(message.content).trim();
			if (!text) continue;
			messages.push({
				role: "user",
				content: firstUser ? `<task>\n${text}\n</task>` : text,
			});
			firstUser = false;
			continue;
		}

		if (message.role === "assistant") {
			const text = assistantMessageToText(message, context.tools).trim();
			if (text) messages.push({ role: "assistant", content: text });
			continue;
		}

		if (message.role === "toolResult") {
			const text = toolResultToText(message).trim();
			const bridge = getToolBridges(context.tools).find(
				(candidate) => candidate.runtimeName === message.toolName,
			);
			messages.push({
				role: "user",
				content: `Tool result for ${bridge?.remoteName ?? message.toolName}:\n${text || "(no output)"}`,
			});
		}
	}

	return messages;
}

function findNextToolStart(
	text: string,
	toolNames: Set<string>,
	from: number,
): { index: number; name: string; openTag: string } | null {
	let best: { index: number; name: string; openTag: string } | null = null;
	for (const name of toolNames) {
		const openTag = `<${name}>`;
		const index = text.indexOf(openTag, from);
		if (index === -1) continue;
		if (!best || index < best.index) best = { index, name, openTag };
	}
	return best;
}

function isFenceOnlyText(text: string): boolean {
	const trimmed = text.trim().toLowerCase();
	return trimmed === "```" || trimmed === "```xml";
}

function pushTextFragment(textParts: string[], fragment: string): void {
	const trimmed = fragment.trim();
	if (!trimmed || isFenceOnlyText(trimmed)) return;
	textParts.push(trimmed);
}

type HiddenThoughtTag = {
	open: string;
	closes: string[];
};

const HIDDEN_THOUGHT_TAGS: HiddenThoughtTag[] = [
	{ open: "<thinking>", closes: ["</thinking>"] },
	// Some DeepSeek/Cline variants open with <think> but close with </thinking>.
	{ open: "<think>", closes: ["</think>", "</thinking>"] },
	// Compaction/summary artifacts can leak into Cline content as </summary>.
	{ open: "<summary>", closes: ["</summary>"] },
	// Cline may emit persistent issue-checking as hidden deliberation.
	{
		open: "<persistent_issue_checking>",
		closes: ["</persistent_issue_checking>"],
	},
];

const HIDDEN_THOUGHT_CLOSE_TAGS = Array.from(
	new Set(HIDDEN_THOUGHT_TAGS.flatMap((tag) => tag.closes)),
);

function findNextHiddenOpenTag(
	text: string,
	from: number,
): { index: number; tag: HiddenThoughtTag } | null {
	let best: { index: number; tag: HiddenThoughtTag } | null = null;
	for (const tag of HIDDEN_THOUGHT_TAGS) {
		const index = text.indexOf(tag.open, from);
		if (index === -1) continue;
		if (!best || index < best.index) best = { index, tag };
	}
	return best;
}

function findNextCloseTag(
	text: string,
	from: number,
	closeTags: string[],
): { index: number; tag: string } | null {
	let best: { index: number; tag: string } | null = null;
	for (const tag of closeTags) {
		const index = text.indexOf(tag, from);
		if (index === -1) continue;
		if (!best || index < best.index) best = { index, tag };
	}
	return best;
}

function extractThinkingXml(text: string): {
	text: string;
	thinking: string[];
} {
	const thinking: string[] = [];
	const parts: string[] = [];
	let cursor = 0;

	while (cursor < text.length) {
		const nextOpen = findNextHiddenOpenTag(text, cursor);
		const openStart = nextOpen?.index ?? -1;
		const nextClose = findNextCloseTag(text, cursor, HIDDEN_THOUGHT_CLOSE_TAGS);
		const closeStart = nextClose?.index ?? -1;

		if (nextClose && (openStart === -1 || closeStart < openStart)) {
			const danglingThinking = decodeXmlEntities(
				text.slice(cursor, closeStart).trim(),
			);
			if (danglingThinking) thinking.push(danglingThinking);
			cursor = closeStart + nextClose.tag.length;
			continue;
		}

		if (openStart === -1 || !nextOpen) break;
		parts.push(text.slice(cursor, openStart));
		const valueStart = openStart + nextOpen.tag.open.length;
		const nextValueClose = findNextCloseTag(
			text,
			valueStart,
			nextOpen.tag.closes,
		);
		if (!nextValueClose) {
			const value = decodeXmlEntities(text.slice(valueStart).trim());
			if (value) thinking.push(value);
			cursor = text.length;
			break;
		}

		const value = decodeXmlEntities(
			text.slice(valueStart, nextValueClose.index).trim(),
		);
		if (value) thinking.push(value);
		cursor = nextValueClose.index + nextValueClose.tag.length;
	}

	if (cursor === 0) {
		return { text, thinking };
	}
	parts.push(text.slice(cursor));
	return { text: parts.join(""), thinking };
}

function extractTagContent(text: string, tag: string): string | undefined {
	const open = `<${tag}>`;
	const close = `</${tag}>`;
	const start = text.indexOf(open);
	if (start === -1) return undefined;
	const valueStart = start + open.length;
	const end =
		tag === "content"
			? text.lastIndexOf(close)
			: text.indexOf(close, valueStart);
	if (end === -1 || end < valueStart) return undefined;
	return decodeXmlEntities(text.slice(valueStart, end).trim());
}

function parseToolArguments(
	block: string,
	preserveStringTags: ReadonlySet<string> = new Set(),
): Record<string, unknown> {
	const decodedBlock = decodeXmlEntities(block).trim();
	if (decodedBlock.startsWith("{") && decodedBlock.endsWith("}")) {
		try {
			const parsed = JSON.parse(decodedBlock);
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				return parsed as Record<string, unknown>;
			}
		} catch {
			return { arguments: decodedBlock };
		}
	}

	const explicitArgs = extractTagContent(block, "arguments");
	if (explicitArgs) {
		try {
			const parsed = JSON.parse(explicitArgs);
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				return parsed as Record<string, unknown>;
			}
		} catch {
			return { arguments: explicitArgs };
		}
	}

	const args: Record<string, unknown> = {};
	let cursor = 0;
	while (cursor < block.length) {
		const openStart = block.indexOf("<", cursor);
		if (openStart === -1) break;
		const openEnd = block.indexOf(">", openStart + 1);
		if (openEnd === -1) break;
		const tag = block.slice(openStart + 1, openEnd).trim();
		if (!tag || tag.startsWith("/") || tag.includes(" ")) {
			cursor = openEnd + 1;
			continue;
		}
		const close = `</${tag}>`;
		const closeStart =
			tag === "content" || preserveStringTags.has(tag)
				? block.lastIndexOf(close)
				: block.indexOf(close, openEnd + 1);
		if (closeStart === -1 || closeStart < openEnd) break;
		const raw = decodeXmlEntities(block.slice(openEnd + 1, closeStart).trim());
		// `content` and selected provider-specific fields are explicitly string
		// parameters (file bodies, SEARCH/REPLACE diffs). Parsing them as JSON
		// corrupts JSON file content into "[object Object]".
		const shouldParseJson = tag !== "content" && !preserveStringTags.has(tag);
		if (shouldParseJson) {
			try {
				args[tag] = JSON.parse(raw);
			} catch {
				args[tag] = raw;
			}
		} else {
			args[tag] = raw;
		}
		cursor = closeStart + close.length;
	}
	return args;
}

type ParsedToolCalls = {
	text: string;
	toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>;
};

/**
 * Normalize the DSML variant emitted by some Cline models:
 *
 *   <｜DSML｜tool-name><arg>value</arg></｜DSML｜tool-name>
 *
 * Only complete calls for tools available in the current Pi context are
 * normalized. In particular, an incomplete or unknown DSML fragment remains
 * ordinary assistant text instead of being mistaken for a tool call. The
 * pattern is static; tool names are checked against the current Pi context
 * after matching rather than interpolated into a regular expression.
 */
const DSML_TOOL_CALL_RE = /<｜DSML｜([^>\s]+)>([^]*?)<\/｜DSML｜\1>/g;
const DSML_INVOKE_RE =
	/<｜DSML｜invoke(?:\s+name=(?:"([^"]*)"|'([^']*)'))?[^>]*>([^]*?)<\/｜DSML｜invoke>/g;
const DSML_WRAPPER_RE =
	/<｜DSML｜(?:function_calls|tool_calls)>([^]*?)<\/｜DSML｜(?:function_calls|tool_calls)>/g;
const DSML_PARAMETER_RE =
	/<｜DSML｜parameter\s+name=(?:"([^"]*)"|'([^']*)')(?:\s+string=(?:"([^"]*)"|'([^']*)'))?[^>]*>([^]*?)<\/｜DSML｜parameter>/g;
const DSML_MALFORMED_PARAMETER_RE =
	/<([A-Za-z_][A-Za-z0-9_.-]*)>\s*([^]*?)<\/｜DSML｜parameter>/g;
const DSML_NAMED_FIELD_RE =
	/<｜DSML｜([A-Za-z_][A-Za-z0-9_.-]*)>([^]*?)<\/｜DSML｜\1>/g;
const DSML_NAMED_PARAMETER_RE =
	/<｜DSML｜([A-Za-z_][A-Za-z0-9_.-]*)>([^]*?)<\/｜DSML｜parameter>/g;

function parseMixedDsmlParameterXml(body: string): string | undefined {
	const parameters: string[] = [];
	let cursor = 0;

	while (cursor < body.length) {
		while (/\s/.test(body[cursor] ?? "")) cursor++;
		if (cursor >= body.length) break;

		const rest = body.slice(cursor);
		const dsmlOpener = rest.match(/^<｜DSML｜([A-Za-z_][A-Za-z0-9_.-]*)>/);
		const plainOpener = dsmlOpener
			? undefined
			: rest.match(/^<([A-Za-z_][A-Za-z0-9_.-]*)>/);
		const name = dsmlOpener?.[1] ?? plainOpener?.[1];
		const openerLength = dsmlOpener?.[0].length ?? plainOpener?.[0].length;
		if (!name || !openerLength) return undefined;

		const valueStart = cursor + openerLength;
		const closers = dsmlOpener
			? [`</｜DSML｜parameter>`, `</｜DSML｜${name}>`]
			: [`</${name}>`];
		let closeStart = -1;
		let closeLength = 0;
		for (const closer of closers) {
			const candidate = body.indexOf(closer, valueStart);
			if (candidate !== -1 && (closeStart === -1 || candidate < closeStart)) {
				closeStart = candidate;
				closeLength = closer.length;
			}
		}
		if (closeStart === -1) return undefined;

		parameters.push(
			`<${name}>${xmlEscape(decodeXmlEntities(body.slice(valueStart, closeStart).trim()))}</${name}>`,
		);
		cursor = closeStart + closeLength;
	}

	return parameters.length > 0 ? parameters.join("\n") : undefined;
}

function dsmlParameterXml(body: string): string | undefined {
	const parameters: string[] = [];
	let cursor = 0;
	let match: RegExpExecArray | null;

	DSML_PARAMETER_RE.lastIndex = 0;
	while ((match = DSML_PARAMETER_RE.exec(body)) !== null) {
		if (body.slice(cursor, match.index).trim()) return undefined;
		const name = match[1] ?? match[2];
		if (!name) return undefined;
		const stringFlag = match[3] ?? match[4];
		const value = decodeXmlEntities(match[5].trim());
		const encodedValue =
			stringFlag?.toLowerCase() === "true" ? JSON.stringify(value) : value;
		parameters.push(`<${name}>${xmlEscape(encodedValue)}</${name}>`);
		cursor = match.index + match[0].length;
	}
	if (parameters.length > 0) {
		return body.slice(cursor).trim() ? undefined : parameters.join("\n");
	}
	if (!body.trim()) return "";

	// DeepSeek-derived endpoints sometimes mix DSML-named fields closed by
	// `parameter` with ordinary XML fields in one invoke, e.g. `command` plus
	// `<timeout>600</timeout>`. Accept only a complete field sequence.
	const mixedFields = parseMixedDsmlParameterXml(body);
	if (mixedFields !== undefined) return mixedFields;

	// Some models wrap fields in DSML tags but close every field with the
	// generic `parameter` tag, for example:
	// `<｜DSML｜path>file</｜DSML｜parameter>`. Convert only a fully-consumed
	// field sequence; unknown or partial markup remains ordinary text.
	DSML_NAMED_PARAMETER_RE.lastIndex = 0;
	while ((match = DSML_NAMED_PARAMETER_RE.exec(body)) !== null) {
		if (body.slice(cursor, match.index).trim()) return undefined;
		parameters.push(
			`<${match[1]}>${xmlEscape(decodeXmlEntities(match[2].trim()))}</${match[1]}>`,
		);
		cursor = match.index + match[0].length;
	}
	if (parameters.length > 0) {
		return body.slice(cursor).trim() ? undefined : parameters.join("\n");
	}

	// Some models wrap fields in DSML tags instead of using the standard
	// `parameter name=...` form, for example:
	// `<｜DSML｜path>file</｜DSML｜path>`. Convert only a fully-consumed field
	// sequence; unknown or partial markup remains ordinary text.
	DSML_NAMED_FIELD_RE.lastIndex = 0;
	while ((match = DSML_NAMED_FIELD_RE.exec(body)) !== null) {
		if (body.slice(cursor, match.index).trim()) return undefined;
		parameters.push(
			`<${match[1]}>${xmlEscape(decodeXmlEntities(match[2].trim()))}</${match[1]}>`,
		);
		cursor = match.index + match[0].length;
	}
	if (parameters.length > 0) {
		return body.slice(cursor).trim() ? undefined : parameters.join("\n");
	}

	// Some models omit the parameter opener but retain its DSML closer, for
	// example `<path>file</｜DSML｜parameter>`. Recover this only when the
	// field name is a valid XML-style parameter name and the whole body is
	// consumed; unknown or partial markup remains ordinary text.
	DSML_MALFORMED_PARAMETER_RE.lastIndex = 0;
	while ((match = DSML_MALFORMED_PARAMETER_RE.exec(body)) !== null) {
		if (body.slice(cursor, match.index).trim()) return undefined;
		parameters.push(
			`<${match[1]}>${xmlEscape(decodeXmlEntities(match[2].trim()))}</${match[1]}>`,
		);
		cursor = match.index + match[0].length;
	}
	return parameters.length > 0 && !body.slice(cursor).trim()
		? parameters.join("\n")
		: undefined;
}

function normalizeDsmlInvoke(
	name: string | undefined,
	body: string,
	toolNames: ReadonlySet<string>,
): string | undefined {
	const resolvedName = name && decodeXmlEntities(name).trim();
	if (!resolvedName || !toolNames.has(resolvedName)) return undefined;
	const parameterXml = dsmlParameterXml(body);
	return parameterXml === undefined
		? undefined
		: `<${resolvedName}>${parameterXml}</${resolvedName}>`;
}

function normalizeDsmlToolCalls(
	text: string,
	toolNames: ReadonlySet<string>,
): string {
	if (toolNames.size === 0) return text;

	// DeepSeek DSML also has a wrapper/invoke dialect. Normalize only when all
	// calls are complete and refer to exact registered names.
	let normalized = text.replace(DSML_WRAPPER_RE, (match, body: string) => {
		const calls: string[] = [];
		let cursor = 0;
		let invokeMatch: RegExpExecArray | null;
		DSML_INVOKE_RE.lastIndex = 0;
		while ((invokeMatch = DSML_INVOKE_RE.exec(body)) !== null) {
			if (body.slice(cursor, invokeMatch.index).trim()) return match;
			const call = normalizeDsmlInvoke(
				invokeMatch[1] ?? invokeMatch[2],
				invokeMatch[3],
				toolNames,
			);
			if (!call) return match;
			calls.push(call);
			cursor = invokeMatch.index + invokeMatch[0].length;
		}
		return calls.length > 0 && !body.slice(cursor).trim()
			? calls.join("\n\n")
			: match;
	});

	// Accept an unwrapped invoke call as well.
	normalized = normalized.replace(
		DSML_INVOKE_RE,
		(match, quotedName, alternateName, body) =>
			normalizeDsmlInvoke(quotedName ?? alternateName, body, toolNames) ??
			match,
	);

	// Finally normalize the direct named form. The name is deliberately looked
	// up as-is; extension tools are plain registered Pi names, not MCP aliases.
	normalized = normalized.replace(
		DSML_TOOL_CALL_RE,
		(match, name: string, body: string) =>
			toolNames.has(name) ? `<${name}>${body}</${name}>` : match,
	);

	// Recover the observed mismatched form where a named call closes as invoke.
	const malformedDirectCallRe = /<｜DSML｜([^>\s]+)>([^]*?)<\/｜DSML｜invoke>/g;
	return normalized.replace(
		malformedDirectCallRe,
		(match, name: string, body: string) =>
			normalizeDsmlInvoke(name, body, toolNames) ?? match,
	);
}

/**
 * Some MiMo/Cline models emit Pi SDK `<function=name>` tool-call syntax
 * instead of Cline XML `<toolName>` syntax:
 *
 *   <function=read_file>
 *   <param name="path">README.md</param>
 *   </function>
 *
 * Parse these directly to Pi tool calls without going through Cline XML.
 */
function extractFunctionTagToolCalls(
	text: string,
	bridgeByRemoteName: Map<string, ToolBridge>,
): { text: string; toolCalls: ParsedToolCalls["toolCalls"] } {
	const FUNCTION_TAG_RE = /<function=([a-zA-Z0-9_-]+)>([\s\S]*?)<\/function>/g;
	const toolCalls: ParsedToolCalls["toolCalls"] = [];
	const parts: string[] = [];
	let cursor = 0;
	let match: RegExpExecArray | null;

	while ((match = FUNCTION_TAG_RE.exec(text)) !== null) {
		const [fullMatch, toolName, body] = match;
		pushTextFragment(parts, text.slice(cursor, match.index));

		// Parse <param name="x">val</param> directly to arguments
		const args: Record<string, unknown> = {};
		const PARAM_RE = /<param\s+name="([^"]*)">([\s\S]*?)<\/param>/g;
		let paramMatch: RegExpExecArray | null;
		while ((paramMatch = PARAM_RE.exec(body)) !== null) {
			args[paramMatch[1]] = paramMatch[2];
		}

		const bridge = bridgeByRemoteName.get(toolName);
		toolCalls.push({
			name: bridge?.runtimeName ?? toolName,
			arguments: bridge?.toRuntimeArgs(args) ?? args,
		});

		cursor = match.index + fullMatch.length;
	}

	pushTextFragment(parts, text.slice(cursor));
	return { text: parts.join("\n\n").trim(), toolCalls };
}

function parseXmlToolCalls(
	rawText: string,
	tools: Tool[] | undefined,
): ParsedToolCalls {
	const bridges = getParseToolBridges(tools);
	const bridgeByRemoteName = new Map(
		bridges.map((bridge) => [bridge.remoteName, bridge]),
	);
	// Some Cline/MiMo variants use the Pi runtime tool name (e.g. <edit>,
	// <write>) instead of the Cline XML name (<replace_in_file>, <write_to_file>).
	// Register runtime names as aliases so both forms are recognised.
	const bridgeByName = new Map(
		bridges.flatMap((bridge) => [
			[bridge.remoteName, bridge],
			[bridge.runtimeName, bridge],
		]),
	);
	const toolNames = new Set(bridgeByName.keys());

	const normalizedDsmlText = normalizeDsmlToolCalls(rawText, toolNames);

	// Extract <function=name> Pi SDK tool calls directly (no Cline XML intermediate)
	const fnResult = extractFunctionTagToolCalls(
		normalizedDsmlText,
		bridgeByRemoteName,
	);
	const textWithoutThinking = extractThinkingXml(fnResult.text).text;
	if (toolNames.size === 0) {
		return { text: textWithoutThinking.trim(), toolCalls: fnResult.toolCalls };
	}

	const sourceText = findNextToolStart(textWithoutThinking, toolNames, 0)
		? textWithoutThinking
		: decodeXmlEntities(textWithoutThinking);
	const textParts: string[] = [];
	const toolCalls: Array<{ name: string; arguments: Record<string, unknown> }> =
		[];
	let cursor = 0;

	while (cursor < sourceText.length) {
		const next = findNextToolStart(sourceText, toolNames, cursor);
		if (!next) break;
		const bridge = bridgeByName.get(next.name);
		const remoteName = bridge?.remoteName ?? next.name;
		const closeTag = `</${remoteName}>`;
		const closeStart = sourceText.indexOf(
			closeTag,
			next.index + next.openTag.length,
		);
		pushTextFragment(textParts, sourceText.slice(cursor, next.index));
		const blockEnd = closeStart === -1 ? sourceText.length : closeStart;
		const block = sourceText.slice(next.index + next.openTag.length, blockEnd);
		const remoteArgs = unwrapDsmlArgumentWrapper(
			parseToolArguments(
				block,
				remoteName === "replace_in_file" ? new Set(["diff"]) : undefined,
			),
			bridge,
		);
		const writeRuntimeName = getWriteRuntimeToolName(tools);
		const heredocWrite =
			remoteName === "execute_command" && writeRuntimeName
				? parseCatHeredocWriteCommand(stringArg(remoteArgs, "command"))
				: undefined;
		if (heredocWrite && writeRuntimeName) {
			toolCalls.push({
				name: writeRuntimeName,
				arguments: { ...heredocWrite },
			});
		} else {
			toolCalls.push({
				name: bridge?.runtimeName ?? next.name,
				arguments: bridge?.toRuntimeArgs(remoteArgs) ?? remoteArgs,
			});
		}
		cursor =
			closeStart === -1 ? sourceText.length : closeStart + closeTag.length;
	}

	pushTextFragment(textParts, sourceText.slice(cursor));
	const allToolCalls = [...fnResult.toolCalls, ...toolCalls];

	// Warn if the raw text appears to contain tool XML tags but no tool calls
	// were parsed — this can indicate a model using an unrecognised tag variant.
	if (allToolCalls.length === 0) {
		const TOOL_XML_RE =
			/<(read_file|write_to_file|replace_in_file|execute_command|list_files|search_files|browser_action|ask_followup_question|attempt_completion)\b/;
		if (TOOL_XML_RE.test(rawText)) {
			_logger.warn(
				"parseXmlToolCalls: raw text contains tool XML tags but no tool calls were parsed",
				{ preview: rawText.slice(0, 200) },
			);
		}
	}

	return {
		text: textParts.join("\n\n").trim(),
		toolCalls: allToolCalls,
	};
}

function parseReasoningHiddenToolCalls(
	thinkingParts: string[],
	tools: Tool[] | undefined,
	depth = 3,
): { thinking: string[]; toolCalls: ParsedToolCalls["toolCalls"] } {
	const thinking: string[] = [];
	const toolCalls: ParsedToolCalls["toolCalls"] = [];
	for (const part of thinkingParts) {
		const trimmed = part.trim();
		if (!trimmed) continue;
		if (depth <= 0) {
			thinking.push(trimmed);
			continue;
		}
		const extracted = extractThinkingXml(trimmed);
		const nested = parseReasoningHiddenToolCalls(
			extracted.thinking,
			tools,
			depth - 1,
		);
		const parsed = parseXmlToolCalls(extracted.text, tools);
		toolCalls.push(...parsed.toolCalls, ...nested.toolCalls);
		if (parsed.text) thinking.push(parsed.text);
		thinking.push(...nested.thinking);
		if (
			!parsed.text &&
			parsed.toolCalls.length === 0 &&
			nested.toolCalls.length === 0 &&
			nested.thinking.length === 0
		) {
			thinking.push(trimmed);
		}
	}
	return { thinking, toolCalls };
}

function parseReasoningToolCalls(
	reasoning: string,
	tools: Tool[] | undefined,
): { thinking: string[]; toolCalls: ParsedToolCalls["toolCalls"] } {
	if (!reasoning.trim()) return { thinking: [], toolCalls: [] };

	const extracted = extractThinkingXml(reasoning);
	const hiddenParsed = parseReasoningHiddenToolCalls(extracted.thinking, tools);
	const parsed = parseXmlToolCalls(extracted.text, tools);
	const thinking = [...hiddenParsed.thinking];
	if (parsed.toolCalls.length > 0 && parsed.text) {
		thinking.push(parsed.text);
	} else if (
		parsed.toolCalls.length === 0 &&
		hiddenParsed.thinking.length === 0 &&
		extracted.thinking.length === 0
	) {
		thinking.push(reasoning.trim());
	}

	return {
		thinking,
		toolCalls: [...parsed.toolCalls, ...hiddenParsed.toolCalls],
	};
}

const INTERNAL_ONLY_RESPONSE =
	"Cline returned internal reasoning only and did not produce a user-visible response. Please retry or ask it to continue.";

function prepareClineXmlOutput(
	parsedText: string,
	contentThinking: string[],
	reasoningThinking: string[],
	toolCalls: ParsedToolCalls["toolCalls"],
): {
	visibleText: string;
	thinkingText: string;
	toolCalls: ParsedToolCalls["toolCalls"];
} {
	const thinkingParts = [...reasoningThinking, ...contentThinking].filter(
		Boolean,
	);
	const thinkingText = thinkingParts.join("\n\n");
	if (!parsedText && toolCalls.length === 0 && thinkingText) {
		// Never return a blank stop, but also do not surface hidden reasoning as
		// user-visible answer text. If Cline sends only hidden/reasoning content,
		// show a stable visible fallback and keep the raw content in thinking.
		return {
			visibleText: INTERNAL_ONLY_RESPONSE,
			thinkingText,
			toolCalls,
		};
	}

	return {
		visibleText: parsedText,
		thinkingText,
		toolCalls,
	};
}

function usageFromChunkUsage(usage: ClineXmlChunk["usage"] | undefined): Usage {
	const input = usage?.prompt_tokens ?? 0;
	const output = usage?.completion_tokens ?? 0;
	const totalTokens = usage?.total_tokens ?? input + output;
	return {
		...DEFAULT_USAGE,
		input,
		output,
		totalTokens,
	};
}

async function* parseSse(response: Response): AsyncGenerator<ClineXmlChunk> {
	const reader = response.body?.getReader();
	if (!reader) return;
	const decoder = new TextDecoder();
	let buffer = "";

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		const lines = buffer.split(/\r?\n/);
		buffer = lines.pop() ?? "";
		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed.startsWith("data:")) continue;
			const data = trimmed.slice("data:".length).trim();
			if (!data || data === "[DONE]") continue;
			try {
				yield JSON.parse(data) as ClineXmlChunk;
			} catch {
				_logger.warn("Malformed SSE JSON chunk skipped", {
					preview: data.slice(0, 120),
				});
			}
		}
	}
}

type ClineXmlResponseData = {
	rawText: string;
	thinking: string;
	toolCalls: ClineToolCall[];
	finishReason: string | null | undefined;
	usage: ClineXmlChunk["usage"] | undefined;
};

function isRetryableClineReasoningStreamError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	const message = error.message.toLowerCase();
	return message.includes("stream error occurred");
}

type NativeToolCallAccumulator = {
	id: string;
	name: string;
	argumentsText: string;
};

type ClineChoice = NonNullable<ClineXmlChunk["choices"]>[number];

function collectNativeToolCallDeltas(
	choice: ClineChoice,
	nativeToolCalls: Map<number, NativeToolCallAccumulator>,
): void {
	const deltas = [
		...(choice.delta?.tool_calls ?? []),
		...(choice.delta?.function_call
			? [{ index: 0, function: choice.delta.function_call }]
			: []),
	];
	for (const [deltaIndex, delta] of deltas.entries()) {
		const index = delta.index ?? deltaIndex;
		const existing = nativeToolCalls.get(index) ?? {
			id: `cline_native_${index}`,
			name: "",
			argumentsText: "",
		};
		if (delta.id) existing.id = delta.id;
		if (delta.function?.name) existing.name += delta.function.name;
		existing.argumentsText += delta.function?.arguments ?? "";
		nativeToolCalls.set(index, existing);
	}
}

function parseNativeToolCalls(
	nativeToolCalls: Map<number, NativeToolCallAccumulator>,
): ClineToolCall[] {
	const toolCalls: ClineToolCall[] = [];
	for (const call of nativeToolCalls.values()) {
		if (!call.name) continue;
		let arguments_: Record<string, unknown> = {};
		try {
			const parsed = JSON.parse(call.argumentsText || "{}");
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				arguments_ = parsed as Record<string, unknown>;
			}
		} catch {
			_logger.warn("Invalid native Cline tool arguments", {
				name: call.name,
				preview: call.argumentsText.slice(0, 160),
			});
		}
		toolCalls.push({ id: call.id, name: call.name, arguments: arguments_ });
	}
	return toolCalls;
}

async function readClineXmlResponse(
	response: Response,
): Promise<ClineXmlResponseData> {
	let rawText = "";
	let thinking = "";
	let finishReason: string | null | undefined;
	let usage: ClineXmlChunk["usage"] | undefined;
	const nativeToolCalls = new Map<
		number,
		{ id: string; name: string; argumentsText: string }
	>();

	for await (const chunk of parseSse(response)) {
		if (chunk.error) {
			throw new Error(
				`${chunk.error.code ?? "cline_error"}: ${chunk.error.message ?? "Unknown Cline error"}`,
			);
		}
		if (chunk.usage) usage = chunk.usage;
		const choice = chunk.choices?.[0];
		if (!choice) continue;
		if (choice.error) {
			throw new Error(
				`${choice.error.code ?? "cline_error"}: ${choice.error.message ?? "Unknown Cline error"}`,
			);
		}
		if (choice.finish_reason) finishReason = choice.finish_reason;
		rawText += choice.delta?.content ?? "";
		thinking += choice.delta?.reasoning ?? "";

		collectNativeToolCallDeltas(choice, nativeToolCalls);
	}

	const toolCalls = parseNativeToolCalls(nativeToolCalls);
	if (!rawText.trim() && !thinking.trim() && toolCalls.length === 0) {
		throw new Error("Cline returned empty response");
	}

	// Some MiMo/Cline models wrap XML tags in Unicode math-italic characters
	// forming "anthml:" prefixes (e.g. <𝑎𝑛𝑡𝑚𝑙:thinking>, <𝑎𝑛𝑡𝑚𝑙:read_file>).
	// Strip these so the rest of the parser sees standard ASCII XML tags.
	return {
		rawText: normalizeDecoratedXmlTags(rawText),
		thinking: normalizeDecoratedXmlTags(thinking),
		toolCalls,
		finishReason,
		usage,
	};
}

async function fetchClineXmlResponse(
	model: Model<string>,
	context: Context,
	options: SimpleStreamOptions,
	headers: Record<string, string>,
	includeReasoning: boolean,
): Promise<ClineXmlResponseData> {
	const response = await fetch(`${BASE_URL_CLINE}/chat/completions`, {
		method: "POST",
		headers: {
			...headers,
			Authorization: `Bearer ${options.apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			model: normalizeApiModelId(model.id),
			temperature: 0,
			messages: buildClineXmlMessages(context),
			tools: buildClineToolDefinitions(context.tools),
			stream: true,
			stream_options: { include_usage: true },
			...(includeReasoning ? { include_reasoning: true } : {}),
		}),
		signal: options.signal,
	});
	await options.onResponse?.(
		{
			status: response.status,
			headers: Object.fromEntries(response.headers.entries()),
		},
		model,
	);

	if (!response.ok) {
		throw new Error(
			`Cline API error ${response.status}: ${await response.text()}`,
		);
	}

	return readClineXmlResponse(response);
}

async function fetchClineXmlResponseWithReasoningFallback(
	model: Model<string>,
	context: Context,
	options: SimpleStreamOptions,
	headers: Record<string, string>,
): Promise<ClineXmlResponseData> {
	try {
		return await fetchClineXmlResponse(model, context, options, headers, true);
	} catch (error) {
		if (
			options.signal?.aborted ||
			!isRetryableClineReasoningStreamError(error)
		) {
			throw error;
		}
		return fetchClineXmlResponse(model, context, options, headers, false);
	}
}

function createAssistant(model: Model<string>): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: DEFAULT_USAGE,
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

function pushText(
	message: AssistantMessage,
	text: string,
	stream: ReturnType<typeof createAssistantMessageEventStream>,
): void {
	if (!text) return;
	const index = message.content.length;
	message.content.push({ type: "text", text: "" });
	stream.push({ type: "text_start", contentIndex: index, partial: message });
	(message.content[index] as { type: "text"; text: string }).text = text;
	stream.push({
		type: "text_delta",
		contentIndex: index,
		delta: text,
		partial: message,
	});
	stream.push({
		type: "text_end",
		contentIndex: index,
		content: text,
		partial: message,
	});
}

function pushThinking(
	message: AssistantMessage,
	thinking: string,
	stream: ReturnType<typeof createAssistantMessageEventStream>,
): void {
	if (!thinking) return;
	const index = message.content.length;
	message.content.push({ type: "thinking", thinking: "" });
	stream.push({
		type: "thinking_start",
		contentIndex: index,
		partial: message,
	});
	(message.content[index] as { type: "thinking"; thinking: string }).thinking =
		thinking;
	stream.push({
		type: "thinking_delta",
		contentIndex: index,
		delta: thinking,
		partial: message,
	});
	stream.push({
		type: "thinking_end",
		contentIndex: index,
		content: thinking,
		partial: message,
	});
}

function pushToolCall(
	message: AssistantMessage,
	toolCall: { name: string; arguments: Record<string, unknown> },
	stream: ReturnType<typeof createAssistantMessageEventStream>,
): void {
	const index = message.content.length;
	const id = `cline_xml_${Date.now()}_${index}`;
	const block: ToolCall = {
		type: "toolCall",
		id,
		name: toolCall.name,
		arguments: {},
	};
	message.content.push(block);
	stream.push({
		type: "toolcall_start",
		contentIndex: index,
		partial: message,
	});
	const delta = JSON.stringify(toolCall.arguments);
	stream.push({
		type: "toolcall_delta",
		contentIndex: index,
		delta,
		partial: message,
	});
	block.arguments = toolCall.arguments;
	stream.push({
		type: "toolcall_end",
		contentIndex: index,
		toolCall: block,
		partial: message,
	});
}

export function streamClineXml(
	model: Model<string>,
	context: Context,
	options: SimpleStreamOptions | undefined,
	headers: Record<string, string>,
) {
	const stream = createAssistantMessageEventStream();

	void (async () => {
		const assistant = createAssistant(model);
		stream.push({ type: "start", partial: assistant });
		try {
			if (!options?.apiKey) {
				throw new Error("No Cline access token found. Run /login cline first.");
			}

			let output: ReturnType<typeof prepareClineXmlOutput>;
			let rawText: string;
			let thinking: string;
			let finishReason: string | null | undefined;
			let usage: ClineXmlChunk["usage"] | undefined;
			let currentContext = context;

			for (let attempt = 0; attempt < 2; attempt++) {
				const data = await fetchClineXmlResponseWithReasoningFallback(
					model,
					currentContext,
					options,
					headers,
				);
				rawText = data.rawText;
				thinking = data.thinking;
				finishReason = data.finishReason;
				usage = data.usage;

				const extractedThinking = extractThinkingXml(rawText);
				const parsedReasoning = parseReasoningToolCalls(
					thinking,
					currentContext.tools,
				);
				const parsed = parseXmlToolCalls(
					extractedThinking.text,
					currentContext.tools,
				);
				const bridges = getParseToolBridges(currentContext.tools);
				const nativeToolCalls = data.toolCalls.map((toolCall) => {
					const bridge = bridges.find(
						(candidate) =>
							candidate.remoteName === toolCall.name ||
							candidate.runtimeName === toolCall.name,
					);
					return {
						name: bridge?.runtimeName ?? toolCall.name,
						arguments:
							bridge?.toRuntimeArgs(toolCall.arguments) ?? toolCall.arguments,
					};
				});
				output = prepareClineXmlOutput(
					parsed.text,
					extractedThinking.thinking,
					parsedReasoning.thinking,
					[
						...parsed.toolCalls,
						...parsedReasoning.toolCalls,
						...nativeToolCalls,
					],
				);

				// Reasoning-only response: MiMo stopped without producing visible
				// text or tool calls. Auto-retry once with a "continue" nudge
				// instead of showing a dead-end error to the user.
				if (output.visibleText === INTERNAL_ONLY_RESPONSE && attempt === 0) {
					currentContext = {
						...context,
						messages: [
							...context.messages,
							{
								role: "user" as const,
								content: [{ type: "text" as const, text: "Please continue." }],
								timestamp: Date.now(),
							},
						],
					};
					continue;
				}
				break;
			}

			assistant.usage = usageFromChunkUsage(usage!);
			pushThinking(assistant, output!.thinkingText, stream);
			pushText(assistant, output!.visibleText, stream);
			const toolCalls = output!.toolCalls;
			for (const toolCall of toolCalls) {
				pushToolCall(assistant, toolCall, stream);
			}

			if (toolCalls.length > 0) {
				assistant.stopReason = "toolUse";
			} else if (finishReason === "length") {
				assistant.stopReason = "length";
			} else {
				assistant.stopReason = "stop";
			}
			stream.push({
				type: "done",
				reason: assistant.stopReason as "stop" | "length" | "toolUse",
				message: assistant,
			});
		} catch (error) {
			assistant.stopReason = options?.signal?.aborted ? "aborted" : "error";
			assistant.errorMessage =
				error instanceof Error ? error.message : String(error);
			_logger.warn("Cline XML streaming error", {
				model: model?.id,
				stopReason: assistant.stopReason,
				error: assistant.errorMessage,
			});
			stream.push({
				type: "error",
				reason: assistant.stopReason,
				error: assistant,
			});
		}
	})();

	return stream;
}

export const __test__ = {
	buildClineXmlMessages,
	extractFunctionTagToolCalls,
	isRetryableClineReasoningStreamError,
	normalizeDecoratedXmlTags,
	normalizeDsmlToolCalls,
	parseReasoningHiddenToolCalls,
	parseReasoningToolCalls,
	parseXmlToolCalls,
	prepareClineXmlOutput,
	serializeXmlToolCall,
};
