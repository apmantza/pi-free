/**
 * Requesty catalog admission and output limits over live rows (#690),
 * through the real fetchRequestyModels -> mapping -> isFreeModel path. Only
 * HTTP is stubbed, and the clock is pinned to the capture date because
 * retirement is judged against it.
 *
 * The fixture holds rows captured verbatim from the public
 * router.requesty.ai/v1/models endpoint on 2026-11-15.
 */

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { isFreeModel } from "../lib/registry.ts";
import { fetchRequestyModels } from "../providers/requesty/requesty-models.ts";

const fixture = JSON.parse(
	readFileSync(
		new URL("./fixtures/catalogs/requesty-2026-11-15.json", import.meta.url),
		"utf8",
	),
) as { data: unknown[] };

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date("2026-11-15T12:00:00Z"));
	vi.stubGlobal(
		"fetch",
		vi.fn(
			async () =>
				new Response(JSON.stringify({ data: fixture.data }), { status: 200 }),
		),
	);
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

// Recurrences: rows past their `retires` date stayed listed (38 live:
// google/gemini-2.5-flash retired 2026-10-16, deepseek/deepseek-chat
// 2026-07-24), and rows stating supports_tool_calling false (31 live:
// perplexity/sonar, melious/clef) were offered to the agent. openai/gpt-4.1
// retires 2027-01-14 and stays.
it("publishes only served, tool-calling rows", async () => {
	const ids = (await fetchRequestyModels("")).map((m) => m.id);
	expect(ids).toEqual([
		"deepinfra/deepseek-v4.1-flash-1017",
		"google/gemma-4-31b-it",
		"openai/gpt-4.1",
	]);
});

// Retirement is judged when the catalog is fetched, not at capture time.
it("drops openai/gpt-4.1 once its retirement date passes", async () => {
	vi.setSystemTime(new Date("2027-01-15T00:00:00Z"));
	const ids = (await fetchRequestyModels("")).map((m) => m.id);
	expect(ids).not.toContain("openai/gpt-4.1");
});

// Recurrence: max_output_tokens 0 (unpublished, 114 live rows) fell back to
// 4096, which cut long answers short.
it("does not cap an unpublished output limit at 4096", async () => {
	const byId = new Map(
		(await fetchRequestyModels("")).map((m) => [
			m.id,
			(m as { maxTokens?: number }).maxTokens,
		]),
	);
	expect(byId.get("deepinfra/deepseek-v4.1-flash-1017")).toBe(16_384);
	expect(byId.get("openai/gpt-4.1")).toBe(32_768);
});

// The free view is unchanged by the admission rules.
it("keeps the $0 tool-calling row free", async () => {
	const all = await fetchRequestyModels("");
	const free = all
		.filter((m) => isFreeModel({ ...m, provider: "requesty" }, all))
		.map((m) => m.id);
	expect(free).toEqual(["google/gemma-4-31b-it"]);
});
