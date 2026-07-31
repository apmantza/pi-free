import { existsSync, lstatSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import type {
	Api,
	AssistantMessage,
	AssistantMessageEvent,
	AssistantMessageEventStream,
	Context,
	Model,
	ProviderHeaders,
	SimpleStreamOptions,
} from "@earendil-works/pi-ai/compat";
import { registerApiProvider } from "@earendil-works/pi-ai/compat";
import type {
	ProviderConfig,
	ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";

export const OPENCODE_DYNAMIC_API = "opencode-dynamic" as const;

export const OPENCODE_STATIC_HEADERS = {
	"User-Agent": "opencode/1.15.5",
	"x-opencode-client": "cli",
} as const;

/**
 * OpenCode-native identifier generation.
 *
 * OpenCode's server uses checkHeaders to distinguish native CLI requests from
 * third-party clients.  Native identifiers use ULID-style prefixes:
 *
 *   Session:  ses_<hex><base62>   (e.g. ses_a1b2c3d4e5f6g7h8i9j0k1l2m3n4)
 *   Request:  msg_<hex><base62>   (e.g. msg_01KA1B2C3D4E5F6G7H8I9J0K1L2M)
 *
 * If the server does not see the expected prefix it applies a fallback rate
 * limit (~2 req/day) which causes models to "freeze" after a few prompts.
 */
function generateOpenCodeId(prefix: string): string {
	// Timestamp in ms as big-endian hex (matches ULID-style sortability).
	const ms = BigInt(Date.now());
	const timeHex = ms.toString(16).padStart(12, "0");
	// Random suffix (crypto) encoded as base62 for compactness.
	const randomLen = 14;
	const base62Chars =
		"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
	const bytes = randomBytes(randomLen);
	let suffix = "";
	for (let i = 0; i < randomLen; i++) {
		suffix += base62Chars[bytes[i] % 62];
	}
	return `${prefix}${timeHex}${suffix}`;
}

/**
 * Shared OpenCode session/request tracking.
 *
 * OpenCode endpoints require native-format identifiers (ses_ / msg_ prefix)
 * to receive the full daily rate limit.  Without matching prefixes the server
 * falls back to a ~2 req/day limit, causing free models to freeze after a
 * couple of prompts.
 */
export function createOpenCodeSessionTracker() {
	let sessionId = "";

	function getSessionId(): string {
		if (!sessionId) {
			sessionId = generateOpenCodeId("ses_");
		}
		return sessionId;
	}

	function nextRequestId(): string {
		return generateOpenCodeId("msg_");
	}

	return {
		getSessionId,
		nextRequestId,
	};
}

export type OpenCodeSessionTracker = ReturnType<
	typeof createOpenCodeSessionTracker
>;

export function createOpenCodeHeaders(
	tracker: OpenCodeSessionTracker,
	existingHeaders?: ProviderHeaders,
): ProviderHeaders {
	return {
		...existingHeaders,
		...OPENCODE_STATIC_HEADERS,
		"x-opencode-session": tracker.getSessionId(),
		"x-opencode-request": tracker.nextRequestId(),
	};
}

export function isOpenCodeProvider(providerId: string): boolean {
	return providerId === "opencode" || providerId === "opencode-go";
}

export function resolveOpenCodeModelApi(
	modelId: string,
	providerId: string,
	currentApi?: Api,
): NonNullable<Api> {
	if (currentApi && currentApi !== OPENCODE_DYNAMIC_API) return currentApi;

	const id = modelId.toLowerCase();
	if (id.startsWith("gpt-")) return "openai-responses";
	if (
		id.startsWith("claude-") ||
		id.startsWith("qwen3.") ||
		id.startsWith("qwen3-") ||
		(providerId === "opencode-go" && id.startsWith("minimax-"))
	) {
		return "anthropic-messages";
	}
	if (id.startsWith("gemini-")) return "google-generative-ai";
	return "openai-completions";
}

export function getOpenCodeModelBaseUrl(
	api: NonNullable<Api>,
	fallbackBaseUrl: string,
): string {
	const root = fallbackBaseUrl.replace(/\/v1\/?$/u, "");
	return api === "anthropic-messages" ? root : `${root}/v1`;
}

export function applyOpenCodeProtocolDefaults(
	models: ProviderModelConfig[],
	providerId: string,
	fallbackBaseUrl: string,
): ProviderModelConfig[] {
	return models.map((model) => {
		const api = resolveOpenCodeModelApi(model.id, providerId, model.api);
		const compat =
			api === "openai-responses"
				? { sessionAffinityFormat: "openai-nosession" as const, ...model.compat }
				: model.compat;
		return {
			...model,
			api,
			baseUrl:
				model.baseUrl ??
				getOpenCodeModelBaseUrl(api, fallbackBaseUrl),
			...(compat ? { compat } : {}),
		};
	});
}

function stripTrailingSlashes(value: string): string {
	let end = value.length;
	while (end > 0 && value.codePointAt(end - 1) === 47) {
		end--;
	}
	return value.slice(0, end);
}

function isAnthropicOpenCodeEndpoint(model: Model<Api>): boolean {
	return !stripTrailingSlashes(model.baseUrl).endsWith("/v1");
}

function resolveOpenCodeStreamApi(model: Model<Api>): string {
	if (model.api === OPENCODE_DYNAMIC_API) {
		return isAnthropicOpenCodeEndpoint(model)
			? "anthropic-messages"
			: "openai-completions";
	}
	return model.api;
}

type StreamSimpleFn<TApi extends Api> = (
	model: Model<TApi>,
	context: Context,
	options?: SimpleStreamOptions,
) => AssistantMessageEventStream;

type StreamSimpleModule<TApi extends Api> = {
	streamSimple?: StreamSimpleFn<TApi>;
	[key: string]: unknown;
};

type AnthropicStreamModule = StreamSimpleModule<"anthropic-messages">;
type GoogleGenerativeAIStreamModule = StreamSimpleModule<"google-generative-ai">;
type OpenAICompletionsStreamModule = StreamSimpleModule<"openai-completions">;
type OpenAIResponsesStreamModule = StreamSimpleModule<"openai-responses">;

function getStreamSimple<TApi extends Api>(
	module: StreamSimpleModule<TApi>,
	legacyExport: string,
): StreamSimpleFn<TApi> {
	const streamSimple = module.streamSimple ?? module[legacyExport];
	if (typeof streamSimple !== "function") {
		throw new Error(
			`Pi AI module does not export ${legacyExport} or streamSimple`,
		);
	}
	return streamSimple as StreamSimpleFn<TApi>;
}

const piAiSubpathCache = new Map<string, Promise<unknown>>();

function importPiAiSubpath<T>(subpath: string): Promise<T> {
	const specifier = `@earendil-works/pi-ai/${subpath}`;
	const cached = piAiSubpathCache.get(specifier) as Promise<T> | undefined;
	if (cached) return cached;

	const promise = importPiAiSubpathUncached<T>(specifier);
	piAiSubpathCache.set(specifier, promise);
	return promise;
}

async function importPiAiSubpathUncached<T>(specifier: string): Promise<T> {
	try {
		return (await import(specifier)) as T;
	} catch (directError) {
		const rootFallback = await importPiAiRootFallback<T>(specifier);
		if (rootFallback) return rootFallback;

		const resolved = resolvePiAiSubpathFromPackage(specifier);
		if (!resolved) throw directError;
		try {
			return (await import(pathToFileURL(resolved).href)) as T;
		} catch {
			throw directError;
		}
	}
}

async function importPiAiRootFallback<T>(
	specifier: string,
): Promise<T | undefined> {
	const subpath = specifier.replace("@earendil-works/pi-ai/", "");
	const requiredExport: Record<string, string> = {
		"api/anthropic-messages": "streamSimpleAnthropic",
		"api/google-generative-ai": "streamSimpleGoogle",
		"api/openai-completions": "streamSimpleOpenAICompletions",
		"api/openai-responses": "streamSimpleOpenAIResponses",
		// Keep compatibility with pre-0.80 Pi AI packages.
		anthropic: "streamSimpleAnthropic",
		google: "streamSimpleGoogle",
		"openai-completions": "streamSimpleOpenAICompletions",
		"openai-responses": "streamSimpleOpenAIResponses",
	};
	const exportName = requiredExport[subpath];
	if (!exportName) return undefined;

	try {
		const rootModule = (await import("@earendil-works/pi-ai")) as Record<
			string,
			unknown
		>;
		return typeof rootModule[exportName] === "function"
			? (rootModule as T)
			: undefined;
	} catch {
		return undefined;
	}
}

const PI_AI_DEPENDENCY_CANARY = "openai";

function findPiAiPackageDir(requireBase: string): string | undefined {
	try {
		const require = createRequire(requireBase);
		const resolved = require.resolve(PI_AI_DEPENDENCY_CANARY);
		let dir = dirname(resolved);
		while (dir !== dirname(dir)) {
			if (basename(dir) === "node_modules") {
				const piAiDir = join(dir, "@earendil-works", "pi-ai");
				const pkgJsonPath = join(piAiDir, "package.json");
				if (existsSync(pkgJsonPath) && lstatSync(pkgJsonPath).isFile()) {
					return piAiDir;
				}
			}
			dir = dirname(dir);
		}
	} catch {
		// Resolution failed — try the next base.
	}
	return undefined;
}

function resolvePiAiExportTarget(
	exportsMap: Record<string, unknown> | undefined,
	subpath: string,
): string | undefined {
	if (!exportsMap) return undefined;

	const getTarget = (entry: unknown): string | undefined => {
		if (typeof entry === "string") return entry;
		if (!entry || typeof entry !== "object") return undefined;
		const conditions = entry as Record<string, unknown>;
		const target = conditions.import ?? conditions.default;
		return typeof target === "string" ? target : undefined;
	};

	const exactTarget = getTarget(exportsMap[`./${subpath}`]);
	if (exactTarget) return exactTarget;

	for (const [pattern, entry] of Object.entries(exportsMap)) {
		if (!pattern.endsWith("/*")) continue;
		const prefix = pattern.slice(2, -1);
		if (subpath.startsWith(prefix)) {
			const target = getTarget(entry);
			if (target) {
				return target.replaceAll("*", subpath.slice(prefix.length));
			}
		}
	}

	return undefined;
}

function resolvePiAiSubpathFromPackage(specifier: string): string | undefined {
	const subpath = specifier.replace("@earendil-works/pi-ai/", "");
	const candidates = [process.argv[1], import.meta.url].filter(
		(value): value is string => Boolean(value),
	);

	for (const candidate of candidates) {
		const pkgDir = findPiAiPackageDir(candidate);
		if (!pkgDir) continue;
		try {
			const pkg = JSON.parse(
				readFileSync(join(pkgDir, "package.json"), "utf-8"),
			);
			const targetPath = resolvePiAiExportTarget(pkg.exports, subpath);
			if (targetPath) return join(pkgDir, targetPath);
		} catch {
			// Try the next resolution base.
		}
	}

	return undefined;
}

class DeferredAssistantMessageEventStream {
	private readonly queue: AssistantMessageEvent[] = [];
	private readonly waiting: Array<
		(result: IteratorResult<AssistantMessageEvent>) => void
	> = [];
	private done = false;
	private resolveResult!: (message: AssistantMessage) => void;
	private readonly finalResultPromise: Promise<AssistantMessage>;

	constructor() {
		this.finalResultPromise = new Promise((resolve) => {
			this.resolveResult = resolve;
		});
	}

	push(event: AssistantMessageEvent): void {
		if (this.done) return;

		if (event.type === "done" || event.type === "error") {
			this.done = true;
			this.resolveResult(event.type === "done" ? event.message : event.error);
		}

		const waiter = this.waiting.shift();
		if (waiter) {
			waiter({ value: event, done: false });
		} else {
			this.queue.push(event);
		}
	}

	end(result?: AssistantMessage): void {
		if (this.done) return;
		this.done = true;
		if (result) this.resolveResult(result);
		while (this.waiting.length > 0) {
			this.waiting.shift()?.({ value: undefined, done: true });
		}
	}

	async *[Symbol.asyncIterator](): AsyncIterator<AssistantMessageEvent> {
		while (true) {
			if (this.queue.length > 0) {
				yield this.queue.shift()!;
			} else if (this.done) {
				return;
			} else {
				const result = await new Promise<IteratorResult<AssistantMessageEvent>>(
					(resolve) => this.waiting.push(resolve),
				);
				if (result.done) return;
				yield result.value;
			}
		}
	}

	result(): Promise<AssistantMessage> {
		return this.finalResultPromise;
	}
}

function createErrorMessage(
	model: Model<Api>,
	error: unknown,
): AssistantMessage {
	const message = error instanceof Error ? error.message : String(error);
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
			cost: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				total: 0,
			},
		},
		stopReason: "error",
		errorMessage: message,
		timestamp: Date.now(),
	};
}

