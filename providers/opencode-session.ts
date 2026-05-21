import { randomUUID } from "node:crypto";
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
 * Shared OpenCode session/request tracking.
 *
 * OpenCode endpoints appear to behave more reliably when a stable session id
 * is included across requests in the same Pi session.
 */
export function createOpenCodeSessionTracker() {
	let sessionId = "";
	let requestCount = 0;

	function generateId(): string {
		return randomUUID().replaceAll("-", "");
	}

	function getSessionId(): string {
		if (!sessionId) {
			sessionId = generateId();
		}
		return sessionId;
	}

	function nextRequestId(): string {
		requestCount++;
		return `${getSessionId()}-${requestCount}`;
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

function isAnthropicOpenCodeEndpoint(model: Model<Api>): boolean {
	return !model.baseUrl.replace(/\/+$/, "").endsWith("/v1");
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
		const resolved = resolvePiAiFromPiEntrypoint(specifier);
		if (!resolved) throw directError;
		try {
			return (await import(pathToFileURL(resolved).href)) as T;
		} catch {
			throw directError;
		}
	}
}

function resolvePiAiFromPiEntrypoint(specifier: string): string | undefined {
	const candidates = [process.argv[1], import.meta.url].filter(
		(value): value is string => Boolean(value),
	);

	for (const candidate of candidates) {
		try {
			return createRequire(candidate).resolve(specifier);
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
							context,
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
						context,
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
