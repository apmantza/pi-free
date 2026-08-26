/**
 * Stateful parser for thinking tags in streaming content.
 *
 * Ported from the reference implementation's thinking-parser.ts.
 * Separates thinking blocks from text, supporting multiple tag variants.
 */
import type { AssistantMessage, AssistantMessageEventStream, TextContent, ThinkingContent } from "@earendil-works/pi-ai";

export const THINKING_START_TAG = "<thinking>";
export const THINKING_END_TAG = "</thinking>";

const THINKING_TAG_VARIANTS: Array<{ open: string; close: string }> = [
  { open: "<thinking>", close: "</thinking>" },
  { open: " thinking", close: " response" },
  { open: "<reasoning>", close: "</reasoning>" },
  { open: "<thought>", close: "</thought>" },
];

function getTrailingPossibleTagPrefixLength(text: string, tag: string): number {
  const maxPrefixLength = Math.min(text.length, tag.length - 1);
  for (let len = maxPrefixLength; len > 0; len--) {
    if (text.endsWith(tag.slice(0, len))) return len;
  }
  return 0;
}

function getMaxTrailingPossibleTagPrefixLength(text: string, tags: string[]): number {
  let maxLength = 0;
  for (const tag of tags) {
    maxLength = Math.max(maxLength, getTrailingPossibleTagPrefixLength(text, tag));
  }
  return maxLength;
}

export class ThinkingTagParser {
  private textBuffer = "";
  private inThinking = false;
  private thinkingBlockIndex: number | null = null;
  private textBlockIndex: number | null = null;
  private lastTextBlockIndex: number | null = null;
  private activeEndTag: string = THINKING_END_TAG;

  constructor(
    private output: AssistantMessage,
    private stream: AssistantMessageEventStream,
  ) {}

  processChunk(chunk: string): void {
    this.textBuffer += chunk;
    while (this.textBuffer.length > 0) {
      const prevLength = this.textBuffer.length;
      if (!this.inThinking) {
        this.processBeforeThinking();
        if (this.textBuffer.length === 0) break;
      }
      if (this.inThinking) {
        this.processInsideThinking();
        if (this.textBuffer.length === 0) break;
      }
      if (this.textBuffer.length >= prevLength) break;
    }
  }

  finalize(): void {
    if (this.textBuffer.length === 0) return;
    if (this.inThinking && this.thinkingBlockIndex !== null) {
      const block = this.output.content[this.thinkingBlockIndex] as ThinkingContent;
      block.thinking += this.textBuffer;
      this.stream.push({
        type: "thinking_delta",
        contentIndex: this.thinkingBlockIndex,
        delta: this.textBuffer,
        partial: this.output,
      });
      this.stream.push({
        type: "thinking_end",
        contentIndex: this.thinkingBlockIndex,
        content: block.thinking,
        partial: this.output,
      });
    } else {
      this.emitText(this.textBuffer);
    }
    this.textBuffer = "";
  }

  getTextBlockIndex(): number | null {
    return this.textBlockIndex ?? this.lastTextBlockIndex;
  }

  private processBeforeThinking(): void {
    let bestPos = -1;
    let bestVariant: (typeof THINKING_TAG_VARIANTS)[number] | null = null;
    for (const variant of THINKING_TAG_VARIANTS) {
      const pos = this.textBuffer.indexOf(variant.open);
      if (pos !== -1 && (bestPos === -1 || pos < bestPos)) {
        bestPos = pos;
        bestVariant = variant;
      }
    }
    if (bestPos !== -1 && bestVariant) {
      if (bestPos > 0) this.emitText(this.textBuffer.slice(0, bestPos));
      this.textBuffer = this.textBuffer.slice(bestPos + bestVariant.open.length);
      this.activeEndTag = bestVariant.close;
      this.inThinking = true;
      return;
    }

    const trailingPrefixLength = getMaxTrailingPossibleTagPrefixLength(
      this.textBuffer,
      THINKING_TAG_VARIANTS.map((variant) => variant.open),
    );
    const safeLen = this.textBuffer.length - trailingPrefixLength;
    if (safeLen > 0) {
      this.emitText(this.textBuffer.slice(0, safeLen));
      this.textBuffer = this.textBuffer.slice(safeLen);
    }
  }

  private processInsideThinking(): void {
    const endPos = this.textBuffer.indexOf(this.activeEndTag);
    if (endPos !== -1) {
      if (endPos > 0) this.emitThinking(this.textBuffer.slice(0, endPos));
      const thinkingBlockIndex = this.ensureThinkingBlock();
      const block = this.output.content[thinkingBlockIndex] as ThinkingContent;
      this.stream.push({
        type: "thinking_end",
        contentIndex: thinkingBlockIndex,
        content: block.thinking,
        partial: this.output,
      });
      this.textBuffer = this.textBuffer.slice(endPos + this.activeEndTag.length);
      this.inThinking = false;
      this.thinkingBlockIndex = null;
      this.activeEndTag = THINKING_END_TAG;
      if (this.textBlockIndex !== null) this.lastTextBlockIndex = this.textBlockIndex;
      this.textBlockIndex = null;
      if (this.textBuffer.startsWith("\n\n")) this.textBuffer = this.textBuffer.slice(2);
      return;
    }

    const trailingPrefixLength = getTrailingPossibleTagPrefixLength(this.textBuffer, this.activeEndTag);
    const safeLen = this.textBuffer.length - trailingPrefixLength;
    if (safeLen > 0) {
      this.emitThinking(this.textBuffer.slice(0, safeLen));
      this.textBuffer = this.textBuffer.slice(safeLen);
    }
  }

  private emitText(text: string): void {
    if (!text) return;
    if (this.textBlockIndex === null) {
      this.textBlockIndex = this.output.content.length;
      this.output.content.push({ type: "text", text: "" });
      this.stream.push({ type: "text_start", contentIndex: this.textBlockIndex, partial: this.output });
    }
    const block = this.output.content[this.textBlockIndex] as TextContent;
    block.text += text;
    this.stream.push({ type: "text_delta", contentIndex: this.textBlockIndex, delta: text, partial: this.output });
  }

  private ensureThinkingBlock(): number {
    if (this.thinkingBlockIndex !== null) return this.thinkingBlockIndex;
    this.thinkingBlockIndex = this.output.content.length;
    this.output.content.push({ type: "thinking", thinking: "" });
    this.stream.push({ type: "thinking_start", contentIndex: this.thinkingBlockIndex, partial: this.output });
    return this.thinkingBlockIndex;
  }

  private emitThinking(thinking: string): void {
    if (!thinking) return;
    const thinkingBlockIndex = this.ensureThinkingBlock();
    const block = this.output.content[thinkingBlockIndex] as ThinkingContent;
    block.thinking += thinking;
    this.stream.push({
      type: "thinking_delta",
      contentIndex: thinkingBlockIndex,
      delta: thinking,
      partial: this.output,
    });
  }
}