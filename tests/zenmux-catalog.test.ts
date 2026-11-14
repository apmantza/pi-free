/**
 * ZenMux output limits and cache-write prices over live rows (#690),
 * through the real fetchZenmuxCatalog -> mapping -> isFreeModel path. Only
 * HTTP is stubbed (models.dev answers an empty catalog, so the values are
 * the mapper's own).
 *
 * The fixture holds rows captured verbatim from the public
 * zenmux.ai/api/v1/models endpoint on 2026-11-15.
 */

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fetchZenmuxCatalog } from "../providers/zenmux/zenmux-models.ts";

const fixture = JSON.parse(
	readFileSync(
		new URL("./fixtures/catalogs/zenmux-2026-11-15.json", import.meta.url),
		"utf8",
	),
) as { data: unknown[] };

beforeEach(() => {
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: string | URL | Request) => {
			const url = String(input instanceof Request ? input.url : input);
			const body = url.startsWith("https://zenmux.ai/")
				? { data: fixture.data }
				: {};
			return new Response(JSON.stringify(body), { status: 200 });
		}),
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

async function byId() {
	const { all } = await fetchZenmuxCatalog({ token: "zm-fixture" });
	return new Map(
		all.map((m) => [
			m.id,
			m as typeof m & { maxTokens: number; cost: { cacheWrite: number } },
		]),
	);
}

// Recurrence: the catalog's max_tokens was ignored and every model got half
// its window (claude-fable-5.2: 500000 instead of 128000), more than the
// upstream accepts. Rows without max_tokens (openai/o4-mini) keep the
// half-window fallback.
it("publishes the catalog's output limit", async () => {
	const models = await byId();
	expect(models.get("anthropic/claude-fable-5.2")?.maxTokens).toBe(128_000);
	expect(models.get("google/gemini-4-hydrogen")?.maxTokens).toBe(65_536);
	expect(models.get("openai/o4-mini")?.maxTokens).toBe(100_000);
});

// Recurrence: cache-write prices were always published as 0. ZenMux lists
// input_cache_write, or per-lifetime _5_min/_1_h, or _1_h only.
it("publishes the cache-write price", async () => {
	const models = await byId();
	expect(models.get("google/gemini-4-hydrogen")?.cost.cacheWrite).toBe(1.875);
	expect(models.get("anthropic/claude-fable-5.2")?.cost.cacheWrite).toBe(10);
	expect(models.get("bytedance/doubao-seed-2.1-turbo")?.cost.cacheWrite).toBe(
		0.0025,
	);
});

// The free view is unchanged by the limit and cache fields.
it("keeps the $0 model free", async () => {
	const { free } = await fetchZenmuxCatalog({ token: "zm-fixture" });
	expect(free.map((m) => m.id)).toEqual(["z-ai/glm-4.7-flash-free"]);
});
