/**
 * Qoder custom streaming handler.
 *
 * Qoder's API is NOT OpenAI-compatible — it uses a proprietary protocol at
 * `api3.qoder.sh/algo/api/v2/service/pro/sse/agent_chat_generation` with
 * COSY-signed headers, WAF-encoded bodies, and a custom SSE event format.
 *
 * This module implements the full `streamSimple` interface that Pi expects,
 * bridging Qoder's proprietary streaming to Pi's `AssistantMessageEventStream`.
 */

import crypto from "node:crypto";
import type {
	Api,
	AssistantMessage,
	AssistantMessageEventStream,
	Context,
	Model,
	SimpleStreamOptions,
	TextContent,
	ThinkingContent,
	ToolCall,
} from "@earendil-works/pi-ai";
import * as PiAi from "@earendil-works/pi-ai";
import { buildAuthHeaders, getMachineId } from "./cosy.ts";
import { getCachedModelConfig } from "./models.ts";
import { getCachedCredentials } from "./auth.ts";
import { qoderEncodeBody } from "./encoding.ts";
import { ThinkingTagParser } from "./thinking-parser.ts";
import { transformMessagesForQoder, transformTools } from "./transform.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface ToolCallState {
	arguments: string;
	id: string;
	name: string;
	emittedStart?: boolean;
	emittedEnd?: boolean;
	contentIndex: number;
}

interface StreamState {
	output: AssistantMessage;
	stream: AssistantMessageEventStream;
	contentBlockIndex: number;
	thinkingBlockIndex: number;
	toolCallsState: ToolCallState[];
	thinkingParser: ThinkingTagParser | null;
}

function stableHash(prefix: string, ...inputs: string[]): string {
	const hash = crypto.createHash("sha256");
	hash.update(prefix);
	for (const input of inputs) {
		hash.update("\0");
		hash.update(input);
	}
	return hash.digest("hex").slice(0, 16);
}

function stableChatRecordID(
	model: string,
	messages: Array<{ role?: string; content?: unknown }>,
	tools: unknown,
	maxTokens: number,
): string {
	const hash = crypto.createHash("sha256");
	hash.update("qoder-record");
	hash.update("\0");
	hash.update(model);
	for (const msg of messages) {
		if (msg?.role) {
			hash.update("\0");
			hash.update(msg.role);
		}
		if (msg?.content) {
			hash.update("\0");
			hash.update(
				typeof msg.content === "string"
					? msg.content
					: JSON.stringify(msg.content),
			);
		}
	}
	if (tools) {
		hash.update("\0");
		hash.update(JSON.stringify(tools));
	}
	hash.update("\0");
	hash.update(`mt=${maxTokens}`);
	return hash.digest("hex").slice(0, 16);
}

// ─── Delta processing helpers ────────────────────────────────────────────────

function processReasoningDelta(
	state: StreamState,
	reasoningContent: string,
): void {
	if (state.thinkingBlockIndex === -1) {
		state.thinkingBlockIndex = state.output.content.length;
		state.output.content.push({ type: "thinking", thinking: "" });
		state.stream.push({
			type: "thinking_start",
			contentIndex: state.thinkingBlockIndex,
			partial: state.output,
		});
	}
	const block = state.output.content[
		state.thinkingBlockIndex
	] as ThinkingContent;
	block.thinking += reasoningContent;
	state.stream.push({
		type: "thinking_delta",
		contentIndex: state.thinkingBlockIndex,
		delta: reasoningContent,
		partial: state.output,
	});
}

function closeThinkingBlock(state: StreamState): void {
	if (state.thinkingBlockIndex === -1) return;
	const block = state.output.content[
		state.thinkingBlockIndex
	] as ThinkingContent;
	state.stream.push({
		type: "thinking_end",
		contentIndex: state.thinkingBlockIndex,
		content: block.thinking,
		partial: state.output,
	});
	state.thinkingBlockIndex = -1;
}

function processTextDelta(state: StreamState, text: string): void {
	if (state.thinkingParser) {
		state.thinkingParser.processChunk(text);
		return;
	}
	if (state.contentBlockIndex === -1) {
		state.contentBlockIndex = state.output.content.length;
		state.output.content.push({ type: "text", text: "" });
		state.stream.push({
			type: "text_start",
			contentIndex: state.contentBlockIndex,
			partial: state.output,
		});
	}
	const block = state.output.content[state.contentBlockIndex] as TextContent;
	block.text += text;
	state.stream.push({
		type: "text_delta",
		contentIndex: state.contentBlockIndex,
		delta: text,
		partial: state.output,
	});
}

