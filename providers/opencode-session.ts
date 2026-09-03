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
import type {
	ProviderConfig,
	ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import { DEFAULT_FETCH_TIMEOUT_MS } from "../constants.ts";
import { loadPiAiEntry } from "../lib/pi-ai-loader.ts";

export const OPENCODE_DYNAMIC_API = "opencode-dynamic" as const;

const OPENCODE_STATIC_HEADERS = {
	"User-Agent": "opencode/1.18.18",
	"x-opencode-client": "cli",
} as const;

/**
 * Fetch the public OpenCode Zen catalog. The endpoint intentionally returns
 * only model ids, so callers merge those ids with Pi's richer built-in model
 * metadata. Keep this as a small, one-shot request: it runs after session
 * start and must never become part of extension initialization.
 */
export async function fetchOpenCodeModelIds(
	baseUrl: string,
	signal?: AbortSignal,
): Promise<string[]> {
	const timeoutSignal = AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS);
	const requestSignal = signal
		? AbortSignal.any([signal, timeoutSignal])
		: timeoutSignal;
	const response = await fetch(`${baseUrl.replace(/\/+$/u, "")}/models`, {
		headers: {
			...OPENCODE_STATIC_HEADERS,
			Accept: "application/json",
		},
		signal: requestSignal,
	});
	if (!response.ok) {
		throw new Error(`OpenCode model catalog returned HTTP ${response.status}`);
	}

	const payload: unknown = await response.json();
	if (!payload || typeof payload !== "object") {
		throw new Error("OpenCode model catalog returned an invalid response");
	}
	const data = (payload as { data?: unknown }).data;
	if (!Array.isArray(data)) {
		throw new Error("OpenCode model catalog returned no model list");
	}

	const ids = [
		...new Set(
			data
				.filter(
					(item): item is { id: string } =>
						item !== null &&
						typeof item === "object" &&
						typeof (item as { id?: unknown }).id === "string" &&
						(item as { id: string }).id.length > 0,
				)
				.map((item) => item.id),
		),
	];
	if (ids.length === 0) {
		throw new Error("OpenCode model catalog returned an empty model list");
	}
	return ids;
}

/**
 * OpenCode-native identifier generation.
 *
 * OpenCode's server uses checkHeaders to distinguish native CLI requests from
 * third-party clients, and applies a fallback rate limit (~2 req/day, the
 * "freeze") when the identity looks foreign. The real CLI (v1.18.18,
 * packages/opencode/src/session/llm/request.ts) sends:
 *
 *   x-opencode-session:  ses_ + descending ULID (26 chars: 12 hex + 14 base62)
 *   x-opencode-request:  prt_ + ascending ULID (a SessionV1 PartID)
 *   x-opencode-project:  the project id (schema default "global")
 *   x-opencode-client:   "cli" (OPENCODE_CLIENT default)
 *   User-Agent:          opencode/<version>
 *
 * The ULID is `~timestamp<<12 | counter` encoded as 6 hex bytes then 14
 * base62 bytes (crypto random) — see packages/schema/src/identifier.ts.
 */
const OPENCODE_ID_CHARS =
	"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

// Mirror the CLI's module-level timestamp/counter for exact ULID shape.
let _lastUlidTimestamp = 0;
let _ulidCounter = 0;

function openCodeUlid(descending: boolean): string {
	const timestamp = Date.now();
	if (timestamp !== _lastUlidTimestamp) {
		_lastUlidTimestamp = timestamp;
		_ulidCounter = 0;
	}
	_ulidCounter += 1;

	const current = BigInt(timestamp) * 0x1000n + BigInt(_ulidCounter);
	const value = descending ? ~current : current;
	const time = Array.from({ length: 6 }, (_, index) =>
		Number((value >> BigInt(40 - 8 * index)) & 0xffn)
			.toString(16)
			.padStart(2, "0"),
	).join("");
	const bytes = crypto.getRandomValues(new Uint8Array(14));
	return (
		time + Array.from(bytes, (byte) => OPENCODE_ID_CHARS[byte % 62]).join("")
	);
}

