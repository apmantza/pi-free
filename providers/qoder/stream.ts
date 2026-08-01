/**
 * Qoder custom streaming handler.
 *
 * Qoder's current production API is OpenAI-compatible and lives at
 * `api2-v2.qoder.sh/model/v1/chat/completions` with standard Bearer auth.
 * The legacy proprietary SSE/protocol endpoint at api3.qoder.sh has been
 * decommissioned and returns 500 Internal Server Error.
 *
 * This module implements the `streamSimple` interface that Pi expects,
 * translating Qoder's response format to Pi's `AssistantMessageEventStream`.
 */

import type {
	Api,
	AssistantMessage,
	AssistantMessageEventStream as PiAssistantMessageEventStream,
	Context,
	Model,
	SimpleStreamOptions,
	StopReason,
	TextContent,
	ThinkingContent,
	ToolCall,
} from "@earendil-works/pi-ai/compat";
import {
	AssistantMessageEventStream as LocalAssistantMessageEventStream,
} from "../../lib/assistant-message-event-stream.ts";
import { BASE_URL_QODER } from "../../constants.ts";
import { createLogger } from "../../lib/logger.ts";
import { getCachedModelConfig, staticModels } from "./models.ts";
import { ThinkingTagParser } from "./thinking-parser.ts";
import { transformMessagesForQoder, transformTools } from "./transform.ts";

// =============================================================================
// Helpers / State
// =============================================================================

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
	stream: LocalAssistantMessageEventStream;
	contentBlockIndex: number;
	thinkingBlockIndex: number;
	toolCallsState: ToolCallState[];
	thinkingParser: ThinkingTagParser | null;
	hasReasoningContent: boolean;
}

