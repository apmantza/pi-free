/**
 * Agnes AI catalog admission and free classification, through the real
 * fetcher + createNativeOpenAIProvider refresh. Only HTTP is stubbed.
 *
 * The catalog is the live public apihub.agnes-ai.com/v1/models response,
 * read 2026-11-15 without a credential. Every row, including the image and
 * video generators, lists `supported_endpoint_types: ["openai"]`, so the
 * catalog carries no modality signal; the model types and free offers come
 * from Agnes's docs (wiki.agnes-ai.com llms.txt "Text" section and the
 * pricing page, read 2026-11-15).
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	refreshNativeCatalog,
	useCatalogHttp,
} from "./helpers/native-catalog.ts";

const CATALOG = JSON.parse(
	readFileSync(
		new URL("./fixtures/catalogs/agnes-2026-11-15.json", import.meta.url),
		"utf8",
	),
) as { data: { id: string }[] };

useCatalogHttp("apihub.agnes-ai.com", () => CATALOG, ["AGNES_API_KEY"]);

async function refreshed() {
	const { agnesProviderOptions } = await import("../providers/agnes/agnes.ts");
	return refreshNativeCatalog(agnesProviderOptions);
}

describe("Agnes AI catalog", () => {
	// Recurrence (#690, defect shape 16): admission was "id has no image/video
	// substring", which admitted agnes-2.5-pro-alpha (no docs page, type
	// unknown) and would drop any text model whose id names its vision input.
	// Only ids the docs list as text models are published.
	it("publishes only the models Agnes documents as text chat", async () => {
		const { all } = await refreshed();
		expect(all.map((m) => m.id).sort()).toEqual([
			"agnes-2.5-flash",
			"agnes-2.5-pro",
			"agnes-2.5-pro-beta",
			"agnes-3.0-flash",
		]);
	});

	// Recurrence (#690): the free set named agnes-2.0-flash (gone from the
	// catalog) and missed agnes-3.0-flash, which the pricing page lists as
	// free, so the free view showed one model of two.
	it("serves the docs' free text models in the free view", async () => {
		const { free } = await refreshed();
		expect(free.map((m) => m.id).sort()).toEqual([
			"agnes-2.5-flash",
			"agnes-3.0-flash",
		]);
	});
});
