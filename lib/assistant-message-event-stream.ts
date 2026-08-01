import type {
	AssistantMessage,
	AssistantMessageEvent,
} from "@earendil-works/pi-ai/compat";

/**
 * Push-based async stream used by custom providers.
 *
 * This mirrors pi-ai's public AssistantMessageEventStream contract without
 * importing the compatibility entrypoint (or an unexported pi-ai module).
 */
export class EventStream<T, R = T> implements AsyncIterable<T> {
	private queue: T[] = [];
	private waiting: Array<(result: IteratorResult<T>) => void> = [];
	private done = false;
	private finalResultPromise: Promise<R>;
	private resolveFinalResult!: (result: R) => void;
	private readonly isComplete: (event: T) => boolean;
	private readonly extractResult: (event: T) => R;

	constructor(
		isComplete: (event: T) => boolean,
		extractResult: (event: T) => R,
	) {
		this.isComplete = isComplete;
		this.extractResult = extractResult;
		this.finalResultPromise = new Promise<R>((resolve) => {
			this.resolveFinalResult = resolve;
		});
	}

	push(event: T): void {
		if (this.done) return;

		if (this.isComplete(event)) {
			this.done = true;
			this.resolveFinalResult(this.extractResult(event));
		}

		const waiter = this.waiting.shift();
		if (waiter) {
			waiter({ value: event, done: false });
		} else {
			this.queue.push(event);
		}
	}

	end(result?: R): void {
		this.done = true;
		if (result !== undefined) this.resolveFinalResult(result);

		while (this.waiting.length > 0) {
			const waiter = this.waiting.shift();
			waiter?.({ value: undefined as never, done: true });
		}
	}

	async *[Symbol.asyncIterator](): AsyncIterator<T> {
		while (true) {
			if (this.queue.length > 0) {
				yield this.queue.shift() as T;
			} else if (this.done) {
				return;
			} else {
				const result = await new Promise<IteratorResult<T>>((resolve) =>
					this.waiting.push(resolve),
				);
				if (result.done) return;
				yield result.value;
			}
		}
	}

	result(): Promise<R> {
		return this.finalResultPromise;
	}
}

/** Public-provider-compatible stream factory for custom wire protocols. */
export class AssistantMessageEventStream extends EventStream<
	AssistantMessageEvent,
	AssistantMessage
> {
	constructor() {
		super(
			(event) => event.type === "done" || event.type === "error",
			(event) => {
				if (event.type === "done") return event.message;
				if (event.type === "error") return event.error;
				throw new Error("Unexpected event type for final result");
			},
		);
	}
}

export function createAssistantMessageEventStream(): AssistantMessageEventStream {
	return new AssistantMessageEventStream();
}
