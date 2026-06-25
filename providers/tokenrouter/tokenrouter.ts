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
	Context,
	Model,
	SimpleStreamOptions,
	ThinkingContent,
} from "@earendil-works/pi-ai";
import {
	createAssistantMessageEventStream,
	streamSimpleOpenAICompletions,
} from "@earendil-works/pi-ai";
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
	DEEPSEEK_PROXY_COMPAT,
	getProxyModelCompat,
	isLikelyReasoningModel,
} from "../../lib/provider-compat.ts";
import { isFreeModel, registerWithGlobalToggle } from "../../lib/registry.ts";
import { cleanModelName, fetchWithRetry } from "../../lib/util.ts";
import { enhanceWithCI, setupProvider } from "../../provider-helper.ts";

const _logger = createLogger("tokenrouter");

// =============================================================================
// Reasoning cleanup
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

function extractThinkBlocks(text: string): ExtractedThinking {
	const openTag = "<think>";
	const closeTag = "</think>";
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

function isTokenRouterModel(model: { provider?: string }): boolean {
	return model.provider === PROVIDER_TOKENROUTER;
}

// =============================================================================
// Known Free Models
// TokenRouter doesn't expose pricing via /v1/models.
// Known-free detection uses `:free` name suffix for promotional models.
// =============================================================================
const TOKENROUTER_OPENAI_API = "tokenrouter-openai-completions" as const;
const TOKENROUTER_HIGH_LOAD_RETRY_DELAY_MS = 30_000;
const MINIMAX_ADAPTIVE_COMPAT: NonNullable<ProviderModelConfig["compat"]> = {
	...DEEPSEEK_PROXY_COMPAT,
	thinkingFormat: "deepseek",
};

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

function isTokenRouterMinimaxModel(modelId: string): boolean {
	return modelId.toLowerCase().includes("minimax");
}

export function finalizeTokenRouterModel(
	model: ProviderModelConfig,
): ProviderModelConfig {
	if (!isTokenRouterMinimaxModel(model.id)) return model;

	return {
		...model,
		reasoning: true,
		compat: {
			...MINIMAX_ADAPTIVE_COMPAT,
			...(model.compat ?? {}),
			thinkingFormat: "deepseek",
			supportsReasoningEffort: true,
		},
	};
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

function isTokenRouterHighLoadError(message: string | undefined): boolean {
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

function waitForTokenRouterRetry(
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

function createTokenRouterOpenAIStream(
	model: Model<Api>,
	context: Context,
	options: SimpleStreamOptions | undefined,
): AssistantMessageEventStream {
	const forcePatch = isTokenRouterMinimaxModel(model.id);
	return streamSimpleOpenAICompletions(
		{ ...model, api: "openai-completions" },
		context,
		{
			...options,
			onPayload: async (payload, payloadModel) => {
				const patchedPayload = patchTokenRouterMinimaxThinkingPayload(
					payload,
					forcePatch,
				);
				const upstreamPayload = await options?.onPayload?.(
					patchedPayload,
					payloadModel,
				);
				return patchTokenRouterMinimaxThinkingPayload(
					upstreamPayload ?? patchedPayload,
					forcePatch,
				);
			},
		},
	);
}

function createTokenRouterRetryErrorMessage(
	model: Model<Api>,
	options: SimpleStreamOptions | undefined,
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

function streamWithTokenRouterHighLoadRetry(
	model: Model<Api>,
	createAttempt: () => AssistantMessageEventStream,
	options: SimpleStreamOptions | undefined,
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
			await waitForTokenRouterRetry(
				TOKENROUTER_HIGH_LOAD_RETRY_DELAY_MS,
				options?.signal,
			);
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

	return output;
}

export function streamSimpleTokenRouter(
	model: Model<Api>,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	return streamWithTokenRouterHighLoadRetry(
		model,
		() => createTokenRouterOpenAIStream(model, context, options),
		options,
	);
}

export const __test__ = {
	TOKENROUTER_HIGH_LOAD_RETRY_DELAY_MS,
	isTokenRouterHighLoadError,
	streamWithTokenRouterHighLoadRetry,
	waitForTokenRouterRetry,
};

export function mapTokenRouterModel(
	model: TokenRouterModel,
): ProviderModelConfig & {
	_pricingKnown?: boolean;
	_freeKnown?: boolean;
	_isFree?: boolean;
} {
	const name = cleanModelName(model.id);
	const isMinimax = isTokenRouterMinimaxModel(model.id);
	const reasoning = isMinimax || isLikelyReasoningModel({ id: model.id, name });
	const isResponseApi =
		model.supported_endpoint_types.includes("openai-response");
	const isKnownFree = model.id.toLowerCase().endsWith(":free");

	return {
		id: model.id,
		name,
		reasoning,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128_000,
		maxTokens: 16_384,
		compat: {
			...(isMinimax
				? MINIMAX_ADAPTIVE_COMPAT
				: getProxyModelCompat({ id: model.id, name })),
			// openai-response models use a different API shape
			...(isResponseApi ? { apiType: "openai-response" as const } : {}),
		},
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
			enriched.map(finalizeTokenRouterModel),
			PROVIDER_TOKENROUTER,
		);
	} catch (error) {
		_logger.error("[tokenrouter] Failed to fetch models", {
			error: error instanceof Error ? error.message : String(error),
		});
		return [];
	}
}

// =============================================================================
// Extension Entry Point
// =============================================================================

export default async function tokenRouterProvider(pi: ExtensionAPI) {
	const apiKey = getTokenrouterApiKey();

	if (!apiKey) {
		_logger.info("[tokenrouter] Skipping — TOKENROUTER_API_KEY not set.");
		return;
	}

	const allModels = await fetchTokenRouterModels(apiKey);

	if (allModels.length === 0) {
		_logger.warn("[tokenrouter] No text chat models available");
		return;
	}

	const freeModels = allModels.filter((m) =>
		isFreeModel({ ...m, provider: PROVIDER_TOKENROUTER }, allModels),
	);
	const stored = { free: freeModels, all: allModels };

	_logger.info(
		`[tokenrouter] Registered ${allModels.length} models (${freeModels.length} free)`,
	);

	const reRegister = (models: ProviderModelConfig[]) => {
		pi.registerProvider(PROVIDER_TOKENROUTER, {
			baseUrl: BASE_URL_TOKENROUTER,
			apiKey,
			api: TOKENROUTER_OPENAI_API,
			streamSimple: streamSimpleTokenRouter,
			headers: { "User-Agent": "pi-free-providers" },
			models: enhanceWithCI(models, PROVIDER_TOKENROUTER),
		});
	};

	registerWithGlobalToggle(PROVIDER_TOKENROUTER, stored, reRegister, true);

	pi.on("before_provider_request", (event, ctx) =>
		patchTokenRouterMinimaxThinkingPayload(
			event.payload,
			isTokenRouterModel(ctx.model ?? {}) &&
				isTokenRouterMinimaxModel(ctx.model?.id ?? ""),
		),
	);

	pi.on("message_end", (event, ctx) => {
		if (!isTokenRouterModel(ctx.model ?? {})) return;
		if (event.message.role !== "assistant") return;
		return { message: normalizeAssistantMessage(event.message) };
	});

	setupProvider(
		pi,
		{
			providerId: PROVIDER_TOKENROUTER,
			initialShowPaid: getTokenrouterShowPaid(),
			tosUrl: "https://tokenrouter.com/terms",
			reRegister: (models, _stored) => {
				if (_stored) {
					stored.free = _stored.free;
					stored.all = _stored.all;
				}
				reRegister(models);
			},
		},
		stored,
	);

	const showPaid = getTokenrouterShowPaid();
	const initialModels =
		showPaid && stored.all.length > 0 ? stored.all : freeModels;
	reRegister(initialModels);
}
