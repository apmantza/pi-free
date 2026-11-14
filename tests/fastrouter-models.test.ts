/**
 * FastRouter catalog admission and free classification over live rows (#676),
 * through the real fetchFastrouterModels -> mapping -> isFreeModel path.
 * Only HTTP is stubbed.
 *
 * The fixture holds rows captured verbatim from the public
 * api.fastrouter.ai/api/v1/models endpoint on 2026-11-14.
 */

import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isFreeModel } from "../lib/registry.ts";
import { fetchFastrouterModels } from "../providers/fastrouter/fastrouter-models.ts";

const fixture = JSON.parse(
	readFileSync(
		new URL("./fixtures/catalogs/fastrouter-2026-11-14.json", import.meta.url),
		"utf8",
	),
) as { data: unknown[] };

const requests: Array<{ url: string; init: RequestInit | undefined }> = [];

function stubHttp(data: unknown[] = fixture.data) {
	requests.length = 0;
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
			const url = String(input);
			requests.push({ url, init });
			const body = url.startsWith("https://api.fastrouter.ai/") ? { data } : {};
			return new Response(JSON.stringify(body), { status: 200 });
		}),
	);
}

function catalogRequestHeaders(): Record<string, string> {
	const request = requests.find((r) => r.url.endsWith("/models"));
	return (request?.init?.headers ?? {}) as Record<string, string>;
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("FastRouter catalog admission (#676)", () => {
	// Recurrence: only output modalities were filtered, so speech-to-text
	// models (["audio"] in, ["text"] out) reached the picker and the $0 ones
	// (deepgram/nova-3, openai/gpt-transcribe) classified free.
	it("publishes only text-in, text-only-out rows", async () => {
		stubHttp();
		const ids = (await fetchFastrouterModels("")).map((m) => m.id);
		expect(ids).toEqual([
			"fastrouter/auto",
			"google/gemma4-26b:free",
			"openai/gpt-oss-20b:free",
			"google/gemma-4-26b-a4b-it",
			"anthropic/claude-sonnet-5.5",
			"google/gemini-3.1-flash-lite",
		]);
	});

	it("keeps multimodal-input chat models (vision, audio understanding)", async () => {
		stubHttp();
		const models = await fetchFastrouterModels("");
		expect(
			models.find((m) => m.id === "anthropic/claude-sonnet-5.5")?.input,
		).toEqual(["text", "image"]);
		expect(models.map((m) => m.id)).toContain("google/gemini-3.1-flash-lite");
	});

	// The gate admits a known-good shape and refuses the rest: a row whose
	// output modality is not stated is not assumed to be chat.
	it("refuses a row with no output-modality signal", async () => {
		const row = structuredClone(
			fixture.data.find(
				(r) => (r as { id: string }).id === "openai/gpt-oss-20b:free",
			),
		) as { architecture: Record<string, unknown> };
		delete row.architecture.output_modalities;
		stubHttp([row]);
		expect(await fetchFastrouterModels("")).toEqual([]);
	});
});

describe("FastRouter free classification (#676)", () => {
	// Recurrence: fastrouter/auto lists $0 but bills at the routed model's
	// rate, so price-based classification put it in the free view. The
	// catalog's own `models_extra_params.free_slug_enabled` is authoritative.
	it("classifies exactly the free_slug_enabled rows free", async () => {
		stubHttp();
		const models = await fetchFastrouterModels("");
		const free = models
			.filter((m) => isFreeModel({ ...m, provider: "fastrouter" }, models))
			.map((m) => m.id);
		expect(free).toEqual(["google/gemma4-26b:free", "openai/gpt-oss-20b:free"]);
	});
});

describe("FastRouter catalog request", () => {
	// Recurrence: an empty `Bearer ` header can make a public catalog
	// endpoint refuse logged-out discovery.
	it("sends no Authorization header without a key, and the key when set", async () => {
		stubHttp();
		await fetchFastrouterModels("");
		expect(catalogRequestHeaders()).not.toHaveProperty("Authorization");

		stubHttp();
		await fetchFastrouterModels("fr-key");
		expect(catalogRequestHeaders()).toHaveProperty(
			"Authorization",
			"Bearer fr-key",
		);
	});

	// Recurrence: a superseded refresh must cancel its catalog request instead
	// of holding it open until the fetch timeout (convention 15).
	it("cancels the in-flight request when the refresh signal aborts", async () => {
		const seen: AbortSignal[] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(
				(_input: unknown, init?: RequestInit) =>
					new Promise<Response>((_resolve, reject) => {
						const signal = init?.signal;
						if (signal) seen.push(signal);
						signal?.addEventListener("abort", () =>
							reject(new DOMException("aborted", "AbortError")),
						);
					}),
			),
		);
		const controller = new AbortController();
		const pending = fetchFastrouterModels("", controller.signal);
		await vi.waitFor(() => expect(seen).toHaveLength(1));
		controller.abort();
		await expect(pending).rejects.toThrow();
		expect(seen[0]?.aborted).toBe(true);
	}, 2_000);
});