function processToolCallDelta(
	state: StreamState,
	tc: {
		index?: number;
		id?: string;
		function?: { name?: string; arguments?: string };
	},
): void {
	const idx = tc.index ?? 0;
	if (!state.toolCallsState[idx]) {
		state.toolCallsState[idx] = {
			arguments: "",
			id: "",
			name: "",
			contentIndex: 0,
		};
	}
	const toolState = state.toolCallsState[idx];
	if (tc.id) toolState.id = tc.id;
	if (tc.function?.name) toolState.name = tc.function.name;
	if (tc.function?.arguments) {
		const argDelta = tc.function.arguments;
		toolState.arguments += argDelta;

		if (toolState.emittedStart === undefined) {
			toolState.emittedStart = true;
			toolState.contentIndex = state.output.content.length;
			const block: ToolCall = {
				type: "toolCall",
				id: toolState.id,
				name: toolState.name,
				arguments: {},
			};
			state.output.content.push(block);
			state.stream.push({
				type: "toolcall_start",
				contentIndex: toolState.contentIndex,
				partial: state.output,
			});
		}
		state.stream.push({
			type: "toolcall_delta",
			contentIndex: toolState.contentIndex,
			delta: argDelta,
			partial: state.output,
		});
	}
}

function processDelta(
	state: StreamState,
	delta: Record<string, unknown>,
): void {
	// 1. Reasoning content (API-native)
	if (delta.reasoning_content) {
		processReasoningDelta(state, delta.reasoning_content as string);
	}

	// 2. Text content
	if (delta.content) {
		closeThinkingBlock(state);
		processTextDelta(state, delta.content as string);
	}

	// 3. Tool calls
	if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
		for (const tc of delta.tool_calls) {
			processToolCallDelta(state, tc);
		}
	}
}

function finalizeToolCalls(state: StreamState): void {
	for (const toolState of state.toolCallsState) {
		if (toolState?.emittedStart && !toolState.emittedEnd) {
			toolState.emittedEnd = true;
			let args = {};
			try {
				args = JSON.parse(toolState.arguments || "{}");
			} catch {
				// Invalid JSON args — use empty object
			}
			const block = state.output.content[toolState.contentIndex] as ToolCall;
			block.arguments = args;
			state.stream.push({
				type: "toolcall_end",
				contentIndex: toolState.contentIndex,
				toolCall: {
					type: "toolCall",
					id: toolState.id,
					name: toolState.name,
					arguments: args,
				},
				partial: state.output,
			});
		}
	}
}

// ─── SSE parsing ─────────────────────────────────────────────────────────────

function handleSSELine(
	state: StreamState,
	line: string,
): boolean {
	if (!line.startsWith("data:")) return false;

	const dataStr = line.slice(5).trim();
	if (dataStr === "[DONE]") return true;

	try {
		const envelope = JSON.parse(dataStr);
		if (envelope.statusCodeValue && envelope.statusCodeValue !== 200) {
			throw new Error(
				`Upstream status ${envelope.statusCodeValue}: ${envelope.body}`,
			);
		}

		const innerStr = envelope.body;
		if (!innerStr || innerStr === "[DONE]") return false;

		const inner = JSON.parse(innerStr);
		if (inner.choices && inner.choices.length > 0) {
			const choice = inner.choices[0];
			if (choice.delta) {
				processDelta(state, choice.delta);
			}
			if (choice.finish_reason) {
				state.output.stopReason = choice.finish_reason;
			}
		}
	} catch {
		// Skip unparseable SSE lines
	}
	return false;
}

async function consumeSSEStream(
	state: StreamState,
	reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<void> {
	const decoder = new TextDecoder();
	let buffer = "";

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;

		buffer += decoder.decode(value, { stream: true });

		while (true) {
			const lineEnd = buffer.indexOf("\n");
			if (lineEnd === -1) break;

			const line = buffer.substring(0, lineEnd).trim();
			buffer = buffer.substring(lineEnd + 1);

			const done = handleSSELine(state, line);
			if (done) break;
		}
	}
}

// ─── Request builder ─────────────────────────────────────────────────────────

