/**
 * Kilo catalog admission over live rows (#676), through the real
 * fetchKiloCatalog -> fetchOpenRouterCompatibleModels -> isFreeModel path.
 * Only HTTP is stubbed.
 *
 * The fixture holds rows captured verbatim from the public
 * api.kilo.ai/api/gateway/models endpoint on 2026-11-14.
 */

import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchKiloCatalog } from "../providers/kilo/kilo-models.ts";

const fixture = JSON.parse(
	readFileSync(
		new URL("./fixtures/catalogs/kilo-2026-11-14.json", import.meta.url),
		"utf8",
	),
) as { data: unknown[] };

function stubHttp() {
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: string | URL | Request) => {
			const body = String(input).endsWith("/api/gateway/models")
				? { data: fixture.data }
				: {};
			return new Response(JSON.stringify(body), { status: 200 });
		}),
	);
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("Kilo catalog: output-modality admission (#676)", () => {
	// Recurrence: Kilo used only the shared "has text output" check, so
	// image/audio/video generators with "text" beside the media output
	// (gemini-*-image, gpt-5-image, lyria-3-*, gpt-audio, gemini-omni) and the
	// text+image routers appeared in the "all" view.
	it("drops media-output hybrids; keeps text-output chat incl. multimodal input", async () => {
		stubHttp();
		const { all, free } = await fetchKiloCatalog();
		expect(all.map((m) => m.id)).toEqual([
			"kilo-auto/balanced",
			"openrouter/fusion",
			"kilo-auto/free",
			"nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
			"google/gemini-4-hydrogen",
		]);
		expect(free.map((m) => m.id)).toEqual([
			"kilo-auto/free",
			"nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
		]);
	});
});

describe("Kilo catalog: routed '-1' pricing (#676)", () => {
	// Recurrence: routers list prompt/completion "-1" (billed at the routed
	// model's rate), which became a negative cost on the published model.
	it("stamps routers pricing-unknown with no negative cost, and keeps them paid", async () => {
		stubHttp();
		const { all, free } = await fetchKiloCatalog();
		for (const id of ["kilo-auto/balanced", "openrouter/fusion"]) {
			const router = all.find((m) => m.id === id) as
				| ((typeof all)[number] & { _pricingKnown?: boolean })
				| undefined;
			expect(router?.cost).toEqual({
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
			});
			expect(router?._pricingKnown).toBe(false);
			expect(free.map((m) => m.id)).not.toContain(id);
		}
	});
});

describe("Kilo catalog: abort signal (#676, convention 15)", () => {
	// Recurrence: fetchKiloCatalog accepted a signal but never passed it to
	// the fetch, so a superseded refresh held its request open until the
	// fetch timeout and then retried a second (free-only) request.
	it("cancels the in-flight request and does not retry after an abort", async () => {
		const seen: AbortSignal[] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(
				(_input: unknown, init?: RequestInit) =>
					new Promise<Response>((_resolve, reject) => {
						const signal = init?.signal;
						if (signal) seen.push(signal);
						// Like real fetch: reject at once on an aborted signal.
						const abort = () =>
							reject(new DOMException("aborted", "AbortError"));
						if (signal?.aborted) abort();
						signal?.addEventListener("abort", abort);
					}),
			),
		);
		const controller = new AbortController();
		const pending = fetchKiloCatalog({ signal: controller.signal });
		await vi.waitFor(() => expect(seen).toHaveLength(1));
		controller.abort();
		await expect(pending).resolves.toEqual({ all: [], free: [] });
		expect(seen).toHaveLength(1);
		expect(seen[0]?.aborted).toBe(true);
	}, 2_000);
});