/**
 * Shared OpenCode session/request tracking.
 *
 * OpenCode endpoints require native-format identifiers to receive the full
 * daily rate limit: session ids are `ses_` + descending ULID, request ids are
 * `prt_` + ascending ULID (the CLI sends a PartID as x-opencode-request).
 * Without matching prefixes the server falls back to a ~2 req/day limit.
 */
export function createOpenCodeSessionTracker() {
	let sessionId = "";

	function getSessionId(): string {
		if (!sessionId) {
			sessionId = "ses_" + openCodeUlid(true);
		}
		return sessionId;
	}

	function nextRequestId(): string {
		return "prt_" + openCodeUlid(false);
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
		// The CLI sends the project id when present (schema default "global").
		// Note: the deployed Zen backend's checkHeaders gate is currently
		// disabled (production ipRateLimiter.ts hardcodes headersExist=true),
		// so these headers are log/forward-compat only — the daily freeze is
		// IP-based. Keep them faithful to the CLI wire format in case the gate
		// is re-enabled.
		"x-opencode-project": "global",
	};
}

export function isOpenCodeProvider(providerId: string): boolean {
	return (
		providerId === "opencode" ||
		providerId === "opencode-free" ||
		providerId === "opencode-go"
	);
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
	_api: NonNullable<Api>,
	fallbackBaseUrl: string,
): string {
	// OpenCode's gateway now exposes every wire protocol below /v1:
	// /v1/chat/completions, /v1/responses, /v1/messages, and /v1/models/...
	// Older Pi catalogs used /zen/messages for Anthropic models, which now
	// resolves to the website's HTML 404 page.
	void _api; // Kept in the helper signature for callers that pass the wire API.
	const root = fallbackBaseUrl.replace(/\/v1\/?$/u, "");
	return `${root}/v1`;
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
				? {
						sessionAffinityFormat: "openai-nosession" as const,
						...model.compat,
					}
				: model.compat;
		return {
			...model,
			api,
			// Normalize stale catalog URLs too, not just missing ones. OpenCode's
			// Anthropic endpoint migrated from /zen/messages to /zen/v1/messages.
			baseUrl: getOpenCodeModelBaseUrl(api, model.baseUrl ?? fallbackBaseUrl),
			...(compat ? { compat } : {}),
		};
	});
}

function resolveOpenCodeStreamApi(model: Model<Api>): string {
	if (model.api === OPENCODE_DYNAMIC_API) {
		return resolveOpenCodeModelApi(model.id, model.provider, model.api);
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
type GoogleGenerativeAIStreamModule =
	StreamSimpleModule<"google-generative-ai">;
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
		if (!resolved) {
			// Last resort for Bun-compiled pi binaries: no bare specifier
			// resolves from external files there, so reach the vendored
			// bundle's API factories through the shared loader (#502).
			const vendored = await importPiAiVendoredApiStreams<T>(specifier);
			if (vendored) return vendored;
			throw directError;
		}
		try {
			return (await import(pathToFileURL(resolved).href)) as T;
		} catch {
			throw directError;
		}
	}
}

/**
 * Maps the api subpaths this module imports to the API-factory export names
 * shared by pi-ai's real `compat` entry and pi-free's vendored bundle.
 */
const VENDORED_API_FACTORIES: Record<string, string> = {
	"api/anthropic-messages": "anthropicMessagesApi",
	"api/google-generative-ai": "googleGenerativeAIApi",
	"api/openai-completions": "openAICompletionsApi",
	"api/openai-responses": "openAIResponsesApi",
};

/**
 * Builds a streamSimple-carrying module from the loader's compat entry when no
 * importable pi-ai copy exists on disk. Works uniformly for the real compat
 * module and the vendored bundle; the factories are pi-ai's lazy wrappers, so
 * calling them does not load the provider implementation until first use.
 */
