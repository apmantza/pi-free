/**
 * Cline catalog admission over live rows (#676), through the real
 * fetchClineCatalog -> mapping -> isFreeModel path. Only HTTP is stubbed.
 *
 * Fixtures are rows captured verbatim from the public
 * api.cline.bot/api/v1/ai/cline/{models,recommended-models} endpoints on
 * 2026-11-14.
 */

import { readFileSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchClineCatalog } from "../providers/cline/cline-models.ts";

function loadFixture<T>(name: string): T {
	return JSON.parse(
		readFileSync(
			new URL(`./fixtures/catalogs/${name}`, import.meta.url),
			"utf8",
		),
	) as T;
}

const catalog = loadFixture<{ data: unknown[] }>(
	"cline-models-2026-11-14.json",
);
const recommended = loadFixture<{ free: unknown[] }>(
	"cline-recommended-2026-11-14.json",
);

function json(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}

/** Route the two Cline endpoints to the fixtures; models.dev gets no data. */
function stubHttp() {
	const fetchMock = vi.fn(async (input: string | URL | Request) => {
		const url = String(input);
		if (url.endsWith("/ai/cline/models")) return json({ data: catalog.data });
		if (url.endsWith("/ai/cline/recommended-models")) return json(recommended);
		return json({});
	});
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

describe("Cline catalog: output-modality admission (#676)", () => {
	// Recurrence: `hasTextOutput` admitted any row whose outputs included
	// "text", so the $0 music generators lyria-3-{pro,clip}-preview
	// (["text","audio"]) classified free and image/video/audio hybrids
	// (gemini-*-image, gpt-5-image, gemini-omni, gpt-audio) reached the picker.
	it("publishes only text-only-output rows; vision-input chat survives", async () => {
		stubHttp();
		const { all } = await fetchClineCatalog();
		expect(all.map((m) => m.id)).toEqual([
			"openrouter/fusion",
			"nvidia/switchyard",
			"inclusionai/ling-3.2-flash:free",
			"google/gemini-4-hydrogen",
			// recommended free-to-try ids absent from the catalog page
			"cline-free/nemotron-3.5-super-vl",
			"cline-free/solar-mini4",
			"nvidia/nemotron-3.5-lightning-free",
		]);
		// Vision understanding is chat input, not a media output.
		expect(all.find((m) => m.id === "google/gemini-4-hydrogen")?.input).toEqual(
			["text", "image"],
		);
	});

	it("does not classify the $0 lyria music generators as free", async () => {
		stubHttp();
		const { free } = await fetchClineCatalog();
		expect(free.map((m) => m.id).sort()).toEqual(
			[
				"cline-free/nemotron-3.5-super-vl",
				"cline-free/solar-mini4",
				"inclusionai/ling-3.2-flash:free",
				"nvidia/nemotron-3.5-lightning-free",
			].sort(),
		);
	});
});

describe("Cline catalog: routed '-1' pricing (#676)", () => {
	// Recurrence: routers list prompt/completion "-1" (billed at the routed
	// model's rate); parsePricing turned that into a cost of -1,000,000 per
	// million tokens.
	it("stamps routers pricing-unknown with no negative cost, and keeps them paid", async () => {
		stubHttp();
		const { all, free } = await fetchClineCatalog();
		const router = all.find((m) => m.id === "openrouter/fusion") as
			| ((typeof all)[number] & { _pricingKnown?: boolean })
			| undefined;
		expect(router?.cost).toEqual({
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
		});
		expect(router?._pricingKnown).toBe(false);
		expect(router?.name).toContain("💰");
		expect(free.map((m) => m.id)).not.toContain("openrouter/fusion");
	});
});

describe("Cline catalog: abort signal (#676, convention 15)", () => {
	// Recurrence: fetchClineCatalog accepted a signal but never passed it to
	// fetch, so a superseded refresh kept its catalog request open until the
	// fetch timeout.
	it("cancels the in-flight catalog request when the refresh aborts, without a failure log", async () => {
		const home = await mkdtemp(join(tmpdir(), "pi-free-cline-abort-"));
		vi.stubEnv("HOME", home);
		vi.stubEnv("USERPROFILE", home);
		vi.stubEnv("PI_FREE_LOG_PATH", "abort.log");
		vi.stubEnv("PI_FREE_FILE_LOG", "true");
		vi.resetModules();
		const { fetchClineCatalog: fetchCatalog } =
			await import("../providers/cline/cline-models.ts");
		const { flushLogsSync, getLogPath } = await import("../lib/logger.ts");
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
		const pending = fetchCatalog({ signal: controller.signal });
		// Both the catalog and the recommended-models requests are in flight.
		await vi.waitFor(() => expect(seen).toHaveLength(2));
		controller.abort();
		await expect(pending).resolves.toEqual({ all: [], free: [] });
		expect(seen.every((signal) => signal.aborted)).toBe(true);
		// Abort is cancellation, not failure: no "fetch failed" warning.
		flushLogsSync();
		const log = await readFile(getLogPath(), "utf8").catch(() => "");
		expect(log).not.toContain("Cline catalog fetch failed");
	}, 2_000);
});