async function pipeStream(
	stream: DeferredAssistantMessageEventStream,
	upstream: AssistantMessageEventStream,
): Promise<void> {
	let finalMessage: AssistantMessage | undefined;
	try {
		for await (const event of upstream) {
			stream.push(event);
			if (event.type === "done") finalMessage = event.message;
			if (event.type === "error") finalMessage = event.error;
		}
		stream.end(finalMessage ?? (await upstream.result()));
	} catch (error) {
		if (finalMessage) {
			stream.end(finalMessage);
		} else {
			throw error;
		}
	}
}

/**
 * Pi's static model headers are evaluated at registration time. OpenCode treats
 * x-opencode-request like a per-request id, so reusing one value across turns can
 * leave later requests attached to an old/in-flight generation. Registering a
 * provider-specific stream keeps the normal Pi parsers but refreshes headers for
 * every LLM call.
 */
export function createOpenCodeStreamSimple(
	tracker: OpenCodeSessionTracker,
): NonNullable<ProviderConfig["streamSimple"]> {
	return (model, context, options) => {
		const headers = createOpenCodeHeaders(tracker, options?.headers);
		const stream = new DeferredAssistantMessageEventStream();

		// Sanitize context messages for Anthropic/OpenAI compatibility.
		// OpenCode proxies to Anthropic which strictly enforces alternating
		// user/assistant turns. This fixes consecutive assistant messages,
		// leading assistant messages, and trailing assistant messages.
		const sanitizedMessages = sanitizeMessagesForOpenCode(
			context.messages as unknown[],
		);
		const sanitizedContext: Context = {
			...context,
			messages: sanitizedMessages as Context["messages"],
		};

		void (async () => {
			try {
				const streamApi = resolveOpenCodeStreamApi(model);
				if (streamApi === "anthropic-messages") {
					const streamSimpleAnthropic = getStreamSimple(
						await importPiAiSubpath<AnthropicStreamModule>(
							"api/anthropic-messages",
						),
						"streamSimpleAnthropic",
					);
					await pipeStream(
						stream,
						streamSimpleAnthropic(
							{
								...model,
								api: "anthropic-messages",
							} as Model<"anthropic-messages">,
							sanitizedContext,
							{ ...options, headers },
						),
					);
					return;
				}

				if (streamApi === "google-generative-ai") {
					const streamSimpleGoogle = getStreamSimple(
						await importPiAiSubpath<GoogleGenerativeAIStreamModule>(
							"api/google-generative-ai",
						),
						"streamSimpleGoogle",
					);
					await pipeStream(
						stream,
						streamSimpleGoogle(
							{
								...model,
								api: "google-generative-ai",
							} as Model<"google-generative-ai">,
							sanitizedContext,
							{ ...options, headers },
						),
					);
					return;
				}

				if (streamApi === "openai-responses") {
					const streamSimpleOpenAIResponses = getStreamSimple(
						await importPiAiSubpath<OpenAIResponsesStreamModule>(
							"api/openai-responses",
						),
						"streamSimpleOpenAIResponses",
					);
					await pipeStream(
						stream,
						streamSimpleOpenAIResponses(
							{
								...model,
								api: "openai-responses",
							} as Model<"openai-responses">,
							sanitizedContext,
							{ ...options, headers },
						),
					);
					return;
				}

				const streamSimpleOpenAICompletions = getStreamSimple(
					await importPiAiSubpath<OpenAICompletionsStreamModule>(
						"api/openai-completions",
					),
					"streamSimpleOpenAICompletions",
				);
				await pipeStream(
					stream,
					streamSimpleOpenAICompletions(
						{
							...model,
							api: "openai-completions",
						} as Model<"openai-completions">,
						sanitizedContext,
						{ ...options, headers },
					),
				);
			} catch (error) {
				const errorMessage = createErrorMessage(model, error);
				stream.push({ type: "start", partial: errorMessage });
				stream.push({ type: "error", reason: "error", error: errorMessage });
			}
		})();

		return stream as unknown as AssistantMessageEventStream;
	};
}

