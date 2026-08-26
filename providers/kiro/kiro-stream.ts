/**
 * Kiro streaming integration — custom wire protocol for the Kiro API.
 *
 * Simplified port of the reference implementation's stream.ts.
 * Handles request building, Smithy event stream parsing, and token counting.
 * Uses @smithy/core for event stream marshaling.
 */
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
  ToolResultMessage,
} from "@earendil-works/pi-ai";
import * as PiAi from "@earendil-works/pi-ai";
import { UniversalEventStreamMarshaller } from "@smithy/core/event-streams";
import type { Message } from "@smithy/types";
import { getKiroEndpoints, getKiroRegionFromEndpoint, resolveApiRegion } from "./kiro-endpoints.js";
import { parseKiroEvent } from "./kiro-event-parser.js";
import { ThinkingTagParser } from "./kiro-thinking-parser.js";
import { buildHistory, convertImagesToKiro, convertToolsToKiro, EMPTY_CONTENT_PLACEHOLDER, extractImages, getContentText, type KiroHistoryEntry, type KiroImage, type KiroToolResult, type KiroToolSpec, type KiroUserInputMessage, normalizeMessages, sanitizeSurrogates, TOOL_RESULT_LIMIT, truncate } from "./kiro-transform.js";
import { getKiroEffortConfig, buildKiroAdditionalModelRequestFields, type KiroAdditionalModelRequestFields } from "./kiro-effort.js";
import { resolveKiroModel, updateKiroModelsCache, isCacheStale } from "./kiro-models.js";
import { capacityRetryConfig, exponentialBackoff, FIRST_TOKEN_TIMEOUT, isCapacityError, isNonRetryableBodyError, isTooBigError, MAX_RETRY_DELAY } from "./kiro-retry.js";

const eventStreamMarshaller = new UniversalEventStreamMarshaller({
  utf8Encoder: (input: Uint8Array) => new TextDecoder().decode(input),
  utf8Decoder: (input: string) => new TextEncoder().encode(input),
});

interface KiroRequest {
  conversationState: {
    chatTriggerType: "MANUAL";
    agentTaskType: "vibe";
    conversationId: string;
    currentMessage: { userInputMessage: KiroUserInputMessage };
    history?: KiroHistoryEntry[];
  };
  additionalModelRequestFields?: KiroAdditionalModelRequestFields;
  profileArn: string;
  agentMode?: string;
}

interface KiroToolCallState {
  toolUseId: string;
  name: string;
  input: string;
}

function emitToolCall(
  state: KiroToolCallState,
  output: AssistantMessage,
  stream: AssistantMessageEventStream,
): boolean {
  if (!state.input.trim()) state.input = "{}";
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(state.input) as Record<string, unknown>;
  } catch {
    return false;
  }
  const contentIndex = output.content.length;
  const toolCall: ToolCall = { type: "toolCall", id: state.toolUseId, name: state.name, arguments: args };
  output.content.push(toolCall);
  stream.push({ type: "toolcall_start", contentIndex, partial: output });
  stream.push({ type: "toolcall_delta", contentIndex, delta: state.input, partial: output });
  stream.push({ type: "toolcall_end", contentIndex, toolCall, partial: output });
  return true;
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  });
}

