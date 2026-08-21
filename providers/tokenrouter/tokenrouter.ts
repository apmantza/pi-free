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
 * type, no custom stream wrappers: request shaping happens in a single
 * `before_provider_request` normalizer, response cleanup in `message_end`.
 *
 * TokenRouter-specific behaviors are thin seams on the standard provider:
 *  - Request normalization (`before_provider_request`): every request gets
 *    `reasoning_split: true` (clean `reasoning_content` separation; ignored
 *    by upstreams that do not support it), MiniMax-M3's `thinking` object is
 *    rewritten from pi's `{ type: "enabled" }` to the required
 *    `{ type: "adaptive" }`, and top-level `reasoning_effort` values outside
 *    the gateway's accepted set are mapped or dropped (the route rejects
 *    anything but low/medium/xhigh with
 *    `400: reasoning_effort must be low, medium, or xhigh`).
 *  - Model compat: the shared `getProxyModelCompat` (same as Cline/B.AI, so
 *    `requiresReasoningContentOnAssistantMessages` keeps replaying
 *    `reasoning_content` across turns) with `supportsReasoningEffort`
 *    explicitly disabled — the strip is re-applied after models.dev
 *    enrichment so the flag can never be re-derived.
 *  - MiniMax-M3 (`message_end`): sometimes emits DeepSeek-style inline
 *    `<think> … </think>` reasoning tags in the assistant text; they are
 *    extracted into proper ThinkingContent blocks.
 */

import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import type {
	AssistantMessage,
	ThinkingContent,
} from "@earendil-works/pi-ai/compat";
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
// TokenRouter's MiniMax-M3 model sometimes emits DeepSeek-style `<think>`
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

function extractTaggedBlocks(
	text: string,
	openTag: string,
	closeTag: string,
): ExtractedThinking {
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

	return { text: textParts.join(""), thinking: thinkingParts.join("\n\n") };
}

