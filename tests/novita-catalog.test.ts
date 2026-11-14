/**
 * Novita catalog admission, pricing provenance and cache prices over live
 * rows (#690), through the real fetchNovitaModels -> mapping -> isFreeModel
 * path. Only HTTP is stubbed (models.dev answers an empty catalog, so the
 * values are the mapper's own).
 *
 * The fixture holds rows captured verbatim from the public
 * api.novita.ai/openai/v1/models endpoint on 2026-11-15.
 */

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { isFreeModel } from "../lib/registry.ts";
import { fetchNovitaModels } from "../providers/novita/novita.ts";

const fixture = JSON.parse(
	readFileSync(
		new URL("./fixtures/catalogs/novita-2026-11-15.json", import.meta.url),
		"utf8",
	),
) as { data: unknown[] };

beforeEach(() => {
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: string | URL | Request) => {
			const url = String(input instanceof Request ? input.url : input);
			const body = url.startsWith("https://api.novita.ai/")
				? { data: fixture.data }
				: {};
			return new Response(JSON.stringify(body), { status: 200 });
		}),
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

async function catalog() {
	const all = await fetchNovitaModels("sk-fixture");
	const free = all
		.filter((m) => isFreeModel({ ...m, provider: "novita" }, all))
		.map((m) => m.id);
	return { all, byId: new Map(all.map((m) => [m.id, m])), free };
}

// Recurrence: rows whose features omit "function-calling" (15 live, e.g.
// meta-llama/llama-3.1-8b-instruct) were offered to the agent.
it("publishes only rows that declare function calling", async () => {
	const { all } = await catalog();
	expect(all.map((m) => m.id)).not.toContain(
		"meta-llama/llama-3.1-8b-instruct",
	);
	expect(all).toHaveLength(7);
});

// Recurrence (defect shape 15): rows with `pricing: null` carry flat 0
// prices that are placeholders; nvrouter/auto and nvrouter/fusion are
// routers billed at the routed model's rate. All five were in the free view.
it("does not classify rows without a pricing block as free", async () => {
	const { byId, free } = await catalog();
	expect(free).toEqual([]);
	for (const id of [
		"nvrouter/auto",
		"nvrouter/fusion",
		"bunny",
		"apodex/apodex-1.1-mini",
		"dev/glm46",
	]) {
		expect(
			(byId.get(id) as { _pricingKnown?: boolean } | undefined)?._pricingKnown,
		).toBe(false);
	}
	expect(
		(
			byId.get("deepseek/deepseek-v4.1-flash-1017") as {
				_pricingKnown?: boolean;
			}
		)._pricingKnown,
	).toBe(true);
});

// Recurrence: cache prices were always published as 0, so pi-ai charged
// cached input and cache writes nothing. Units: 60 is $0.006 per million.
it("publishes the cache-read and cache-write prices", async () => {
	const { byId } = await catalog();
	expect(byId.get("deepseek/deepseek-v4.1-flash-1017")?.cost).toEqual({
		input: 0.3,
		output: 1.2,
		cacheRead: 0.006,
		cacheWrite: 0,
	});
	expect(byId.get("moonshotai/kimi-k3.1-pro-highspeed")?.cost).toEqual({
		input: 4,
		output: 20,
		cacheRead: 0.2,
		cacheWrite: 4,
	});
});