async function importPiAiVendoredApiStreams<T>(
	specifier: string,
): Promise<T | undefined> {
	const subpath = specifier.replace("@earendil-works/pi-ai/", "");
	const factoryName = VENDORED_API_FACTORIES[subpath];
	if (!factoryName) return undefined;
	try {
		const compat = await loadPiAiEntry<Record<string, unknown>>("compat");
		const factory = compat[factoryName];
		if (typeof factory !== "function") return undefined;
		const streams = (factory as () => unknown)();
		return streams as T;
	} catch {
		return undefined;
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
		// Routed through the shared loader (disk fallback + vendored bundle);
		// compat is a strict superset of the bare pi-ai root, including the
		// legacy streamSimple* aliases. The vendored last-resort bundle does
		// not carry the legacy aliases, so Bun-binary hosts return undefined
		// here and the caller's normal path takes over.
		const rootModule = await loadPiAiEntry<Record<string, unknown>>("compat");
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
			const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf-8"));
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
				// Normalize here as well as during catalog conversion because Pi can
				// supply a previously persisted model with the pre-/v1 URL.
				const normalizedModel = {
					...model,
					baseUrl: getOpenCodeModelBaseUrl(
						streamApi as NonNullable<Api>,
						model.baseUrl,
					),
				};
				if (streamApi === "anthropic-messages") {
					const streamSimpleAnthropic = getStreamSimple(
						await importPiAiSubpath<AnthropicStreamModule>("api/anthropic-messages"),
						"streamSimpleAnthropic",
					);
					await pipeStream(
						stream,
						streamSimpleAnthropic(
							{
								...normalizedModel,
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
								...normalizedModel,
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
								...normalizedModel,
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
							...normalizedModel,
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

		// SAFETY: the deferred wrapper implements the async-iterable and result()
		// surface expected by Pi's AssistantMessageEventStream.
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
let _apiProviderRegistrationPromise: Promise<void> | undefined;

/**
 * Register the opencode-dynamic API in compat's global API registry
 * so that fallback code paths (compat streamSimple) can resolve it.
 * Safe to call multiple times — registers once per tracker instance.
 *
 * The registry is only needed after Pi has captured a built-in OpenCode
 * catalog. Defer loading the compatibility entrypoint until this path is
 * actually used; the normal OpenCode stream imports its API subpaths lazily.
 */
export function ensureOpenCodeApiProviderRegistered(
	tracker: OpenCodeSessionTracker,
): void {
	if (_apiProviderRegistrationSourceId || _apiProviderRegistrationPromise)
		return;

	const streamFn = createOpenCodeStreamSimple(tracker);
	const sourceId = `pi-free-opencode-${randomBytes(4).toString("hex")}`;
	_apiProviderRegistrationPromise = loadPiAiEntry<{
		registerApiProvider?: unknown;
	}>("compat")
		.then(({ registerApiProvider }) => {
			// The vendored last-resort bundle does not carry registerApiProvider:
			// the registry lives in the HOST's compat instance (provider-composer
			// reads it), so a vendored registration would be a silent no-op.
			// Primary dispatch does not need it — the provider config carries
			// streamSimple, which provider-composer prefers over the registry.
			if (typeof registerApiProvider !== "function") return;
			// registerApiProvider expects { api, stream, streamSimple }. Both
			// stream and streamSimple return async-iterable streams; using the
			// same implementation for both is safe — the compat wrappers only
			// validate model.api and forward the call.
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(registerApiProvider as any)(
				{
					api: OPENCODE_DYNAMIC_API,
					stream: streamFn as any,
					streamSimple: streamFn,
				},
				sourceId,
			);
			_apiProviderRegistrationSourceId = sourceId;
		})
		.catch(() => {
			// The normal OpenCode path does not require compat registration, so a
			// failed optional fallback import must not break the built-in toggle.
			_apiProviderRegistrationPromise = undefined;
		});
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
function sanitizeMessagesForOpenCode(messages: unknown[]): unknown[] {
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
		const last = sanitized[sanitized.length - 1] as { role?: string } | undefined;
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