// ── Compat API registry safety net ─────────────────────────────────────────
// The opencode-dynamic API is not a pi-ai built-in. If compat.js's
// streamSimple() is ever called directly with a model using this API
// (e.g. as a default-stream fallback after reload), it throws
// "No API provider registered for api: opencode-dynamic".
// Registering the API here ensures the compat path also works.

let _apiProviderRegistrationSourceId: string | undefined;

/**
 * Register the opencode-dynamic API in compat's global API registry
 * so that fallback code paths (compat streamSimple) can resolve it.
 * Safe to call multiple times — registers once per tracker instance.
 */
export function ensureOpenCodeApiProviderRegistered(
	tracker: OpenCodeSessionTracker,
): void {
	if (_apiProviderRegistrationSourceId) return;

	const streamFn = createOpenCodeStreamSimple(tracker);
	const sourceId = `pi-free-opencode-${randomBytes(4).toString("hex")}`;

	// registerApiProvider expects { api, stream, streamSimple }. Both
	// stream and streamSimple return async-iterable streams; using the
	// same implementation for both is safe — the compat wrappers only
	// validate model.api and forward the call.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	registerApiProvider(
		{
			api: OPENCODE_DYNAMIC_API,
			stream: streamFn as any,
			streamSimple: streamFn,
		},
		sourceId,
	);

	_apiProviderRegistrationSourceId = sourceId;
}

