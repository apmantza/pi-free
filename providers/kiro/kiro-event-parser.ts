/**
 * Kiro stream event type definitions and JSON-to-typed-event mapping.
 *
 * Ported from the reference implementation's event-parser.ts.
 * Binary framing is handled by @smithy/core EventStreamMarshaller in stream.ts.
 */

export type KiroStreamEvent =
  | { type: "content"; data: string }
  | { type: "thinkingText"; data: string }
  | { type: "thinkingSignature"; data: string }
  | { type: "toolUse"; data: { name: string; toolUseId: string; input: string; stop?: boolean } }
  | { type: "toolUseInput"; data: { input: string } }
  | { type: "toolUseStop"; data: { stop: boolean } }
  | { type: "contextUsage"; data: { contextUsagePercentage: number } }
  | { type: "followupPrompt"; data: string }
  | { type: "usage"; data: { inputTokens?: number; outputTokens?: number } }
  | { type: "error"; data: { error: string; message?: string } };

export function parseKiroEvent(parsed: Record<string, unknown>): KiroStreamEvent | null {
  if (parsed.content !== undefined) return { type: "content", data: parsed.content as string };
  if (typeof parsed.text === "string") return { type: "thinkingText", data: parsed.text };
  if (typeof parsed.signature === "string") return { type: "thinkingSignature", data: parsed.signature };
  if (parsed.name && parsed.toolUseId) {
    const input =
      typeof parsed.input === "string"
        ? parsed.input
        : parsed.input && typeof parsed.input === "object" && Object.keys(parsed.input as Record<string, unknown>).length > 0
          ? JSON.stringify(parsed.input)
          : "";
    return {
      type: "toolUse",
      data: {
        name: parsed.name as string,
        toolUseId: parsed.toolUseId as string,
        input,
        stop: parsed.stop as boolean | undefined,
      },
    };
  }
  if (parsed.input !== undefined && !parsed.name) {
    return {
      type: "toolUseInput",
      data: { input: typeof parsed.input === "string" ? parsed.input : JSON.stringify(parsed.input) },
    };
  }
  if (parsed.stop !== undefined && parsed.contextUsagePercentage === undefined)
    return { type: "toolUseStop", data: { stop: parsed.stop as boolean } };
  if (parsed.contextUsagePercentage !== undefined)
    return { type: "contextUsage", data: { contextUsagePercentage: parsed.contextUsagePercentage as number } };
  if (parsed.followupPrompt !== undefined) return { type: "followupPrompt", data: parsed.followupPrompt as string };
  if (parsed.error !== undefined || parsed.Error !== undefined) {
    const error = (parsed.error || parsed.Error || "unknown") as string;
    const message = (parsed.message || parsed.Message || parsed.reason) as string | undefined;
    return { type: "error", data: { error: typeof error === "string" ? error : JSON.stringify(error), message } };
  }
  if (parsed.usage !== undefined) {
    const u = parsed.usage as Record<string, unknown>;
    return {
      type: "usage",
      data: { inputTokens: u.inputTokens as number | undefined, outputTokens: u.outputTokens as number | undefined },
    };
  }
  return null;
}