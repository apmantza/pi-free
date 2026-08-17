/**
 * TokenRouter Provider Extension
 *
 * TokenRouter is an OpenAI-compatible API gateway routing to 90+ models
 * across multiple providers (OpenAI, Anthropic, Google, DeepSeek, Qwen, etc.).
 *
 * API: https://api.tokenrouter.com/v1
 * Models: /v1/models
 *
 * Setup:
 *   TOKENROUTER_API_KEY=sk-...
 *   # or add tokenrouter_api_key to ~/.pi/free.json
 *
 * Wire protocol: TokenRouter speaks vanilla OpenAI Chat Completions, so this
 * is a standard OpenAI-compatible native provider registered through the
 * shared `registerNativeOpenAIProvider()` path (like Cline and B.AI) — the
 * models use the standard `"openai-completions"` api and stream through
 * pi-ai's native implementation via the lazy compat bridge. No custom API
 * type, no payload-patching streaming wrapper.
 *
 * TokenRouter-specific behaviors are thin seams on the standard provider:
 *  - Model compat: the shared `getProxyModelCompat` (same as Cline/B.AI, so
 *    `requiresReasoningContentOnAssistantMessages` keeps replaying
 *    `reasoning_content` across turns) with `supportsReasoningEffort`
 *    explicitly disabled — TokenRouter's chat-completions route rejects a
 *    top-level `reasoning_effort` (`400: reasoning_effort must be low,
 *    medium, or xhigh`). The strip is re-applied after models.dev enrichment
 *    so the flag can never be re-derived.
 *  - MiniMax-M3 (`before_provider_request`): requires `thinking: { type:
 *    "adaptive" }` — pi's `{ type: "enabled" }` is rewritten to adaptive.
 *  - MiniMax-M3 (`message_end`): sometimes emits DeepSeek-style inline
 *    ` thinking ... response` tags in the assistant text; they are extracted
 *    into proper ThinkingContent blocks.
 *  - High-load retry (`stream`/`streamSimple`): DeepSeek-family models can
 *    hard-fail on upstream 2064 ("server cluster is currently under high
 *    load"); the stream wrapper retries once after a 30s backoff before any
 *    output has been flushed. The wrapper delegates to the lazy compat
 *    bridge — it is not a custom wire implementation.
 */

import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import type {
	Api,
	AssistantMessage,
	AssistantMessageEvent,
	AssistantMessageEventStream,
	Model,
	ProviderStreams,
	StreamOptions,
	ThinkingContent,
} from "@earendil-works/pi-ai/compat";
import { createAssistantMessageEventStream } from "../../lib/assistant-message-event-stream.ts";
import {
	getTokenrouterApiKey,
	getTokenrouterShowPaid,
	applyHidden,
} from "../../config.ts";
import {
	BASE_URL_TOKENROUTER,
	DEFAULT_FETCH_TIMEOUT_MS,
	PROVIDER_TOKENROUTER,
} from "../../constants.ts";
import { createLogger } from "../../lib/logger.ts";
import { lazyOpenAICompletionsApi } from "../../lib/lazy-compat.ts";
import { safeEnrichModelsWithModelsDev } from "../../lib/model-metadata.ts";
import {
	createNativeOpenAIProvider,
	registerNativeOpenAIProvider,
	type NativeOpenAIProviderOptions,
} from "../../lib/native-provider.ts";
import {
	getProxyModelCompat,
	isLikelyReasoningModel,
} from "../../lib/provider-compat.ts";
import { cleanModelName, fetchWithRetry } from "../../lib/util.ts";
import { tokenRouterAuth } from "./tokenrouter-auth.ts";

const _logger = createLogger("tokenrouter");

// =============================================================================
// MiniMax reasoning cleanup
// TokenRouter's MiniMax-M3 model sometimes emits DeepSeek-style ` thinking`
// reasoning tags inline in the assistant text. Pi does not strip them, so we
// extract them into proper ThinkingContent blocks on message_end.
// =============================================================================

