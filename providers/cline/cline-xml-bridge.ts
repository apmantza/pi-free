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
} from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { BASE_URL_CLINE, PROVIDER_CLINE } from "../../constants.ts";

const DEFAULT_USAGE: Usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

type ClineXmlChatMessage = {
	role: "assistant" | "system" | "user";
	content: string | Array<{ type: "text"; text: string }>;
};

type ClineXmlChunk = {
	error?: { message?: string; code?: string };
	usage?: {
		prompt_tokens?: number;
		completion_tokens?: number;
		total_tokens?: number;
	};
	choices?: Array<{
		delta?: { content?: string | null; reasoning?: string | null };
		finish_reason?: string | null;
		error?: { message?: string; code?: string };
	}>;
};

function normalizeApiModelId(modelId: string): string {
	return modelId.startsWith(`${PROVIDER_CLINE}/`)
		? modelId.slice(`${PROVIDER_CLINE}/`.length)
		: modelId;
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
	return typeof value === "string" ? value : value == null ? "" : String(value);
}

function booleanArg(args: Record<string, unknown>, key: string): boolean {
	return String(args[key]).toLowerCase() === "true";
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'"'"'`)}'`;
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
	const normalized = diff.replaceAll("\r\n", "\n");
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
		toRuntimeArgs: (args) => ({
			path: stringArg(args, "path"),
			edits: parseSearchReplaceBlocks(stringArg(args, "diff")),
		}),
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

function schemaProperties(tool: Tool): string[] {
	const parameters = tool.parameters as unknown as {
		properties?: Record<string, unknown>;
	};
	return Object.keys(parameters.properties ?? {});
}

function buildToolInstructions(tools: Tool[] | undefined): string {
	const bridges = getToolBridges(tools);
	if (bridges.length === 0) return "";

	const sections = bridges.map((bridge) => {
		const params =
			bridge.remoteName === "replace_in_file"
				? [
						"  <path>path/to/file</path>",
						"  <diff>",
						"------- SEARCH",
						"exact text to replace",
						"=======",
						"new text",
						"+++++++ REPLACE",
						"  </diff>",
					].join("\n")
				: bridge.parameters.length
					? bridge.parameters
							.map((name) => `  <${name}>value</${name}>`)
							.join("\n")
					: "  <arguments>{}</arguments>";
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
		"You have access to tools. Use XML tool calls instead of OpenAI function calling.",
		"When you need a tool, output exactly one XML tool call using one of the tool names below.",
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

function extractThinkingXml(text: string): {
	text: string;
	thinking: string[];
} {
	const thinking: string[] = [];
	const parts: string[] = [];
	const openTag = "<thinking>";
	const closeTag = "</thinking>";
	let cursor = 0;

	while (cursor < text.length) {
		const openStart = text.indexOf(openTag, cursor);
		const closeStart = text.indexOf(closeTag, cursor);

		if (closeStart !== -1 && (openStart === -1 || closeStart < openStart)) {
			const danglingThinking = decodeXmlEntities(
				text.slice(cursor, closeStart).trim(),
			);
			if (danglingThinking) thinking.push(danglingThinking);
			cursor = closeStart + closeTag.length;
			continue;
		}

		if (openStart === -1) break;
		parts.push(text.slice(cursor, openStart));
		const valueStart = openStart + openTag.length;
		const valueEnd = text.indexOf(closeTag, valueStart);
		if (valueEnd === -1) {
			const value = decodeXmlEntities(text.slice(valueStart).trim());
			if (value) thinking.push(value);
			cursor = text.length;
			break;
		}

		const value = decodeXmlEntities(text.slice(valueStart, valueEnd).trim());
		if (value) thinking.push(value);
		cursor = valueEnd + closeTag.length;
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

function parseToolArguments(block: string): Record<string, unknown> {
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
			tag === "content" || tag === "diff"
				? block.lastIndexOf(close)
				: block.indexOf(close, openEnd + 1);
		if (closeStart === -1 || closeStart < openEnd) break;
		const raw = decodeXmlEntities(block.slice(openEnd + 1, closeStart).trim());
		try {
			args[tag] = JSON.parse(raw);
		} catch {
			args[tag] = raw;
		}
		cursor = closeStart + close.length;
	}
	return args;
}

function parseXmlToolCalls(
	rawText: string,
	tools: Tool[] | undefined,
): {
	text: string;
	toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>;
} {
	const bridgeByRemoteName = new Map(
		getParseToolBridges(tools).map((bridge) => [bridge.remoteName, bridge]),
	);
	const toolNames = new Set(bridgeByRemoteName.keys());
	const textWithoutThinking = extractThinkingXml(rawText).text;
	if (toolNames.size === 0) {
		return { text: textWithoutThinking.trim(), toolCalls: [] };
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
		const closeTag = `</${next.name}>`;
		const closeStart = sourceText.indexOf(
			closeTag,
			next.index + next.openTag.length,
		);
		pushTextFragment(textParts, sourceText.slice(cursor, next.index));
		const blockEnd = closeStart === -1 ? sourceText.length : closeStart;
		const block = sourceText.slice(next.index + next.openTag.length, blockEnd);
		const bridge = bridgeByRemoteName.get(next.name);
		const remoteArgs = parseToolArguments(block);
		toolCalls.push({
			name: bridge?.runtimeName ?? next.name,
			arguments: bridge?.toRuntimeArgs(remoteArgs) ?? remoteArgs,
		});
		cursor =
			closeStart === -1 ? sourceText.length : closeStart + closeTag.length;
	}

	pushTextFragment(textParts, sourceText.slice(cursor));
	return { text: textParts.join("\n\n").trim(), toolCalls };
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
			yield JSON.parse(data) as ClineXmlChunk;
		}
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
					stream: true,
					stream_options: { include_usage: true },
					include_reasoning: true,
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

			let rawText = "";
			let thinking = "";
			let finishReason: string | null | undefined;
			let usage: ClineXmlChunk["usage"] | undefined;

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
			}

			assistant.usage = usageFromChunkUsage(usage);
			const extractedThinking = extractThinkingXml(rawText);
			pushThinking(
				assistant,
				[thinking.trim(), ...extractedThinking.thinking]
					.filter(Boolean)
					.join("\n\n"),
				stream,
			);
			const parsed = parseXmlToolCalls(extractedThinking.text, context.tools);
			pushText(assistant, parsed.text, stream);
			for (const toolCall of parsed.toolCalls) {
				pushToolCall(assistant, toolCall, stream);
			}

			assistant.stopReason =
				parsed.toolCalls.length > 0
					? "toolUse"
					: finishReason === "length"
						? "length"
						: "stop";
			stream.push({
				type: "done",
				reason: assistant.stopReason as "stop" | "length" | "toolUse",
				message: assistant,
			});
		} catch (error) {
			assistant.stopReason = options?.signal?.aborted ? "aborted" : "error";
			assistant.errorMessage =
				error instanceof Error ? error.message : String(error);
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
	parseXmlToolCalls,
	serializeXmlToolCall,
};
