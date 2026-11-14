/**
 * Routeway catalog admission and cache-write prices over live rows (#690),
 * through the real fetchRoutewayModels -> mapping -> isFreeModel path. Only
 * HTTP is stubbed (models.dev answers an empty catalog).
 *
 * The fixture holds rows captured verbatim from the public
 * api.routeway.ai/v1/models endpoint on 2026-11-15.
 */

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { isFreeModel } from "../lib/registry.ts";
import { fetchRoutewayModels } from "../providers/routeway/routeway.ts";

const fixture = JSON.parse(
	readFileSync(
		new URL("./fixtures/catalogs/routeway-2026-11-15.json", import.meta.url),
		"utf8",
	),
) as { data: unknown[] };

beforeEach(() => {
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: string | URL | Request) => {
			const url = String(input instanceof Request ? input.url : input);
			const body = url.startsWith("https://api.routeway.ai/")
				? { data: fixture.data }
				: {};
			return new Response(JSON.stringify(body), { status: 200 });
		}),
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

// Recurrence: rows with capabilities.function_call false (28 of 223 live
// chat rows, e.g. qwen3.5-27b) were offered to the agent.
it("publishes only rows that declare function calling", async () => {
	const all = await fetchRoutewayModels("");
	expect(all.map((m) => m.id)).toEqual([
		"claude-fable-5-2",
		"gpt-6.1-sol",
		"deepseek-v4.1-flash:free",
	]);
	const free = all
		.filter((m) => isFreeModel({ ...m, provider: "routeway" }, all))
		.map((m) => m.id);
	expect(free).toEqual(["deepseek-v4.1-flash:free"]);
});

// Recurrence: pricing.caching.write is keyed by lifetime ({"5m":…,"1h":…}
// or {"1h":…}) and was read as a flat price, so every cache write was $0.
it("publishes the cache-write price from the lifetime tiers", async () => {
	const byId = new Map(
		(await fetchRoutewayModels("")).map((m) => [m.id, m.cost]),
	);
	expect(byId.get("claude-fable-5-2")?.cacheWrite).toBe(10);
	expect(byId.get("gpt-6.1-sol")?.cacheWrite).toBe(2.5);
});
