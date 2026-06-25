/**
 * Streaming parser for HTML-style thinking tags in LLM responses.
 *
 * Some providers (Qoder, DeepSeek via certain gateways) emit reasoning in
 * HTML-style tags like <thinking>, <think>, <reasoning>, <thought> within
 * the text stream, rather than via a structured reasoning_content field.
 *
 * This parser handles streaming chunks safely — it never emits partial tags
 * by tracking trailing tag prefixes and deferring output until the boundary
 * is clear.
 */

import type {
	AssistantMessage,
	AssistantMessageEventStream,
	TextContent,
	ThinkingContent,
} from "@earendil-works/pi-ai";

const THINKING_TAG_VARIANTS: Array<{ open: string; close: string }> = [
	{ open: "<thinking>", close: "</thinking>" },
	{ open: "<think>", close: "</think>" },
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

function getMaxTrailingPossibleTagPrefixLength(
	text: string,
	tags: string[],
): number {
	let maxLength = 0;
	for (const tag of tags) {
		maxLength = Math.max(
			maxLength,
			getTrailingPossibleTagPrefixLength(text, tag),
		);
	}
	return maxLength;
}

/**
 * Streaming parser that extracts <thinking>/<think>/<reasoning>/<thought> tags
 * from a text stream and emits them as thinking_start/thinking_delta/thinking_end
 * events on the Pi event stream.
 *
 * Usage:
 * ```ts
 * const parser = new ThinkingTagParser(output, stream);
 * for (const chunk of textChunks) {
 *   parser.processChunk(chunk);
 * }
 * parser.finalize();
 * ```
 */
export class ThinkingTagParser {
	private textBuffer = "";
	private inThinking = false;
	private thinkingBlockIndex: number | null = null;
	private textBlockIndex: number | null = null;
	private activeEndTag = "";

	constructor(
		private readonly output: AssistantMessage,
		private readonly stream: AssistantMessageEventStream,
	) {
		// Set initial active end tag to the first variant's close
		this.activeEndTag = THINKING_TAG_VARIANTS[0]!.close;
	}

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
			const block = this.output.content[
				this.thinkingBlockIndex
			] as ThinkingContent;
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

	/** Get the index of the final text block (after thinking, or null if none) */
	getTextBlockIndex(): number | null {
		return this.textBlockIndex;
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
			this.textBuffer = this.textBuffer.slice(
				bestPos + bestVariant.open.length,
			);
			this.activeEndTag = bestVariant.close;
			this.inThinking = true;
			return;
		}

		// No thinking tag found yet, but the buffer might end with a partial tag
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
			if (this.thinkingBlockIndex !== null) {
				const block = this.output.content[
					this.thinkingBlockIndex
				] as ThinkingContent;
				this.stream.push({
					type: "thinking_end",
					contentIndex: this.thinkingBlockIndex,
					content: block.thinking,
					partial: this.output,
				});
			}
			this.textBuffer = this.textBuffer.slice(
				endPos + this.activeEndTag.length,
			);
			this.inThinking = false;
			this.thinkingBlockIndex = null;
			this.textBlockIndex = null;
			if (this.textBuffer.startsWith("\n\n"))
				this.textBuffer = this.textBuffer.slice(2);
			return;
		}

		// Buffer might end with a partial close tag
		const trailingPrefixLength = getTrailingPossibleTagPrefixLength(
			this.textBuffer,
			this.activeEndTag,
		);
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
			this.output.content.push({ type: "text", text: "" } as TextContent);
			this.stream.push({
				type: "text_start",
				contentIndex: this.textBlockIndex,
				partial: this.output,
			});
		}
		const block = this.output.content[this.textBlockIndex] as TextContent;
		block.text += text;
		this.stream.push({
			type: "text_delta",
			contentIndex: this.textBlockIndex,
			delta: text,
			partial: this.output,
		});
	}

	private emitThinking(thinking: string): void {
		if (thinking.length === 0) return;
		if (this.thinkingBlockIndex === null) {
			if (this.textBlockIndex === null) {
				this.thinkingBlockIndex = this.output.content.length;
				this.output.content.push({
					type: "thinking",
					thinking: "",
				} as ThinkingContent);
			} else {
				// Insert thinking block before the existing text block
				this.thinkingBlockIndex = this.textBlockIndex;
				this.output.content.splice(this.thinkingBlockIndex, 0, {
					type: "thinking",
					thinking: "",
				} as ThinkingContent);
				this.textBlockIndex = this.textBlockIndex + 1;
			}
			this.stream.push({
				type: "thinking_start",
				contentIndex: this.thinkingBlockIndex,
				partial: this.output,
			});
		}
		const block = this.output.content[
			this.thinkingBlockIndex
		] as ThinkingContent;
		block.thinking += thinking;
		this.stream.push({
			type: "thinking_delta",
			contentIndex: this.thinkingBlockIndex,
			delta: thinking,
			partial: this.output,
		});
	}
}
