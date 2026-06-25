/**
 * Message format transformation between Pi's internal format and Qoder's
 * proprietary API format.
 *
 * Pi uses a structured message format with typed content blocks (TextContent,
 * ThinkingContent, ImageContent, ToolCall). Qoder's API expects an
 * OpenAI-compatible format with some custom extensions.
 */

import type {
	AssistantMessage,
	ImageContent,
	Message,
	TextContent,
	ThinkingContent,
	Tool,
	ToolCall,
	ToolResultMessage,
} from "@earendil-works/pi-ai";

/** OpenAI-style tool definition sent to the Qoder API. */
interface QoderTool {
	type: "function";
	function: {
		name: string;
		description?: string;
		parameters?: unknown;
	};
}

/** OpenAI-style tool call within an assistant message. */
interface QoderToolCall {
	id?: string;
	type: "function";
	function: { name?: string; arguments: string };
}

type QoderTextPart = { type: "text"; text: string };
type QoderImagePart = { type: "image_url"; image_url: { url: string } };
type QoderContent = string | Array<QoderTextPart | QoderImagePart>;

/** OpenAI-style message sent to the Qoder API. */
interface QoderMessage {
	role: "user" | "assistant" | "tool";
	content: QoderContent | null;
	tool_calls?: QoderToolCall[];
	tool_call_id?: string;
}

/**
 * Extract text content from a message, joining all text/thinking blocks.
 */
export function getContentText(msg: Message): string {
	if (typeof msg.content === "string") return msg.content;
	if (Array.isArray(msg.content)) {
		return msg.content
			.map((c) => {
				if (c.type === "text") return (c as TextContent).text;
				if (c.type === "thinking") return (c as ThinkingContent).thinking;
				return "";
			})
			.join("");
	}
	return "";
}

/**
 * Convert Pi's Tool[] to Qoder's tool format.
 */
export function transformTools(tools: Tool[]): QoderTool[] {
	return tools.map((t) => ({
		type: "function",
		function: {
			name: t.name,
			description: t.description,
			parameters: t.parameters,
		},
	}));
}

/**
 * Convert Pi's internal messages to Qoder's expected format.
 *
 * Handles:
 * - User messages with text and/or image content
 * - Assistant messages with text, thinking, and tool calls
 * - Tool result messages
 * - Skips error/aborted assistant messages
 */
export function transformMessagesForQoder(messages: Message[]): QoderMessage[] {
	const normalizedMessages: QoderMessage[] = [];
	for (const msg of messages) {
		if (isSkippableMessage(msg)) continue;
		if (msg.role === "user") {
			normalizedMessages.push(transformUserMessage(msg));
		} else if (msg.role === "assistant") {
			normalizedMessages.push(
				transformAssistantMessage(msg as AssistantMessage),
			);
		} else if (msg.role === "toolResult") {
			normalizedMessages.push(
				transformToolResultMessage(msg as ToolResultMessage),
			);
		}
	}
	return normalizedMessages;
}

function isSkippableMessage(msg: Message): boolean {
	if (msg.role !== "assistant") return false;
	const am = msg as AssistantMessage;
	return am.stopReason === "error" || am.stopReason === "aborted";
}

function transformUserMessage(msg: Message): QoderMessage {
	let content: QoderContent = "";
	if (typeof msg.content === "string") {
		content = msg.content;
	} else if (Array.isArray(msg.content)) {
		const hasImage = msg.content.some((c) => c.type === "image");
		if (hasImage) {
			content = msg.content
				.map((c): QoderTextPart | QoderImagePart | null => {
					if (c.type === "text") {
						return { type: "text", text: (c as TextContent).text };
					}
					if (c.type === "image") {
						const img = c as ImageContent;
						return {
							type: "image_url",
							image_url: { url: `data:${img.mimeType};base64,${img.data}` },
						};
					}
					return null;
				})
				.filter((p): p is QoderTextPart | QoderImagePart => p !== null);
		} else {
			content = getContentText(msg);
		}
	}
	return { role: "user", content };
}

function transformAssistantMessage(am: AssistantMessage): QoderMessage {
	let content = "";
	const toolCalls: QoderToolCall[] = [];

	if (Array.isArray(am.content)) {
		for (const block of am.content) {
			if (block.type === "text") {
				content += (block as TextContent).text;
			} else if (block.type === "thinking") {
				content += `<thinking>${(block as ThinkingContent).thinking}</thinking>\n\n`;
			} else if (block.type === "toolCall") {
				const tc = block as ToolCall;
				toolCalls.push({
					id: tc.id,
					type: "function",
					function: {
						name: tc.name,
						arguments:
							typeof tc.arguments === "string"
								? tc.arguments
								: JSON.stringify(tc.arguments),
					},
				});
			}
		}
	} else {
		content = am.content || "";
	}

	const mapped: QoderMessage = {
		role: "assistant",
		content: content || null,
	};
	if (toolCalls.length > 0) {
		mapped.tool_calls = toolCalls;
	}
	return mapped;
}

function transformToolResultMessage(tr: ToolResultMessage): QoderMessage {
	return {
		role: "tool",
		tool_call_id: tr.toolCallId,
		content: getContentText(tr),
	};
}
