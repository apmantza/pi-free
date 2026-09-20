/**
 * Compat-registry stream selection (#554).
 *
 * Recurrence this prevents: the compat fallback registered for the shared
 * `opencode-dynamic` api was built with `createOpenCodeStreamSimple(tracker)`
 * (no anonymous flag), so auxiliary calls on that path sent the stored account
 * credential. Zen answers the keyed lane with `429 FreeUsageLimitError` /
 * `403 Model access is disabled` while the identical anonymous request
 * succeeds — so the free provider broke again, just on a different path.
 */
import { describe, expect, it, vi } from "vitest";
import {
	createOpenCodeCompatStream,
	selectOpenCodeCompatStream,
} from "../providers/opencode-session.ts";

type StreamLike = (model: { provider?: string }) => {
	tag: string;
	provider?: string;
};

describe("opencode compat-registry stream (#554)", () => {
	it("builds one anonymous and one keyed stream, dispatching per provider", () => {
		const built: Array<boolean | undefined> = [];
		const createStream = vi.fn(
			(_tracker: unknown, settings?: { anonymous?: boolean }) => {
				built.push(settings?.anonymous);
				const tag = settings?.anonymous ? "free" : "keyed";
				return ((model: { provider?: string }) => ({
					tag,
					provider: model.provider,
				})) as never;
			},
		) as unknown as Parameters<typeof createOpenCodeCompatStream>[1];

		const stream = createOpenCodeCompatStream(
			{} as never,
			createStream,
		) as unknown as StreamLike;

		// One anonymous construction, one keyed — not a single keyed stream.
		expect(built).toEqual([true, undefined]);
		expect(stream({ provider: "opencode-free" })).toEqual({
			tag: "free",
			provider: "opencode-free",
		});
		expect(stream({ provider: "opencode-go" })).toEqual({
			tag: "keyed",
			provider: "opencode-go",
		});
	});

	it("selects the anonymous stream only for opencode-free", () => {
		const freeStream = { id: "free" } as never;
		const keyedStream = { id: "keyed" } as never;
		expect(
			selectOpenCodeCompatStream(freeStream, keyedStream, "opencode-free"),
		).toBe(freeStream);
		expect(
			selectOpenCodeCompatStream(freeStream, keyedStream, "opencode-go"),
		).toBe(keyedStream);
		expect(selectOpenCodeCompatStream(freeStream, keyedStream, undefined)).toBe(
			keyedStream,
		);
	});
});
