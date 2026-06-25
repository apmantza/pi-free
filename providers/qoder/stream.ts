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
	(async () => {
		try {
			const accessToken = options?.apiKey;
			if (!accessToken) {
				throw new Error(
					"Qoder credentials not set. Run /login qoder or set QODER_PERSONAL_ACCESS_TOKEN.",
				);
			}

			// Resolve user details from cached credentials
			const cachedCreds = getCachedCredentials(accessToken);
			const userID = cachedCreds?.userID || "qoder-user";
			const name = cachedCreds?.name || "Qoder User";
			const email = cachedCreds?.email || "user@qoder.com";
			const machineID = cachedCreds?.machineID || getMachineId();

			const qoderModel = model.id;
			const modelConfig = getCachedModelConfig(qoderModel) || {
				key: qoderModel,
				is_reasoning:
					qoderModel === "ultimate" ||
					qoderModel === "performance" ||
					qoderModel.includes("dmodel") ||
					qoderModel.includes("dfmodel"),
				max_output_tokens: 32768,
				source: "system",
			};
			modelConfig.key = qoderModel;

			const isReasoning = !!modelConfig.is_reasoning;
			const maxOutputTokens = modelConfig.max_output_tokens || 32768;

			const normalizedMessages = transformMessagesForQoder(context.messages);
			const systemText = context.systemPrompt || "";

			// Extract the last user message text for the chat context
			let lastUserText = "";
			for (let i = normalizedMessages.length - 1; i >= 0; i--) {
				if (normalizedMessages[i].role === "user") {
					const content = normalizedMessages[i].content;
					lastUserText =
						typeof content === "string"
							? content
							: Array.isArray(content)
								? content.map((c) => ("text" in c ? c.text : "")).join("")
								: "";
					break;
				}
			}

			const sessionID = stableHash("qoder-session", userID, qoderModel);

			let maxTokens = 32768;
			if (maxOutputTokens > 0) {
				maxTokens = maxOutputTokens;
			}
			if (options?.maxTokens && options.maxTokens < maxTokens) {
				maxTokens = options.maxTokens;
			}

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

			// Build the proprietary Qoder request body
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

			const modelSource =
				(modelConfig as Record<string, unknown>).source || "system";

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
				signal: options?.signal,
			});

			if (!response.ok) {
				const errText = await response.text();
				throw new Error(
					`Qoder API request failed: ${response.status} ${response.statusText}. Response: ${errText}`,
				);
			}

			const reader = response.body?.getReader();
			if (!reader) throw new Error("No response body");
			const decoder = new TextDecoder();
			let buffer = "";

			let contentBlockIndex = -1;
			let thinkingBlockIndex = -1;
			const toolCallsState: ToolCallState[] = [];

			const thinkingEnabled =
				(options?.reasoning as unknown) !== false &&
				(options?.reasoning as unknown) !== "off";
			const thinkingParser = thinkingEnabled
				? new ThinkingTagParser(output, stream)
				: null;

			stream.push({ type: "start", partial: output });

			// ── SSE parsing loop ──────────────────────────────────
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });

				while (true) {
					const lineEnd = buffer.indexOf("\n");
					if (lineEnd === -1) break;

					const line = buffer.substring(0, lineEnd).trim();
					buffer = buffer.substring(lineEnd + 1);

					if (!line.startsWith("data:")) continue;

					const dataStr = line.slice(5).trim();
					if (dataStr === "[DONE]") break;

					try {
						const envelope = JSON.parse(dataStr);
						if (envelope.statusCodeValue && envelope.statusCodeValue !== 200) {
							throw new Error(
								`Upstream status ${envelope.statusCodeValue}: ${envelope.body}`,
							);
						}

						const innerStr = envelope.body;
						if (!innerStr || innerStr === "[DONE]") continue;

						const inner = JSON.parse(innerStr);
						if (inner.choices && inner.choices.length > 0) {
							const choice = inner.choices[0];
							const delta = choice.delta;

							if (delta) {
								// 1. Reasoning content (API-native)
								if (delta.reasoning_content) {
									if (thinkingBlockIndex === -1) {
										thinkingBlockIndex = output.content.length;
										output.content.push({
											type: "thinking",
											thinking: "",
										});
										stream.push({
											type: "thinking_start",
											contentIndex: thinkingBlockIndex,
											partial: output,
										});
									}
									const block = output.content[
										thinkingBlockIndex
									] as ThinkingContent;
									block.thinking += delta.reasoning_content;
									stream.push({
										type: "thinking_delta",
										contentIndex: thinkingBlockIndex,
										delta: delta.reasoning_content,
										partial: output,
									});
								}

								// 2. Text content
								if (delta.content) {
									// End API thinking block if active
									if (thinkingBlockIndex !== -1) {
										const block = output.content[
											thinkingBlockIndex
										] as ThinkingContent;
										stream.push({
											type: "thinking_end",
											contentIndex: thinkingBlockIndex,
											content: block.thinking,
											partial: output,
										});
										thinkingBlockIndex = -1;
									}

									if (thinkingParser) {
										thinkingParser.processChunk(delta.content);
									} else {
										if (contentBlockIndex === -1) {
											contentBlockIndex = output.content.length;
											output.content.push({
												type: "text",
												text: "",
											});
											stream.push({
												type: "text_start",
												contentIndex: contentBlockIndex,
												partial: output,
											});
										}
										const block = output.content[
											contentBlockIndex
										] as TextContent;
										block.text += delta.content;
										stream.push({
											type: "text_delta",
											contentIndex: contentBlockIndex,
											delta: delta.content,
											partial: output,
										});
									}
								}

								// 3. Tool calls
								if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
									for (const tc of delta.tool_calls) {
										const idx = tc.index ?? 0;
										if (!toolCallsState[idx]) {
											toolCallsState[idx] = {
												arguments: "",
												id: "",
												name: "",
												contentIndex: 0,
											};
										}
										const state = toolCallsState[idx];
										if (tc.id) state.id = tc.id;
										if (tc.function?.name) state.name = tc.function.name;
										if (tc.function?.arguments) {
											const argDelta = tc.function.arguments;
											state.arguments += argDelta;

											if (state.emittedStart === undefined) {
												state.emittedStart = true;
												state.contentIndex = output.content.length;
												const block: ToolCall = {
													type: "toolCall",
													id: state.id,
													name: state.name,
													arguments: {},
												};
												output.content.push(block);
												stream.push({
													type: "toolcall_start",
													contentIndex: state.contentIndex,
													partial: output,
												});
											}
											stream.push({
												type: "toolcall_delta",
												contentIndex: state.contentIndex,
												delta: argDelta,
												partial: output,
											});
										}
									}
								}
							}

							if (choice.finish_reason) {
								output.stopReason = choice.finish_reason;
							}
						}
					} catch {
						// Skip unparseable SSE lines
					}
				}
			}

			// Finalize thinking parser if active
			if (thinkingParser) {
				thinkingParser.finalize();
			}

			// Close any remaining thinking block
			if (thinkingBlockIndex !== -1) {
				const block = output.content[thinkingBlockIndex] as ThinkingContent;
				stream.push({
					type: "thinking_end",
					contentIndex: thinkingBlockIndex,
					content: block.thinking,
					partial: output,
				});
			}

			// Finalize tool calls
			for (const state of toolCallsState) {
				if (state?.emittedStart && !state.emittedEnd) {
					state.emittedEnd = true;
					let args = {};
					try {
						args = JSON.parse(state.arguments || "{}");
					} catch {
						// Invalid JSON args — use empty object
					}
					const block = output.content[state.contentIndex] as ToolCall;
					block.arguments = args;
					stream.push({
						type: "toolcall_end",
						contentIndex: state.contentIndex,
						toolCall: {
							type: "toolCall",
							id: state.id,
							name: state.name,
							arguments: args,
						},
						partial: output,
					});
				}
			}

			if (toolCallsState.length > 0) {
				output.stopReason = "toolUse";
			} else {
				output.stopReason = "stop";
			}

			stream.push({
				type: "done",
				reason: output.stopReason as "stop" | "toolUse",
				message: output,
			});
			stream.end();
		} catch (e: unknown) {
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
	})();

	return stream;
}