// =============================================================================
// Delta processing
// =============================================================================

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
	if (state.thinkingParser && !state.hasReasoningContent) {
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
	// 1. Reasoning content (API-native OpenAI-compatible extension)
	if (delta.reasoning_content) {
		state.hasReasoningContent = true;
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

// =============================================================================
// SSE parsing (OpenAI-compatible stream)
// =============================================================================

function handleSSELine(state: StreamState, line: string): boolean {
	if (!line.startsWith("data:")) return false;

	const dataStr = line.slice(5).trim();
	if (dataStr === "[DONE]") return true;

	let parsed: Record<string, unknown>;
	try {
		parsed = JSON.parse(dataStr);
	} catch {
		// Skip unparseable SSE lines
		return false;
	}

	if (parsed.error) {
		throw new Error(
			`Qoder SSE error: ${(parsed.error as { message?: string }).message || JSON.stringify(parsed.error)}`,
		);
	}

	if (
		parsed.choices &&
		Array.isArray(parsed.choices) &&
		parsed.choices.length > 0
	) {
		const choice = parsed.choices[0] as Record<string, unknown>;
		if (choice.delta) {
			processDelta(state, choice.delta as Record<string, unknown>);
		}
		if (choice.finish_reason) {
			state.output.stopReason = choice.finish_reason as StopReason;
		}
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

		if (buffer.length > MAX_SSE_BUFFER_BYTES) {
			throw new Error(
				`Qoder SSE buffer exceeded ${MAX_SSE_BUFFER_BYTES} bytes without a newline; stream appears malformed.`,
			);
		}

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

// =============================================================================
// Request builder (OpenAI-compatible)
// =============================================================================

const QODER_CHAT_URL = `${BASE_URL_QODER}/model/v1/chat/completions`;

const logger = createLogger("qoder");

/** Max SSE line buffer size before we treat the stream as malformed. */
const MAX_SSE_BUFFER_BYTES = 1024 * 1024; // 1 MB

/** Redact a bearer token so it never leaks into logs or error messages. */
function redactToken(token: string | undefined): string {
	if (!token) return "(none)";
	if (token.length <= 8) return "***";
	return `${token.slice(0, 3)}...${token.slice(-3)}`;
}

interface StreamSetup {
	accessToken: string;
	qoderModel: string;
	modelConfig: Record<string, unknown>;
	normalizedMessages: unknown[];
	systemText: string;
	maxTokens: number;
	toolsRaw: unknown;
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

	// Log for diagnostics (visible in pi output)
	const isDebug = process.env.QODER_DEBUG === "1";

	const qoderModel = model.id;
	const modelConfig = getCachedModelConfig(qoderModel) || {
		key: qoderModel,
		is_reasoning: isReasoningModel(qoderModel),
		max_output_tokens: 32768,
		source: "system",
	};

	const maxOutputTokens = (modelConfig.max_output_tokens as number) || 32768;

	let normalizedMessages = transformMessagesForQoder(context.messages);
	const systemText = context.systemPrompt || "";

	// Prepend system prompt as a system message if present.
	if (systemText) {
		normalizedMessages = [
			{ role: "system", content: systemText },
			...normalizedMessages,
		];
	}

	const maxTokens = resolveMaxTokens(maxOutputTokens, options?.maxTokens);

	const toolsRaw =
		context.tools && context.tools.length > 0
			? transformTools(context.tools)
			: undefined;

	if (isDebug) {
		logger.info("[QODER] streaming request", {
			endpoint: QODER_CHAT_URL,
			model: qoderModel,
			messages: normalizedMessages.length,
			token: redactToken(accessToken),
		});
	}

	return {
		accessToken,
		qoderModel,
		modelConfig,
		normalizedMessages,
		systemText,
		maxTokens,
		toolsRaw,
	};
}

async function fetchQoderStream(
	setup: StreamSetup,
	signal?: AbortSignal,
): Promise<ReadableStream<Uint8Array>> {
	const { accessToken, qoderModel, normalizedMessages, maxTokens, toolsRaw } =
		setup;

	const reqBody: Record<string, unknown> = {
		model: qoderModel,
		messages: normalizedMessages,
		stream: true,
	};

	if (toolsRaw && Array.isArray(toolsRaw) && toolsRaw.length > 0) {
		reqBody.tools = toolsRaw;
	}

	if (maxTokens > 0) {
		reqBody.max_tokens = maxTokens;
	}

	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		Accept: "text/event-stream",
		Authorization: `Bearer ${accessToken}`,
		"User-Agent": "pi-free-providers",
	};

	const response = await fetch(QODER_CHAT_URL, {
		method: "POST",
		headers,
		body: Buffer.from(JSON.stringify(reqBody)),
		signal,
	});

	if (!response.ok) {
		const errText = await response.text();
		const truncated =
			errText.length > 500 ? `${errText.slice(0, 500)}...` : errText;
		logger.error("[QODER] API request failed", {
			status: response.status,
			statusText: response.statusText,
			model: qoderModel,
			responseLength: errText.length,
			response: truncated,
			token: redactToken(accessToken),
		});
		throw new Error(
			`Qoder API request failed: ${response.status} ${response.statusText} at ${QODER_CHAT_URL}. Model: ${qoderModel}.`,
		);
	}

	const body = response.body;
	if (!body) throw new Error("No response body");
	return body;
}

// =============================================================================
// Stream handler (Pi `streamSimple` implementation)
// =============================================================================

export function streamQoder(
	model: Model<Api>,
	context: Context,
	options?: SimpleStreamOptions,
): PiAssistantMessageEventStream {
	const stream = new LocalAssistantMessageEventStream();

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

	return stream as unknown as PiAssistantMessageEventStream;
}

async function runStream(
	output: AssistantMessage,
	stream: LocalAssistantMessageEventStream,
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
			hasReasoningContent: false,
		};

		stream.push({ type: "start", partial: output });

		const reader = await fetchQoderStream(setup, options?.signal).then((s) =>
			s.getReader(),
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

// =============================================================================
// Small pure helpers
// =============================================================================

const REASONING_MODEL_IDS = new Set(
	staticModels.filter((m) => m.reasoning).map((m) => m.id),
);

function isReasoningModel(modelId: string): boolean {
	return REASONING_MODEL_IDS.has(modelId);
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
