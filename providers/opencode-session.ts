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
	SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type { ProviderConfig } from "@earendil-works/pi-coding-agent";

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
	existingHeaders?: Record<string, string>,
): Record<string, string> {
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

type StreamSimpleFn<TApi extends Api> = (
	model: Model<TApi>,
	context: Context,
	options?: SimpleStreamOptions,
) => AssistantMessageEventStream;

type AnthropicStreamModule = {
	streamSimpleAnthropic: StreamSimpleFn<"anthropic-messages">;
};

type OpenAICompletionsStreamModule = {
	streamSimpleOpenAICompletions: StreamSimpleFn<"openai-completions">;
};

const piAiSubpathCache = new Map<string, Promise<unknown>>();

async function importPiAiSubpath<T>(subpath: string): Promise<T> {
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
		anthropic: "streamSimpleAnthropic",
		"openai-completions": "streamSimpleOpenAICompletions",
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
			const exportEntry = pkg.exports?.[`./${subpath}`];
			const targetPath = exportEntry?.import ?? exportEntry?.default;
			if (typeof targetPath === "string") {
				return join(pkgDir, targetPath);
			}
		} catch {
			// Try the next resolution base.
		}
	}

	return undefined;
}

class DeferredAssistantMessageEventStream {
	private queue: AssistantMessageEvent[] = [];
	private waiting: Array<
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
				if (isAnthropicOpenCodeEndpoint(model)) {
					const { streamSimpleAnthropic } =
						await importPiAiSubpath<AnthropicStreamModule>("anthropic");
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

				const { streamSimpleOpenAICompletions } =
					await importPiAiSubpath<OpenAICompletionsStreamModule>(
						"openai-completions",
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