async function fetchQoderStream(
	setup: StreamSetup,
	signal?: AbortSignal,
): Promise<ReadableStream<Uint8Array>> {
	const {
		accessToken,
		qoderModel,
		modelConfig,
		normalizedMessages,
		lastUserText,
		systemText,
		maxTokens,
		toolsRaw,
		recordID,
		userID,
		name,
		email,
		machineID,
	} = setup;
	const sessionID = stableHash("qoder-session", userID, qoderModel);

	const isReasoning = Boolean(modelConfig.is_reasoning);

	const reqBody: Record<string, unknown> = {
		request_id: crypto.randomUUID(),
		request_set_id: recordID,
		chat_record_id: recordID,
		session_id: sessionID,
		stream: true,
		chat_task: "FREE_INPUT",
		is_reply: true,
		is_retry: false,
		source: 1,
		version: "3",
		session_type: "qodercli",
		agent_id: "agent_common",
		task_id: "common",
		code_language: "",
		chat_prompt: "",
		image_urls: null,
		aliyun_user_type: "",
		system: systemText,
		messages: normalizedMessages,
		tools: toolsRaw || [],
		parameters: { max_tokens: maxTokens },
		chat_context: {
			chatPrompt: "",
			imageUrls: null,
			extra: {
				context: [],
				modelConfig: {
					key: qoderModel,
					is_reasoning: isReasoning,
				},
				originalContent: lastUserText,
			},
			features: [],
			text: lastUserText,
		},
		model_config: modelConfig,
		business: {
			product: "cli",
			version: "1.0.0",
			type: "agent",
			stage: "start",
			id: crypto.randomUUID(),
			name: lastUserText.substring(0, 30),
			begin_at: Date.now(),
		},
	};

	const bodyBytes = Buffer.from(JSON.stringify(reqBody));
	const encodedBody = qoderEncodeBody(bodyBytes);
	const encodedBytes = Buffer.from(encodedBody, "utf8");

	const chatURL =
		"https://api3.qoder.sh/algo/api/v2/service/pro/sse/agent_chat_generation?FetchKeys=llm_model_result&AgentId=agent_common&Encode=1";

	const headers = buildAuthHeaders(encodedBytes, chatURL, {
		userID,
		authToken: accessToken,
		name,
		email,
		machineID,
	});

	const modelSource = modelConfig.source || "system";

	const response = await fetch(chatURL, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Accept: "text/event-stream",
			"Cache-Control": "no-cache",
			"Accept-Encoding": "identity",
			"X-Model-Key": qoderModel,
			"X-Model-Source": modelSource as string,
			...headers,
		},
		body: encodedBytes,
		signal,
	});

	if (!response.ok) {
		const errText = await response.text();
		throw new Error(
			`Qoder API request failed: ${response.status} ${response.statusText}. Response: ${errText}`,
		);
	}

	const body = response.body;
	if (!body) throw new Error("No response body");
	return body;
}

// ─── Stream handler ──────────────────────────────────────────────────────────

/**
 * Main streaming handler for Qoder API requests.
 * This is passed as the `streamSimple` option in `pi.registerProvider`.
 */
export function streamQoder(
	model: Model<Api>,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	const StreamCtor = (
		PiAi as unknown as {
			AssistantMessageEventStream: new () => AssistantMessageEventStream;
		}
	).AssistantMessageEventStream;
	const stream = new StreamCtor();

	const output: AssistantMessage = {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
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
		stopReason: "stop",
		timestamp: Date.now(),
	};

	// Run async — AssistantMessageEventStream is a push-based pull stream
	runStream(output, stream, model, context, options);

	return stream;
}

interface StreamSetup {
	accessToken: string;
	qoderModel: string;
	modelConfig: Record<string, unknown>;
	normalizedMessages: unknown[];
	lastUserText: string;
	systemText: string;
	maxTokens: number;
	toolsRaw: unknown;
	recordID: string;
	userID: string;
	name: string;
	email: string;
	machineID: string;
}

