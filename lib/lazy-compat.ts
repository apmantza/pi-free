/**
 * Lazy bridge for the heavy `@earendil-works/pi-ai/compat` entry point.
 *
 * The compat module costs ~1.3-1.7s of module-load time and used to be paid
 * eagerly at provider construction because `openAICompletionsApi` /
 * `anthropicMessagesApi` were value-imported at the top of the provider
 * files. Pi's `Provider` interface requires `stream`/`streamSimple` to return
 * an `AssistantMessageEventStream` synchronously, so this bridge returns the
 * local compat-free shell (lib/assistant-message-event-stream.ts) immediately
 * and pipes the real compat stream into it once a single-flight dynamic
 * compat import resolves. Import or call failures surface as a proper stream
 * error event instead of a swallowed promise rejection.
 *
 * Only `@earendil-works/pi-ai/compat` is imported here (dynamically). Both
 * it and `@earendil-works/pi-ai/providers/all` (used lazily by
 * lib/model-metadata.ts) are on the runtime allow-list — see
 * scripts/check-runtime-imports.mjs.
 */

import type {
	Api,
	AssistantMessage,
	AssistantMessageEventStream,
	Model,
	ProviderStreams,
	StreamOptions,
} from "@earendil-works/pi-ai/compat";
import { createAssistantMessageEventStream } from "./assistant-message-event-stream.ts";
import { loadPiAiEntry } from "./pi-ai-loader.ts";

/** The only compat exports the bridge consumes; keeps the test seam narrow. */
type PiAiCompat = Pick<
	typeof import("@earendil-works/pi-ai/compat"),
	"openAICompletionsApi" | "anthropicMessagesApi"
>;

let compatPromise: Promise<PiAiCompat> | undefined;
let compatLoader: () => Promise<PiAiCompat> = () =>
	loadPiAiEntry<PiAiCompat>("compat");

/**
 * Test seam only: swap the compat loader (e.g. for failure injection) and
 * reset the single-flight cache. Pass `undefined` to restore the real
 * dynamic import. Production code must never call this.
 */
export function __setCompatLoaderForTests(
	loader: (() => Promise<PiAiCompat>) | undefined,
): void {
	compatPromise = undefined;
	compatLoader = loader ?? (() => loadPiAiEntry<PiAiCompat>("compat"));
}

/** Single-flight cached dynamic import of the heavy compat entry point. */
export function loadPiAiCompat(): Promise<PiAiCompat> {
	if (!compatPromise) {
		compatPromise = compatLoader().catch((error) => {
			// Do not cache failures: a transient load error must not break
			// every later stream.
			compatPromise = undefined;
			throw error;
		});
	}
	return compatPromise;
}

function createBridgeErrorMessage(
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

/**
 * Run the deferred compat stream behind a synchronous local shell: forward
 * every inner event, and on any failure push a proper error event.
 */
function lazyCompatStream(
	model: Model<Api>,
	options: StreamOptions | undefined,
	createInner: (compat: PiAiCompat) => AssistantMessageEventStream,
): AssistantMessageEventStream {
	const outer = createAssistantMessageEventStream();

	void (async () => {
		try {
			const inner = createInner(await loadPiAiCompat());
			for await (const event of inner) outer.push(event);
			// Safety net for an inner stream that ends without a terminal
			// done/error event. Current pi-ai APIs always push one, so this
			// normally re-resolves an already-settled shell; if the inner
			// result itself never settles, neither does the shell — same
			// semantics as consuming the inner stream directly.
			if (typeof inner.result === "function") {
				outer.end(await inner.result());
			} else {
				outer.end();
			}
		} catch (error) {
			const message = createBridgeErrorMessage(model, options, error);
			outer.push({
				type: "error",
				reason: message.stopReason as "aborted" | "error",
				error: message,
			});
		}
	})();

	// SAFETY: outer is the compat-free local shell from
	// createAssistantMessageEventStream(); it forwards every inner event and
	// always settles with done/error, matching the AssistantMessageEventStream
	// protocol the Provider.stream contract iterates. The cast only relabels
	// structurally-equivalent stream declarations until the real compat
	// implementation takes over.
	return outer as unknown as AssistantMessageEventStream;
}

/** Build a ProviderStreams whose methods defer to a compat selector. */
function createLazyCompatStreams(
	select: (compat: PiAiCompat) => ProviderStreams,
): ProviderStreams {
	return {
		stream: (model, context, options) =>
			lazyCompatStream(model, options, (compat) =>
				select(compat).stream(model, context, options),
			),
		streamSimple: (model, context, options) =>
			lazyCompatStream(model, options, (compat) =>
				select(compat).streamSimple(model, context, options),
			),
	};
}

/** Lazy stand-in for compat's `openAICompletionsApi()` (loads on first use). */
export function lazyOpenAICompletionsApi(): ProviderStreams {
	return createLazyCompatStreams((compat) => compat.openAICompletionsApi());
}

/** Lazy stand-in for compat's `anthropicMessagesApi()` (loads on first use). */
export function lazyAnthropicMessagesApi(): ProviderStreams {
	return createLazyCompatStreams((compat) => compat.anthropicMessagesApi());
}