interface ExtractedThinking {
	text: string;
	thinking: string;
}

function collapseWhitespace(text: string): string {
	return text
		.replace(/\r\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.replace(/[ \t]+/g, " ")
		.trim();
}

function extractThinkBlocks(text: string): ExtractedThinking {
	const openTag = " thinking";
	const closeTag = " response";
	const thinkingParts: string[] = [];
	const textParts: string[] = [];
	let cursor = 0;

	while (cursor < text.length) {
		const openStart = text.indexOf(openTag, cursor);
		if (openStart === -1) {
			textParts.push(text.slice(cursor));
			break;
		}

		textParts.push(text.slice(cursor, openStart));
		const valueStart = openStart + openTag.length;
		const closeStart = text.indexOf(closeTag, valueStart);
		if (closeStart === -1) {
			// Unclosed think tag: treat remainder as thinking.
			thinkingParts.push(text.slice(valueStart));
			break;
		}

		thinkingParts.push(text.slice(valueStart, closeStart));
		cursor = closeStart + closeTag.length;
	}

	return {
		text: collapseWhitespace(textParts.join("")),
		thinking: collapseWhitespace(thinkingParts.join("\n\n")),
	};
}

export function isTokenRouterMinimaxModel(modelId: string): boolean {
	return modelId.toLowerCase().includes("minimax");
}

export function normalizeAssistantMessage(
	message: AssistantMessage,
): AssistantMessage {
	const newContent: AssistantMessage["content"] = [];
	let extractedThinking = "";

	for (const block of message.content) {
		if (block.type !== "text") {
			newContent.push(block);
			continue;
		}

		const extracted = extractThinkBlocks(block.text);
		if (extracted.thinking) {
			extractedThinking = extractedThinking
				? `${extractedThinking}\n\n${extracted.thinking}`
				: extracted.thinking;
		}
		if (extracted.text) {
			newContent.push({ ...block, text: extracted.text });
		}
	}

	if (extractedThinking) {
		newContent.push({
			type: "thinking",
			thinking: extractedThinking,
		} as ThinkingContent);
	}

	return { ...message, content: newContent };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function containsTokenRouterMinimaxModel(value: unknown): boolean {
	if (Array.isArray(value)) {
		return value.some(containsTokenRouterMinimaxModel);
	}
	if (!isRecord(value)) return false;

	for (const [key, child] of Object.entries(value)) {
		if (key === "model" && isTokenRouterMinimaxModel(String(child ?? ""))) {
			return true;
		}
		if (containsTokenRouterMinimaxModel(child)) return true;
	}
	return false;
}

function patchThinkingType(value: unknown): {
	value: unknown;
	changed: boolean;
} {
	if (Array.isArray(value)) {
		let changed = false;
		const patched = value.map((child) => {
			const result = patchThinkingType(child);
			changed ||= result.changed;
			return result.value;
		});
		return changed ? { value: patched, changed } : { value, changed: false };
	}
	if (!isRecord(value)) return { value, changed: false };

	let changed = false;
	const patched: Record<string, unknown> = {};
	for (const [key, child] of Object.entries(value)) {
		let next = patchThinkingType(child).value;
		if (key === "thinking" && isRecord(next) && next.type === "enabled") {
			next = { ...next, type: "adaptive" };
			changed = true;
		} else {
			changed ||= next !== child;
		}
		patched[key] = next;
	}

	return changed ? { value: patched, changed } : { value, changed: false };
}

export function patchTokenRouterMinimaxThinkingPayload(
	payload: unknown,
	force = false,
): unknown {
	if (typeof payload === "string") {
		try {
			const parsed = JSON.parse(payload) as unknown;
			const patched = patchTokenRouterMinimaxThinkingPayload(parsed, force);
			return patched === parsed ? payload : JSON.stringify(patched);
		} catch {
			return payload;
		}
	}

	if (!force && !containsTokenRouterMinimaxModel(payload)) return payload;
	const result = patchThinkingType(payload);
	return result.changed ? result.value : payload;
}

// =============================================================================
// 2064 high-load retry
// DeepSeek-family models through TokenRouter can hard-fail with upstream
// 2064 ("server cluster is currently under high load"). When the stream
// errors before any output, retry once after a 30s backoff (honoring the
// request signal). This is a thin wrapper around the lazy compat bridge —
// the wire implementation stays pi-ai's standard openai-completions path.
// =============================================================================

export const TOKENROUTER_HIGH_LOAD_RETRY_DELAY_MS = 30_000;

export function isTokenRouterHighLoadError(
	message: string | undefined,
): boolean {
	const lower = (message ?? "").toLowerCase();
	return (
		lower.includes("(2064)") ||
		lower.includes("server cluster is currently under high load")
	);
}

function isOutputEvent(event: AssistantMessageEvent): boolean {
	return (
		event.type === "text_start" ||
		event.type === "text_delta" ||
		event.type === "text_end" ||
		event.type === "thinking_start" ||
		event.type === "thinking_delta" ||
		event.type === "thinking_end" ||
		event.type === "toolcall_start" ||
		event.type === "toolcall_delta" ||
		event.type === "toolcall_end"
	);
}

export function waitForTokenRouterRetry(
	ms: number,
	signal: AbortSignal | undefined,
): Promise<void> {
	if (signal?.aborted) return Promise.reject(new Error("aborted"));
	return new Promise((resolve, reject) => {
		const onAbort = () => {
			clearTimeout(timeout);
			reject(new Error("aborted"));
		};
		const timeout = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

function createTokenRouterRetryErrorMessage(
	model: Model<Api>,
	options: StreamOptions | undefined,
	error: unknown,
): AssistantMessage {
	return {
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
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: options?.signal?.aborted ? "aborted" : "error",
		errorMessage: error instanceof Error ? error.message : String(error),
		timestamp: Date.now(),
	};
}

export function streamWithTokenRouterHighLoadRetry(
	model: Model<Api>,
	createAttempt: () => AsyncIterable<AssistantMessageEvent>,
	options: StreamOptions | undefined,
	retryDelayMs = TOKENROUTER_HIGH_LOAD_RETRY_DELAY_MS,
): AssistantMessageEventStream {
	const output = createAssistantMessageEventStream();
	void (async () => {
		const buffer: AssistantMessageEvent[] = [];
		let flushed = false;
		let sawOutput = false;

		function flushBuffer(): void {
			if (flushed) return;
			flushed = true;
			for (const event of buffer) output.push(event);
			buffer.length = 0;
		}

		try {
			const first = createAttempt();
			let retryAfterHighLoad = false;
			for await (const event of first) {
				if (isOutputEvent(event)) {
					sawOutput = true;
					flushBuffer();
					output.push(event);
					continue;
				}

				if (
					event.type === "error" &&
					!sawOutput &&
					isTokenRouterHighLoadError(event.error.errorMessage)
				) {
					retryAfterHighLoad = true;
					break;
				}

				if (flushed) output.push(event);
				else buffer.push(event);
			}

			if (!retryAfterHighLoad) {
				flushBuffer();
				return;
			}
			_logger.warn(
				"[tokenrouter] Server cluster high load (2064); retrying once after 30s",
			);
			await waitForTokenRouterRetry(retryDelayMs, options?.signal);
			for await (const event of createAttempt()) output.push(event);
		} catch (error) {
			flushBuffer();
			const message = createTokenRouterRetryErrorMessage(model, options, error);
			output.push({
				type: "error",
				reason: message.stopReason as "error" | "aborted",
				error: message,
			});
		}
	})();
	return output as unknown as AssistantMessageEventStream;
}

/** Retry-wrapped lazy bridge streams used by every TokenRouter Provider. */
function createTokenRouterStreams(): ProviderStreams {
	const bridge = lazyOpenAICompletionsApi();
	return {
		stream: (model, context, options) =>
			streamWithTokenRouterHighLoadRetry(
				model,
				() => bridge.stream(model, context, options),
				options,
			),
		streamSimple: (model, context, options) =>
			streamWithTokenRouterHighLoadRetry(
				model,
				() => bridge.streamSimple(model, context, options),
				options,
			),
	};
}

// =============================================================================
// Compat
// TokenRouter's chat-completions route rejects a top-level `reasoning_effort`
// (400: `reasoning_effort must be low, medium, or xhigh`). The shared proxy
// compat (Cline/B.AI parity) is kept for its other flags — most importantly
// `requiresReasoningContentOnAssistantMessages`, which replays
// `reasoning_content` on later assistant turns for multi-turn reasoning —
// with only `supportsReasoningEffort` disabled.
// =============================================================================

export function withoutReasoningEffort(
	compat: ProviderModelConfig["compat"],
): ProviderModelConfig["compat"] {
	if (!compat || !("supportsReasoningEffort" in compat)) return compat;
	return { ...compat, supportsReasoningEffort: false };
}

/**
 * Re-apply the reasoning-effort strip after models.dev enrichment. Enrichment
 * re-derives proxy compat from models.dev metadata and would otherwise
 * re-inject `supportsReasoningEffort` on models that carried no base compat.
 */
export function stripEnrichedTokenRouterCompat<T extends ProviderModelConfig>(
	models: readonly T[],
): T[] {
	return models.map((model) => {
		const compat = withoutReasoningEffort(model.compat);
		return compat === model.compat ? model : { ...model, compat };
	});
}

// =============================================================================
// Types
// =============================================================================

interface TokenRouterModel {
	id: string;
	object: string;
	created: number;
	owned_by: string;
	supported_endpoint_types: string[];
	tags?: string;
}

// =============================================================================
// Helpers
// =============================================================================

/** Text-capable chat endpoints (excludes image/video/audio-only types) */
const CHAT_ENDPOINT_TYPES = new Set([
	"openai",
	"openai-response",
	"anthropic",
	"anthropic-compatible",
	"gemini",
]);

function isTextChatModel(model: TokenRouterModel): boolean {
	const tags = (model.tags ?? "").toLowerCase();
	// Exclude models whose only tags are non-text
	const nonTextTags = ["image", "video", "audio"];
	const hasNonTextTag = nonTextTags.some((t) => tags.includes(t));
	const hasTextTag = tags.includes("text");
	// If it has a text tag, include it. If only non-text tags, exclude.
	if (hasTextTag) return true;
	if (hasNonTextTag && !hasTextTag) return false;
	// No tags or empty tags: check endpoint types
	return model.supported_endpoint_types.some((t) => CHAT_ENDPOINT_TYPES.has(t));
}

export function mapTokenRouterModel(
	model: TokenRouterModel,
): ProviderModelConfig & {
	_pricingKnown?: boolean;
	_freeKnown?: boolean;
	_isFree?: boolean;
} {
	const name = cleanModelName(model.id);
	const reasoning =
		isTokenRouterMinimaxModel(model.id) ||
		isLikelyReasoningModel({ id: model.id, name });
	const isKnownFree = model.id.toLowerCase().endsWith(":free");

	return {
		id: model.id,
		name,
		reasoning,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128_000,
		maxTokens: 16_384,
		// Shared compat (Cline/B.AI parity) minus `supportsReasoningEffort`.
		compat: withoutReasoningEffort(getProxyModelCompat({ id: model.id, name })),
		// Known-free models bypass pricing detection entirely
		_freeKnown: isKnownFree,
		_isFree: isKnownFree,
		// Non-free models signal no pricing data (name-based detection only)
		_pricingKnown: false,
	} as ProviderModelConfig & { _pricingKnown?: boolean };
}

// =============================================================================
// Fetch Models
// =============================================================================

async function fetchTokenRouterModels(
	apiKey: string,
	signal?: AbortSignal,
): Promise<ProviderModelConfig[]> {
	_logger.info("[tokenrouter] Fetching models from TokenRouter API...");

	try {
		const response = await fetchWithRetry(
			`${BASE_URL_TOKENROUTER}/models`,
			{
				headers: {
					Authorization: `Bearer ${apiKey}`,
					Accept: "application/json",
					"Content-Type": "application/json",
				},
				signal,
			},
			3,
			1000,
			DEFAULT_FETCH_TIMEOUT_MS,
		);

		if (!response.ok) {
			throw new Error(`TokenRouter API error: ${response.status}`);
		}

		const json = (await response.json()) as { data?: TokenRouterModel[] };
		const models = (json.data ?? []).filter(isTextChatModel);

		_logger.info(`[tokenrouter] Fetched ${models.length} text chat models`);
		const enriched = await safeEnrichModelsWithModelsDev(
			models.map(mapTokenRouterModel),
			{ providerId: PROVIDER_TOKENROUTER },
		);
		return applyHidden(
			stripEnrichedTokenRouterCompat(enriched),
			PROVIDER_TOKENROUTER,
		);
	} catch (error) {
		// Pi may abort a superseded refresh; cancellation is not a provider error.
		if (signal?.aborted) {
			return [];
		}
		_logger.error("[tokenrouter] Failed to fetch models", {
			error: error instanceof Error ? error.message : String(error),
		});
		return [];
	}
}

// =============================================================================
// Native Provider
// =============================================================================

export function createTokenRouterProvider(
	initialModels?: ProviderModelConfig[],
) {
	const options: NativeOpenAIProviderOptions = {
		providerId: PROVIDER_TOKENROUTER,
		name: "TokenRouter",
		baseUrl: BASE_URL_TOKENROUTER,
		auth: tokenRouterAuth,
		getApiKey: getTokenrouterApiKey,
		getShowPaid: getTokenrouterShowPaid,
		fetchModels: (apiKey, signal) => fetchTokenRouterModels(apiKey, signal),
		streams: createTokenRouterStreams(),
	};
	if (initialModels) options.initialModels = initialModels;
	return createNativeOpenAIProvider(options);
}

export default function tokenRouterProvider(pi: ExtensionAPI): Promise<void> {
	registerNativeOpenAIProvider(pi, {
		providerId: PROVIDER_TOKENROUTER,
		name: "TokenRouter",
		baseUrl: BASE_URL_TOKENROUTER,
		auth: tokenRouterAuth,
		getApiKey: getTokenrouterApiKey,
		getShowPaid: getTokenrouterShowPaid,
		fetchModels: (apiKey, signal) => fetchTokenRouterModels(apiKey, signal),
		streams: createTokenRouterStreams(),
	});

	// MiniMax-M3 requires `thinking: { type: "adaptive" }`; rewrite the
	// "enabled" payload pi sends. The handler's RETURN value replaces the
	// payload in the runner (patch builds a fresh object tree, so discarding
	// the result — as the pre-migration hook did — left the patch a no-op).
	pi.on("before_provider_request", (event, ctx) => {
		if (ctx.model?.provider !== PROVIDER_TOKENROUTER) return;
		const force = isTokenRouterMinimaxModel(ctx.model?.id ?? "");
		return patchTokenRouterMinimaxThinkingPayload(event.payload, force);
	});

	// Extract MiniMax inline ` thinking ... response` tags into thinking blocks.
	pi.on("message_end", (event, ctx) => {
		if (ctx.model?.provider !== PROVIDER_TOKENROUTER) return;
		if (event.message.role !== "assistant") return;
		return { message: normalizeAssistantMessage(event.message) };
	});

	return Promise.resolve();
}