export function streamKiro(
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const StreamCtor = (PiAi as any).AssistantMessageEventStream as new () => AssistantMessageEventStream;
  const stream = new StreamCtor();
  (async () => {
    const output: AssistantMessage = {
      role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "stop", timestamp: Date.now(),
    };
    try {
      const accessToken = options?.apiKey;
      if (!accessToken) throw new Error("Kiro credentials not set. Run /login kiro or install kiro-cli.");
      const modelMetadata = model as Model<Api> & { kiroModelId?: string; kiroRegion?: string; kiroProfileArn?: string; additionalModelRequestFieldsSchema?: Record<string, unknown> };
      const region = modelMetadata.kiroRegion ?? getKiroRegionFromEndpoint(model.baseUrl) ?? "us-east-1";
      const endpoint = new URL("generateAssistantResponse", getKiroEndpoints(region).runtime).toString();
      const profileArn = modelMetadata.kiroProfileArn || "arn:aws:codewhisperer:us-east-1:000000000000:profile/default";

      // Background models cache refresh
      if (isCacheStale(region)) {
        updateKiroModelsCache(accessToken, region, profileArn).catch(() => {});
      }

      const kiroModelId = resolveKiroModel(model.id, modelMetadata.kiroModelId);
      const effortConfig = getKiroEffortConfig(modelMetadata.additionalModelRequestFieldsSchema, kiroModelId);
      const additionalModelRequestFields = buildKiroAdditionalModelRequestFields(modelMetadata, kiroModelId, options?.reasoning);
      const thinkingEnabled = !!options?.reasoning || model.reasoning;

      let systemPrompt = context.systemPrompt ?? "";
      if (thinkingEnabled && effortConfig?.field !== "reasoning") {
        const budget = options?.reasoning === "xhigh" ? 50000 : options?.reasoning === "high" ? 30000 : options?.reasoning === "medium" ? 20000 : 10000;
        systemPrompt = `<thinking_mode>enabled</thinking_mode><max_thinking_length>${budget}</max_thinking_length>${systemPrompt ? `\n${systemPrompt}` : ""}`;
      }

      let retryCount = 0;
      const maxRetries = 3;
      const conversationId = options?.sessionId ?? crypto.randomUUID();

      while (retryCount <= maxRetries) {
        if (options?.signal?.aborted) throw options.signal.reason;
        const normalized = normalizeMessages(context.messages);
        const { history: rawHistory, systemPrepended, currentMsgStartIdx } = buildHistory(normalized, kiroModelId, systemPrompt);

        const currentMessages = normalized.slice(currentMsgStartIdx);
        const firstMsg = currentMessages[0];
        let currentContent = "";
        const currentToolResults: KiroToolResult[] = [];
        let currentImages: KiroImage[] | undefined;

        if (firstMsg?.role === "assistant") {
          for (let i = 1; i < currentMessages.length; i++) {
            const m = currentMessages[i];
            if (m.role === "toolResult") {
              const trm = m as ToolResultMessage;
              currentToolResults.push({
                content: [{ text: truncate(getContentText(m), TOOL_RESULT_LIMIT) }],
                status: trm.isError ? "error" : "success",
                toolUseId: trm.toolCallId,
              });
            }
          }
          currentContent = "";
        } else if (firstMsg?.role === "toolResult") {
          for (const m of currentMessages) {
            if (m.role === "toolResult") {
              const trm = m as ToolResultMessage;
              currentToolResults.push({
                content: [{ text: truncate(getContentText(m), TOOL_RESULT_LIMIT) }],
                status: trm.isError ? "error" : "success",
                toolUseId: trm.toolCallId,
              });
            }
          }
          currentContent = "";
        } else if (firstMsg?.role === "user") {
          currentContent = typeof firstMsg.content === "string" ? firstMsg.content : getContentText(firstMsg);
          if (systemPrompt && !systemPrepended) currentContent = `${systemPrompt}\n\n${currentContent}`;
        }

        if (currentContent === "" && currentToolResults.length === 0) currentContent = EMPTY_CONTENT_PLACEHOLDER;

        const baseTools = context.tools?.length ? convertToolsToKiro(context.tools) : [];
        let uimc: { toolResults?: KiroToolResult[]; tools?: KiroToolSpec[] } | undefined;
        if (currentToolResults.length > 0 || baseTools.length > 0) {
          uimc = {};
          if (currentToolResults.length > 0) uimc.toolResults = currentToolResults;
          if (baseTools.length > 0) uimc.tools = baseTools;
        }

        if (firstMsg?.role === "user") {
          const imgs = extractImages(firstMsg);
          if (imgs.length > 0) currentImages = convertImagesToKiro(imgs as { mimeType: string; data: string }[]);
        }

        const request: KiroRequest = {
          conversationState: {
            chatTriggerType: "MANUAL",
            agentTaskType: "vibe",
            conversationId,
            currentMessage: {
              userInputMessage: {
                content: sanitizeSurrogates(currentContent),
                modelId: kiroModelId,
                origin: "KIRO_CLI",
                ...(currentImages ? { images: currentImages } : {}),
                ...(uimc ? { userInputMessageContext: uimc } : {}),
              },
            },
            ...(rawHistory.length > 0 ? { history: rawHistory } : {}),
          },
          ...(additionalModelRequestFields ? { additionalModelRequestFields } : {}),
          profileArn,
          agentMode: "vibe",
        };

        let response: Response;
        let capacityRetryCount = 0;

        while (true) {
          const mid = crypto.randomUUID().replace(/-/g, "");
          const ua = `aws-sdk-rust/1.0.0 ua/2.1 os/other lang/rust api/codewhispererstreaming#1.28.3 m/E app/AmazonQ-For-CLI md/appVersion-1.28.3-${mid}`;

          response = await fetch(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/vnd.amazon.eventstream",
              Authorization: `Bearer ${accessToken}`,
              "x-amzn-codewhisperer-optout": "true",
              "amz-sdk-invocation-id": crypto.randomUUID(),
              "amz-sdk-request": "attempt=1; max=1",
              "x-amzn-kiro-agent-mode": "vibe",
              "x-amz-user-agent": ua,
              "user-agent": ua,
            },
            body: JSON.stringify(request),
            signal: options?.signal,
          });

          if (!response.ok) {
            let errText = "";
            try { errText = await response.text(); } catch { errText = ""; }

            if (isCapacityError(errText) && capacityRetryCount < capacityRetryConfig.maxRetries) {
              capacityRetryCount++;
              const delayMs = exponentialBackoff(capacityRetryCount - 1, capacityRetryConfig.baseDelayMs, 30_000);
              await abortableDelay(delayMs, options?.signal);
              continue;
            }

            if (isNonRetryableBodyError(errText) || isCapacityError(errText)) {
              throw new Error(`Kiro API error: ${errText || response.statusText}`);
            }
            if (isTooBigError(response.status, errText)) {
              throw new Error(`Kiro API error: context_length_exceeded (${response.status} ${errText})`);
            }
            if (response.status === 403 && retryCount < maxRetries) {
              retryCount++;
              const delayMs = exponentialBackoff(retryCount - 1, 500, MAX_RETRY_DELAY);
              await abortableDelay(delayMs, options?.signal);
              break;
            }
            throw new Error(`Kiro API error: ${response.status} ${response.statusText} ${errText}`);
          }
          break;
        }

        if (!response.ok) continue;
        stream.push({ type: "start", partial: output });

        if (!response.body) throw new Error("No response body");
        const bodyReader = (response.body as unknown as ReadableStream<Uint8Array>).getReader();
        let totalContent = "";
        let lastContentData = "";
        let usageEvent: { inputTokens?: number; outputTokens?: number } | null = null;
        let receivedContextUsage = false;
        const thinkingParser = thinkingEnabled ? new ThinkingTagParser(output, stream) : null;
        let textBlockIndex: number | null = null;
        let emittedToolCalls = 0;
        let sawAnyToolCalls = false;
        let currentToolCall: KiroToolCallState | null = null;
        let gotFirstToken = false;
        let firstTokenTimedOut = false;
        let streamError: string | null = null;
        const FIRST_TOKEN_SENTINEL = Symbol("firstTokenTimeout");

        const bodyIterable: AsyncIterable<Uint8Array> = {
          async *[Symbol.asyncIterator]() {
            try {
              while (true) { const { done, value } = await bodyReader.read(); if (done) return; yield value; }
            } finally { bodyReader.releaseLock(); }
          },
        };
        const utf8Decoder = new TextDecoder();
        const eventStream = eventStreamMarshaller.deserialize(bodyIterable, async (event: Record<string, Message>) => {
          const entry = Object.entries(event)[0];
          if (!entry) throw new Error("Received an empty event stream message");
          const [key, msg] = entry;
          const parsed = JSON.parse(utf8Decoder.decode(msg.body)) as Record<string, unknown>;
          return { [key]: parsed } as Record<string, unknown>;
        });
        const iterator = eventStream[Symbol.asyncIterator]() as AsyncIterator<Record<string, unknown>>;

        while (true) {
          let iterResult: IteratorResult<Record<string, unknown>>;
          try {
            if (!gotFirstToken) {
              const readPromise = iterator.next();
              const result = await Promise.race([
                readPromise,
                new Promise<typeof FIRST_TOKEN_SENTINEL>((resolve) => setTimeout(() => resolve(FIRST_TOKEN_SENTINEL), FIRST_TOKEN_TIMEOUT)),
              ]);
              if (result === FIRST_TOKEN_SENTINEL) {
                readPromise.catch(() => {});
                void bodyReader.cancel().catch(() => {});
                firstTokenTimedOut = true;
                break;
              }
              iterResult = result as IteratorResult<Record<string, unknown>>;
              gotFirstToken = true;
            } else {
              iterResult = await iterator.next();
            }
          } catch (e) {
            streamError = e instanceof Error ? e.message : String(e) || "Unknown stream error";
            break;
          }
          const { done, value } = iterResult;
          if (done) break;
          const eventPayload = Object.values(value as Record<string, unknown>)[0] as Record<string, unknown>;
          const event = parseKiroEvent(eventPayload);
          if (!event) continue;

          switch (event.type) {
            case "contextUsage": {
              const pct = event.data.contextUsagePercentage;
              output.usage.input = Math.round((pct / 100) * model.contextWindow);
              (output.usage as unknown as Record<string, unknown>).contextPercent = pct;
              receivedContextUsage = true;
              break;
            }
            case "thinkingText": {
              if (!thinkingEnabled) break;
              if (thinkingParser) {
                thinkingParser.processChunk(event.data);
              }
              break;
            }
            case "thinkingSignature": {
              if (!thinkingEnabled || !thinkingParser) break;
              thinkingParser.finalize();
              break;
            }
            case "content": {
              if (event.data === lastContentData) continue;
              lastContentData = event.data;
              totalContent += event.data;
              if (thinkingParser) {
                thinkingParser.processChunk(event.data);
              } else {
                if (textBlockIndex === null) {
                  textBlockIndex = output.content.length;
                  output.content.push({ type: "text", text: "" });
                  stream.push({ type: "text_start", contentIndex: textBlockIndex, partial: output });
                }
                (output.content[textBlockIndex] as TextContent).text += event.data;
                stream.push({ type: "text_delta", contentIndex: textBlockIndex, delta: event.data, partial: output });
              }
              break;
            }
            case "toolUse": {
              const tc = event.data;
              sawAnyToolCalls = true;
              if (!currentToolCall || currentToolCall.toolUseId !== tc.toolUseId) {
                if (currentToolCall) { if (emitToolCall(currentToolCall, output, stream)) emittedToolCalls++; }
                currentToolCall = { toolUseId: tc.toolUseId, name: tc.name, input: "" };
              }
              currentToolCall.input += tc.input || "";
              if (tc.input) totalContent += tc.input;
              if (tc.stop) { if (currentToolCall) { if (emitToolCall(currentToolCall, output, stream)) emittedToolCalls++; } currentToolCall = null; }
              break;
            }
            case "toolUseInput": {
              if (currentToolCall) currentToolCall.input += event.data.input || "";
              if (event.data.input) totalContent += event.data.input;
              break;
            }
            case "toolUseStop": {
              if (event.data.stop && currentToolCall) { if (emitToolCall(currentToolCall, output, stream)) emittedToolCalls++; currentToolCall = null; }
              break;
            }
            case "usage": {
              usageEvent = event.data;
              break;
            }
            case "error": {
              streamError = event.data.message ? `${event.data.error}: ${event.data.message}` : event.data.error;
              void bodyReader.cancel().catch(() => {});
              break;
            }
          }
          if (streamError) break;
        }

        if (firstTokenTimedOut || streamError) {
          if (retryCount < maxRetries) {
            retryCount++;
            const delayMs = exponentialBackoff(retryCount - 1, 1000, MAX_RETRY_DELAY);
            await abortableDelay(delayMs, options?.signal);
            continue;
          }
          if (streamError) throw new Error(`Kiro API stream error after max retries: ${streamError}`);
          throw new Error(`Kiro API error: first token timeout after max retries`);
        }

        if (currentToolCall) { if (emitToolCall(currentToolCall, output, stream)) emittedToolCalls++; }
        if (thinkingParser) {
          thinkingParser.finalize();
          textBlockIndex = thinkingParser.getTextBlockIndex();
        }

        if (textBlockIndex !== null) {
          stream.push({ type: "text_end", contentIndex: textBlockIndex, content: (output.content[textBlockIndex] as TextContent).text, partial: output });
        }

        if (usageEvent?.inputTokens !== undefined) output.usage.input = usageEvent.inputTokens;
        output.usage.output = usageEvent?.outputTokens ?? totalContent.length;
        output.usage.totalTokens = output.usage.input + output.usage.output;
        output.usage.cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };

        output.stopReason = emittedToolCalls > 0 ? "toolUse" : receivedContextUsage ? "stop" : "length";
        stream.push({ type: "done", reason: output.stopReason as "stop" | "toolUse", message: output });
        stream.end();
        break;
      }
    } catch (error) {
      output.stopReason = options?.signal?.aborted ? "aborted" : "error";
      output.errorMessage = error instanceof Error ? error.message : String(error);
      stream.push({ type: "error", reason: output.stopReason, error: output });
      stream.end();
    }
  })().catch(() => { try { stream.end(); } catch {} });
  return stream;
}