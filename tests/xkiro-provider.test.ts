/**
 * Xkiro catalog and request shaping, driven through the real native provider
 * (fetchXkiroModels + createNativeOpenAIProvider refresh) and pi-ai's real
 * Chat Completions request builder. Only HTTP is stubbed.
 *
 * The catalog is the live public api.xkiro.com/v1/models response, read
 * 2026-11-15 without a credential (tests/fixtures/catalogs).
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	refreshNativeCatalog,
	sentRequestBody,
	useCatalogHttp,
} from "./helpers/native-catalog.ts";

interface XkiroRow {
	id: string;
	access_tier?: string;
	capabilities?: { tools?: boolean; reasoning?: boolean } | null;
	reasoning_efforts?: { levels?: string[] } | null;
}

const CATALOG = JSON.parse(
	readFileSync(
		new URL("./fixtures/catalogs/xkiro-2026-11-15.json", import.meta.url),
		"utf8",
	),
) as { data: XkiroRow[] };

const ROWS = new Map(CATALOG.data.map((row) => [row.id, row]));

const http = useCatalogHttp("api.xkiro.com", () => CATALOG, ["XKIRO_API_KEY"]);

async function refreshed() {
	const { xkiroProviderOptions } = await import("../providers/xkiro/xkiro.ts");
	return refreshNativeCatalog(xkiroProviderOptions);
}

const requestBody = (
	model: Parameters<typeof sentRequestBody>[1],
	reasoning: string | undefined,
) => sentRequestBody(http, model, reasoning);

const PI_LEVELS = [undefined, "minimal", "low", "medium", "high", "xhigh"];

describe("Xkiro reasoning effort", () => {
	// Recurrence (#690): every reasoning model carried a hard-coded
	// `thinkingLevelMap { off: "none" }`, so a turn with thinking off sent
	// reasoning_effort "none" to models whose catalog row lists only
	// low/medium/high (claude-opus-4.5, gemini-*), and Pi's own level names
	// went to on/off toggles (nemotron: "off"/"on"). The wire value must
	// always be one the model's `reasoning_efforts.levels` declares.
	it("sends only reasoning_effort values the model declares, at every Pi level", async () => {
		const { all } = await refreshed();
		const offenders: string[] = [];
		for (const model of all) {
			const declared = ROWS.get(model.id)?.reasoning_efforts?.levels ?? [];
			for (const level of PI_LEVELS) {
				const body = await requestBody(model, level);
				if (!("reasoning_effort" in body)) continue;
				if (!declared.includes(String(body.reasoning_effort))) {
					offenders.push(
						`${model.id} @${level ?? "off"} -> ${String(body.reasoning_effort)}`,
					);
				}
			}
		}
		expect(offenders).toEqual([]);
	}, 30_000);

	it("maps Pi levels onto a model's declared levels", async () => {
		const byId = new Map((await refreshed()).all.map((m) => [m.id, m]));
		const toggle = byId.get("nvidia/nemotron-3-ultra")!;
		expect((await requestBody(toggle, "high")).reasoning_effort).toBe("on");
		expect((await requestBody(toggle, undefined)).reasoning_effort).toBe("off");
		const graded = byId.get("anthropic/claude-opus-4.5")!;
		expect((await requestBody(graded, "high")).reasoning_effort).toBe("high");
		expect(await requestBody(graded, undefined)).not.toHaveProperty(
			"reasoning_effort",
		);
		const withNone = byId.get("openai/gpt-6-sol")!;
		expect((await requestBody(withNone, undefined)).reasoning_effort).toBe(
			"none",
		);
	});
});

describe("Xkiro catalog admission", () => {
	// Recurrence (#690): rows with `capabilities.tools: false` (4 free on
	// 2026-11-15: aya-vision-32b, aya-expanse-32b, north-small-translate,
	// command-a-vision) were offered to a coding agent that always sends
	// tools. Only rows that declare tool support are published.
	it("publishes only models that declare tool calling", async () => {
		const { all, free } = await refreshed();
		const withTools = CATALOG.data
			.filter((row) => row.capabilities?.tools === true)
			.map((row) => row.id)
			.sort();
		expect(all.map((m) => m.id).sort()).toEqual(withTools);
		expect(free.map((m) => m.id).sort()).toEqual(
			CATALOG.data
				.filter(
					(row) =>
						row.capabilities?.tools === true && row.access_tier === "free",
				)
				.map((row) => row.id)
				.sort(),
		);
	});
});
