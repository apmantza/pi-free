/**
 * TrustedRouter catalog, auth, and request-shaping tests.
 *
 * Drives the real native provider (`trustedrouterProviderOptions` +
 * `createNativeOpenAIProvider`), real `fetchTrustedrouterModels`, real
 * `isFreeModel`, and pi-ai's real Chat Completions request builder. Only HTTP
 * is stubbed, using rows captured verbatim from the public
 * `api.trustedrouter.com/v1/models` endpoint on 2026-11-26.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
	refreshNativeCatalog,
	sentRequestBody,
	useCatalogHttp,
} from "./helpers/native-catalog.ts";

interface TrustedrouterFixtureRow {
	id: string;
	name: string;
	pricing?: Record<string, unknown>;
	architecture?: Record<string, unknown>;
	reasoning?: { supported_efforts?: string[] } | null;
	trustedrouter?: Record<string, unknown>;
}

const FIXTURE = JSON.parse(
	readFileSync(
		new URL(
			"./fixtures/catalogs/trustedrouter-2026-11-26.json",
			import.meta.url,
		),
		"utf8",
	),
) as { data: TrustedrouterFixtureRow[] };

const ROWS = new Map(FIXTURE.data.map((row) => [row.id, row]));

let activeCatalog: TrustedrouterFixtureRow[] = FIXTURE.data;

const http = useCatalogHttp(
	"api.trustedrouter.com",
	() => ({ data: activeCatalog }),
	["TRUSTEDROUTER_API_KEY"],
);

async function refreshed() {
	const { trustedrouterProviderOptions } =
		await import("../providers/trustedrouter/trustedrouter.ts");
	return refreshNativeCatalog(trustedrouterProviderOptions);
}

const requestBody = (
	model: Parameters<typeof sentRequestBody>[1],
	reasoning: string | undefined,
) => sentRequestBody(http, model, reasoning);

const PI_LEVELS = [undefined, "minimal", "low", "medium", "high", "xhigh"];

describe("TrustedRouter catalog admission and free classification", () => {
	it("publishes usable text-only-out chat models and drops hidden, non-chat, and media rows", async () => {
		activeCatalog = FIXTURE.data;
		const { all, free, freeView } = await refreshed();

		expect(all.map((m) => m.id)).toEqual([
			"trustedrouter/free",
			"trustedrouter/auto",
			"trustedrouter/zdr",
			"trustedrouter/e2e",
			"trustedrouter/fast",
			"anthropic/claude-sonnet-4.6",
			"anthropic/claude-fable-5",
			"openai/gpt-5.4",
			"deepseek/deepseek-r1-0528",
			"x-ai/grok-4.20-reasoning",
		]);
		expect(free.map((m) => m.id)).toEqual(["trustedrouter/free"]);
		expect(freeView.map((m) => m.id)).toEqual(["trustedrouter/free"]);
		expect(
			all.find((m) => m.id === "anthropic/claude-sonnet-4.6")?.input,
		).toEqual(["text", "image"]);
		expect(all.find((m) => m.id === "trustedrouter/auto")?.input).toEqual([
			"text",
			"image",
		]);
		expect(all.find((m) => m.id === "trustedrouter/free")?.input).toEqual([
			"text",
		]);
	});

	it("drops internal_only, synthetic_monitor, and missing-modality rows", async () => {
		const base = ROWS.get("trustedrouter/auto")!;
		activeCatalog = [
			base,
			{
				...base,
				id: "trustedrouter/internal-derived",
				trustedrouter: { ...base.trustedrouter, internal_only: true },
			},
			{
				...base,
				id: "trustedrouter/monitor-derived",
				trustedrouter: { ...base.trustedrouter, synthetic_monitor: true },
			},
			{
				...base,
				id: "trustedrouter/no-modality-derived",
				architecture: { input_modalities: ["text"] },
			},
		];

		const { all } = await refreshed();
		expect(all.map((m) => m.id)).toEqual(["trustedrouter/auto"]);
	});

	it("does not classify unpriced or negative-priced router rows as free", async () => {
		const paid = ROWS.get("anthropic/claude-sonnet-4.6")!;
		activeCatalog = [
			paid,
			{
				...paid,
				id: "trustedrouter/unpriced-derived",
				name: "TrustedRouter Unpriced",
				pricing: {},
			},
			{
				...paid,
				id: "trustedrouter/sentinel-derived",
				name: "TrustedRouter Sentinel",
				pricing: { prompt: "-1", completion: "-1" },
			},
		];

		const { all, free, freeView } = await refreshed();
		expect(all.map((m) => m.id)).toContain("trustedrouter/unpriced-derived");
		expect(all.map((m) => m.id)).toContain("trustedrouter/sentinel-derived");
		expect(free).toEqual([]);
		expect(freeView).toEqual([]);
	});

	it("preserves published limits/cache pricing and applies 128K/16K fallbacks when unpublished", async () => {
		activeCatalog = FIXTURE.data;
		const { all } = await refreshed();
		const byId = new Map(all.map((m) => [m.id, m]));

		const sonnet = byId.get("anthropic/claude-sonnet-4.6")!;
		expect(sonnet.contextWindow).toBe(1_000_000);
		expect(sonnet.maxTokens).toBe(128_000);
		expect(sonnet.cost).toEqual({
			input: 3.165,
			output: 15.825,
			cacheRead: 0.3165,
			cacheWrite: 0,
		});

		const freePool = byId.get("trustedrouter/free")!;
		expect(freePool.contextWindow).toBe(128_000);
		expect(freePool.maxTokens).toBe(16_384);

		const grok = byId.get("x-ai/grok-4.20-reasoning")!;
		expect(grok.contextWindow).toBe(128_000);
		expect(grok.maxTokens).toBe(16_384);
	});
});

describe("TrustedRouter reasoning effort", () => {
	it("sends only reasoning_effort values declared by reasoning.supported_efforts at every Pi level", async () => {
		activeCatalog = FIXTURE.data;
		const { all } = await refreshed();
		const offenders: string[] = [];

		for (const model of all) {
			const row = ROWS.get(model.id);
			const declared = row?.reasoning?.supported_efforts;
			if (!Array.isArray(declared)) continue;
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

	it("maps declared efforts accurately across mandatory, optional, empty, and undeclared rows", async () => {
		activeCatalog = FIXTURE.data;
		const byId = new Map((await refreshed()).all.map((m) => [m.id, m]));

		// Mandatory reasoning without "none": off omits reasoning_effort, xhigh -> "xhigh".
		const fable = byId.get("anthropic/claude-fable-5")!;
		expect(await requestBody(fable, undefined)).not.toHaveProperty(
			"reasoning_effort",
		);
		expect((await requestBody(fable, "high")).reasoning_effort).toBe("high");
		expect((await requestBody(fable, "xhigh")).reasoning_effort).toBe("xhigh");

		// Optional reasoning with "max" (no "xhigh") and "none": off -> "none", xhigh -> "max".
		const sonnet = byId.get("anthropic/claude-sonnet-4.6")!;
		expect((await requestBody(sonnet, undefined)).reasoning_effort).toBe(
			"none",
		);
		expect((await requestBody(sonnet, "xhigh")).reasoning_effort).toBe("max");

		// Declared empty supported_efforts: sends no reasoning_effort at any level.
		const r1 = byId.get("deepseek/deepseek-r1-0528")!;
		expect(await requestBody(r1, undefined)).not.toHaveProperty(
			"reasoning_effort",
		);
		expect(await requestBody(r1, "high")).not.toHaveProperty(
			"reasoning_effort",
		);

		// No reasoning object, supported_parameters includes "reasoning": keeps default.
		const fast = byId.get("trustedrouter/fast")!;
		expect((await requestBody(fast, undefined)).reasoning_effort).toBe("none");
		expect((await requestBody(fast, "high")).reasoning_effort).toBe("high");
	});
});

describe("TrustedRouter catalog request and provider registration", () => {
	it("omits Authorization header without a key and sends Bearer token when set", async () => {
		const seenHeaders: Array<Record<string, string>> = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
				const url = new URL(
					input instanceof Request ? input.url : String(input),
				);
				if (url.hostname === "api.trustedrouter.com") {
					seenHeaders.push((init?.headers ?? {}) as Record<string, string>);
					return Response.json({ data: FIXTURE.data });
				}
				return Response.json({});
			}),
		);

		const { fetchTrustedrouterModels } =
			await import("../providers/trustedrouter/trustedrouter-models.ts");
		await fetchTrustedrouterModels("");
		expect(seenHeaders[0]).not.toHaveProperty("Authorization");

		await fetchTrustedrouterModels("tr-test-key");
		expect(seenHeaders[1]).toHaveProperty(
			"Authorization",
			"Bearer tr-test-key",
		);
	});

	it("cancels the in-flight catalog request when the refresh signal aborts", async () => {
		const seen: AbortSignal[] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(
				(_input: unknown, init?: RequestInit) =>
					new Promise<Response>((_resolve, reject) => {
						const signal = init?.signal;
						if (signal) seen.push(signal);
						const abort = () =>
							reject(new DOMException("aborted", "AbortError"));
						if (signal?.aborted) abort();
						signal?.addEventListener("abort", abort);
					}),
			),
		);

		const { fetchTrustedrouterModels } =
			await import("../providers/trustedrouter/trustedrouter-models.ts");
		const controller = new AbortController();
		const pending = fetchTrustedrouterModels("", controller.signal);
		await vi.waitFor(() => expect(seen).toHaveLength(1));
		controller.abort();
		await expect(pending).rejects.toThrow();
		expect(seen[0]?.aborted).toBe(true);
	}, 2_000);

	it("registers the native provider and /toggle-trustedrouter command", async () => {
		const registeredProviders: Array<{ id: string; baseUrl?: string }> = [];
		const registeredCommands: string[] = [];
		const pi = {
			on: vi.fn(),
			registerCommand: vi.fn((name: string) => {
				registeredCommands.push(name);
			}),
			registerProvider: vi.fn((provider: { id: string; baseUrl?: string }) => {
				registeredProviders.push(provider);
			}),
		};

		const { default: trustedrouterProvider } =
			await import("../providers/trustedrouter/trustedrouter.ts");
		await trustedrouterProvider(pi as never);

		expect(registeredProviders).toContainEqual(
			expect.objectContaining({
				id: "trustedrouter",
				baseUrl: "https://api.trustedrouter.com/v1",
			}),
		);
		expect(registeredCommands).toContain("toggle-trustedrouter");
	});
});