/**
 * Sanitize message history for OpenCode's backends.
 *
 * OpenCode proxies to Anthropic and OpenAI. Anthropic strictly enforces
 * alternating user/assistant turns and rejects:
 *   - consecutive assistant messages
 *   - conversations that start with assistant
 *   - conversations that end with assistant
 *
 * This sanitizer fixes all three issues with minimal placeholder messages.
 */
export function sanitizeMessagesForOpenCode(messages: unknown[]): unknown[] {
	if (!Array.isArray(messages)) return messages;

	const sanitized: unknown[] = [];
	let hasNonSystem = false;

	for (const raw of messages) {
		if (!raw || typeof raw !== "object") continue;
		const msg = raw as { role?: string; content?: unknown };
		const role = msg.role;
		if (!role) continue;

		if (role === "system") {
			sanitized.push(raw);
			continue;
		}

		// Skip leading assistant messages before any user/tool message
		if (role === "assistant" && !hasNonSystem) continue;

		hasNonSystem = true;

		// Insert placeholder user message between consecutive assistant messages
		const last = sanitized[sanitized.length - 1] as
			| { role?: string }
			| undefined;
		if (role === "assistant" && last?.role === "assistant") {
			sanitized.push({ role: "user", content: " " });
		}

		sanitized.push(raw);
	}

	// Ensure conversation ends with a user message
	const last = sanitized[sanitized.length - 1] as { role?: string } | undefined;
	if (last?.role === "assistant") {
		sanitized.push({ role: "user", content: " " });
	}

	return sanitized;
}
