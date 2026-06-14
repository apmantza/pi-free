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

function stringArg(args: Record<string, unknown>, key: string): string {
	const value = args[key];
	return typeof value === "string" ? value : value == null ? "" : String(value);
}

function getToolBridge(tool: Tool): ToolBridge {
	if (tool.name === "read") {
		return {
			remoteName: "read_file",
			runtimeName: "read",
			description: tool.description,
			parameters: ["path"],
			toRuntimeArgs: (args) => ({ path: stringArg(args, "path") }),
			fromRuntimeArgs: (args) => ({ path: args.path }),
		};
	}
	if (tool.name === "write") {
		return {
			remoteName: "write_to_file",
			runtimeName: "write",
			description: tool.description,
			parameters: ["path", "content"],
			toRuntimeArgs: (args) => ({
				path: stringArg(args, "path"),
				content: stringArg(args, "content"),
			}),
			fromRuntimeArgs: (args) => ({ path: args.path, content: args.content }),
		};
	}
	if (tool.name === "bash") {
		return {
			remoteName: "execute_command",
			runtimeName: "bash",
			description: tool.description,
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
	return (tools ?? []).map(getToolBridge);
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
	const bridgeByRuntimeName = new Map(
		getToolBridges(tools).map((bridge) => [bridge.runtimeName, bridge]),
	);
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
		const params = bridge.parameters.length
			? bridge.parameters.map((name) => `  <${name}>value</${name}>`).join("\n")
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
			tag === "content"
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
		getToolBridges(tools).map((bridge) => [bridge.remoteName, bridge]),
	);
	const toolNames = new Set(bridgeByRemoteName.keys());
	if (toolNames.size === 0) return { text: rawText.trim(), toolCalls: [] };

	const textParts: string[] = [];
	const toolCalls: Array<{ name: string; arguments: Record<string, unknown> }> =
		[];
	let cursor = 0;

	while (cursor < rawText.length) {
		const next = findNextToolStart(rawText, toolNames, cursor);
		if (!next) break;
		const closeTag = `</${next.name}>`;
		const closeStart = rawText.indexOf(
			closeTag,
			next.index + next.openTag.length,
		);
		if (closeStart === -1) break;
		const before = rawText.slice(cursor, next.index).trim();
		if (before) textParts.push(before);
		const block = rawText.slice(next.index + next.openTag.length, closeStart);
		const bridge = bridgeByRemoteName.get(next.name);
		const remoteArgs = parseToolArguments(block);
		toolCalls.push({
			name: bridge?.runtimeName ?? next.name,
			arguments: bridge?.toRuntimeArgs(remoteArgs) ?? remoteArgs,
		});
		cursor = closeStart + closeTag.length;
	}

	const rest = rawText.slice(cursor).trim();
	if (rest) textParts.push(rest);
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
			pushThinking(assistant, thinking.trim(), stream);
			const parsed = parseXmlToolCalls(rawText, context.tools);
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