function extractThinkBlocks(text: string): ExtractedThinking {
	// Primary: real <think>…</think> tags. Fallback: the space-prefixed
	// " thinking … response" variants some MiniMax upstreams emit when the
	// angle brackets are stripped.
	let result = extractTaggedBlocks(text, "<think>", "</think>");
	if (!result.thinking) {
		result = extractTaggedBlocks(text, " thinking", " response");
	}
	return {
		text: collapseWhitespace(result.text),
		thinking: collapseWhitespace(result.thinking),
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

// =============================================================================
// Request normalization (single before_provider_request seam)
// Encodes every TokenRouter wire quirk at one boundary so no custom stream
// wrapper or per-model compat patching is needed:
//   1. `reasoning_split: true` — always requested for clean reasoning/content
//      separation (upstreams without support ignore it).
//   2. MiniMax-M3 requires `thinking: { type: "adaptive" }`; pi sends
//      `{ type: "enabled" }`, which is rewritten.
//   3. `reasoning_effort` must be low/medium/xhigh. pi-ai derives values from
//      models.dev thinkingLevelMaps that contain entries like "none", which
//      the gateway rejects with a 400 — invalid values are dropped and
//      near-misses are mapped onto the accepted set.
// =============================================================================

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

/** OpenAI-role system prompt that some upstreams reject (see normalizer). */
function isDeveloperMessage(message: unknown): boolean {
	return isRecord(message) && message.role === "developer";
}

/** reasoning_effort values the TokenRouter chat-completions route accepts. */
const VALID_REASONING_EFFORTS = new Set(["low", "medium", "xhigh"]);

/** Near-miss effort names mapped onto the gateway's accepted set. */
const REASONING_EFFORT_ALIASES: Record<string, string> = {
	minimal: "low",
	high: "xhigh",
};

function sanitizeReasoningEffort(
	payload: Record<string, unknown>,
): Record<string, unknown> | undefined {
	if (!("reasoning_effort" in payload)) return undefined;
	const raw = payload.reasoning_effort;
	if (typeof raw === "string") {
		const lowered = raw.toLowerCase();
		if (VALID_REASONING_EFFORTS.has(lowered)) {
			return lowered === raw
				? undefined
				: { ...payload, reasoning_effort: lowered };
		}
		const aliased = REASONING_EFFORT_ALIASES[lowered];
		if (aliased) return { ...payload, reasoning_effort: aliased };
	}
	// Present but invalid (null, "none", non-strings): drop the field —
	// sending it would hard-fail the whole request with a 400.
	const { reasoning_effort: _dropped, ...rest } = payload;
	return rest;
}

/**
 * Chat-completions request payload at the TokenRouter wire boundary: raw JSON
 * text or an already-structured JSON value.
 */
type TokenRouterRequestPayload =
	| string
	| number
	| boolean
	| null
	| TokenRouterRequestPayload[]
	| { [key: string]: unknown };

export function normalizeTokenRouterRequestPayload(
	payload: unknown,
	force = false,
): TokenRouterRequestPayload {
	if (typeof payload === "string") {
		try {
			const parsed = JSON.parse(payload) as unknown;
			const normalized = normalizeTokenRouterRequestPayload(parsed, force);
			return normalized === parsed ? payload : JSON.stringify(normalized);
		} catch {
			return payload;
		}
	}
	if (!isRecord(payload)) return payload as TokenRouterRequestPayload;

	let next: Record<string, unknown> = payload;
	let changed = false;

	// Always request split reasoning for clean thinking display.
	if (next.reasoning_split !== true) {
		next = { ...next, reasoning_split: true };
		changed = true;
	}

	// Rewrite OpenAI "developer" role messages to "system": pi-ai defaults
	// unknown providers to the developer role, but TokenRouter forwards it to
	// upstreams (e.g. Qwen) that reject it with
	// `422 openai_error / bad_response_status_code`.
	if (Array.isArray(next.messages) && next.messages.some(isDeveloperMessage)) {
		next = {
			...next,
			messages: (next.messages as unknown[]).map((message) =>
				isRecord(message) && message.role === "developer"
					? { ...message, role: "system" }
					: message,
			),
		};
		changed = true;
	}

	// MiniMax-M3 only: rewrite pi's thinking "enabled" to "adaptive".
	if (
		(force || containsTokenRouterMinimaxModel(next)) &&
		isRecord(next.thinking) &&
		next.thinking.type === "enabled"
	) {
		next = { ...next, thinking: { ...next.thinking, type: "adaptive" } };
		changed = true;
	}

	// Clamp reasoning_effort to the gateway's accepted set.
	const sanitized = sanitizeReasoningEffort(next);
	if (sanitized) {
		next = sanitized;
		changed = true;
	}

	return changed ? next : payload;
}

// =============================================================================
// Compat
// The shared proxy compat (Cline/B.AI parity) is kept for its other flags —
// most importantly `requiresReasoningContentOnAssistantMessages`, which
// replays `reasoning_content` on later assistant turns for multi-turn
// reasoning — with only `supportsReasoningEffort` disabled.
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
	});

	// Normalize every outgoing TokenRouter payload at the wire boundary. The
	// handler's RETURN value replaces the payload in the runner (a hook that
	// only patches in place is a silent no-op).
	pi.on("before_provider_request", (event, ctx) => {
		if (ctx.model?.provider !== PROVIDER_TOKENROUTER) return;
		const force = isTokenRouterMinimaxModel(ctx.model?.id ?? "");
		return normalizeTokenRouterRequestPayload(event.payload, force);
	});

	// Extract MiniMax inline `<think> … </think>` tags into thinking blocks.
	pi.on("message_end", (event, ctx) => {
		if (ctx.model?.provider !== PROVIDER_TOKENROUTER) return;
		if (event.message.role !== "assistant") return;
		return { message: normalizeAssistantMessage(event.message) };
	});

	return Promise.resolve();
}