function buildStreamSetup(
	model: Model<Api>,
	context: Context,
	options: SimpleStreamOptions | undefined,
): StreamSetup {
	const accessToken = options?.apiKey;
	if (!accessToken) {
		throw new Error(
			"Qoder credentials not set. Run /login qoder or set QODER_PERSONAL_ACCESS_TOKEN.",
		);
	}

	const cachedCreds = getCachedCredentials();
	const userID = cachedCreds?.userID || "qoder-user";
	const name = cachedCreds?.name || "Qoder User";
	const email = cachedCreds?.email || "user@qoder.com";
	const machineID = cachedCreds?.machineID || getMachineId();

	const qoderModel = model.id;
	const modelConfig = getCachedModelConfig(qoderModel) || {
		key: qoderModel,
		is_reasoning: isReasoningModel(qoderModel),
		max_output_tokens: 32768,
		source: "system",
	};
	modelConfig.key = qoderModel;

	const maxOutputTokens = modelConfig.max_output_tokens || 32768;

	const normalizedMessages = transformMessagesForQoder(context.messages);
	const systemText = context.systemPrompt || "";
	const lastUserText = extractLastUserText(normalizedMessages);

	const maxTokens = resolveMaxTokens(maxOutputTokens, options?.maxTokens);

	const toolsRaw =
		context.tools && context.tools.length > 0
			? transformTools(context.tools)
			: undefined;
	const recordID = stableChatRecordID(
		qoderModel,
		normalizedMessages,
		toolsRaw,
		maxTokens,
	);

	return {
		accessToken,
		qoderModel,
		modelConfig,
		normalizedMessages,
		lastUserText,
		systemText,
		maxTokens,
		toolsRaw,
		recordID,
		userID,
		name,
		email,
		machineID,
	};
}

async function runStream(
	output: AssistantMessage,
	stream: AssistantMessageEventStream,
	model: Model<Api>,
	context: Context,
	options: SimpleStreamOptions | undefined,
): Promise<void> {
	try {
		const setup = buildStreamSetup(model, context, options);

		const thinkingEnabled = isThinkingEnabled(options?.reasoning);
		const thinkingParser = thinkingEnabled
			? new ThinkingTagParser(output, stream)
			: null;

		const state: StreamState = {
			output,
			stream,
			contentBlockIndex: -1,
			thinkingBlockIndex: -1,
			toolCallsState: [],
			thinkingParser,
		};

		stream.push({ type: "start", partial: output });

		const reader = await fetchQoderStream(setup, options?.signal).then(
			(s) => s.getReader(),
		);

		await consumeSSEStream(state, reader);

		// Finalize
		if (thinkingParser) {
			thinkingParser.finalize();
		}
		closeThinkingBlock(state);
		finalizeToolCalls(state);

		if (state.toolCallsState.length > 0) {
			output.stopReason = "toolUse";
		} else if (!output.stopReason || output.stopReason === "stop") {
			output.stopReason = "stop";
		}

		stream.push({
			type: "done",
			reason: output.stopReason as "stop" | "toolUse",
			message: output,
		});
		stream.end();
	} catch (e: unknown) {
		const logger = (await import("../../lib/logger.ts")).createLogger("qoder");
		logger.error("stream error", {
			error: e instanceof Error ? e.message : String(e),
		});
		output.stopReason = options?.signal?.aborted ? "aborted" : "error";
		output.errorMessage = e instanceof Error ? e.message : String(e);
		stream.push({
			type: "error",
			reason: output.stopReason,
			error: output,
		});
		try {
			stream.end();
		} catch {
			// Stream may already be ended
		}
	}
}

// ─── Small pure helpers ──────────────────────────────────────────────────────

function isReasoningModel(modelId: string): boolean {
	return (
		modelId === "ultimate" ||
		modelId === "performance" ||
		modelId.includes("dmodel") ||
		modelId.includes("dfmodel")
	);
}

function extractLastUserText(
	messages: Array<{ role?: string; content?: unknown }>,
): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg?.role !== "user") continue;
		const content = msg.content;
		if (typeof content === "string") return content;
		if (Array.isArray(content)) {
			return content.map((c) => ("text" in c ? c.text : "")).join("");
		}
	}
	return "";
}

function resolveMaxTokens(maxOutputTokens: number, requested?: number): number {
	let maxTokens = 32768;
	if (maxOutputTokens > 0) {
		maxTokens = maxOutputTokens;
	}
	if (requested && requested < maxTokens) {
		maxTokens = requested;
	}
	return maxTokens;
}

function isThinkingEnabled(reasoning: unknown): boolean {
	return reasoning !== false && reasoning !== "off";
}
