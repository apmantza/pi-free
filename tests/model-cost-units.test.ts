/**
 * Published `Model.cost` is US dollars per million tokens (#678).
 *
 * pi-ai's `calculateCost` charges `(model.cost.input / 1_000_000) * tokens`,
 * so a model's cost fields must be the catalog's per-million price. Each case
 * drives a provider's real catalog fetcher (only HTTP is stubbed; models.dev
 * answers an empty catalog so the values are the mapper's own) and charges
 * one million input and one million output tokens through pi-ai.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { calculateCost } from "@earendil-works/pi-ai";
import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

function fixture(name: string): unknown[] {
	return (
		JSON.parse(
			readFileSync(
				new URL(`./fixtures/catalogs/${name}`, import.meta.url),
				"utf8",
			),
		) as { data: unknown[] }
	).data;
}

// Live api.novita.ai/openai/v1/models row (2026-11-14), trimmed to the fields
// the mapper reads plus the decimal price Novita lists beside its integer
// units: 3000 units is "0.3" USD per million.
const NOVITA_ROW = {
	id: "deepseek/deepseek-v4.1-flash-1017",
	object: "model",
	owned_by: "novita",
	input_token_price_per_m: 3000,
	output_token_price_per_m: 12000,
	pricing: {
		prompt: { price_per_m: 3000, price_per_m_decimal: "0.3" },
		completion: { price_per_m: 12000, price_per_m_decimal: "1.2" },
	},
	context_size: 1048576,
	status: 1,
	display_name: "DeepSeek V4.1 Flash 1017",
	model_type: "chat",
	max_output_tokens: 393216,
	features: ["serverless", "function-calling", "reasoning"],
	endpoints: ["chat/completions", "anthropic", "responses"],
	input_modalities: ["text", "image"],
	output_modalities: ["text"],
};

// Live zenmux.ai/api/v1/models row (2026-11-14), trimmed: ZenMux quotes
// `perMTokens` USD.
const ZENMUX_ROW = {
	id: "anthropic/claude-fable-5.2",
	object: "model",
	display_name: "Anthropic: Claude Fable 5.2",
	owned_by: "anthropic",
	input_modalities: ["text", "image", "file"],
	output_modalities: ["text"],
	capabilities: { reasoning: true },
	context_length: 1000000,
	max_tokens: 128000,
	pricings: {
		completion: [{ value: 40, unit: "perMTokens", currency: "USD" }],
		input_cache_read: [{ value: 0.2, unit: "perMTokens", currency: "USD" }],
		prompt: [{ value: 8, unit: "perMTokens", currency: "USD" }],
	},
};

// Live api.routeway.ai/v1/models row (2026-11-14), trimmed: Routeway quotes
// `price_per_million_t`.
const ROUTEWAY_ROW = {
	id: "claude-fable-5-2",
	name: "Anthropic: Claude Fable 5 2",
	short_name: "Claude Fable 5 2",
	context_length: 1000000,
	available: true,
	endpoints: ["/v1/chat/completions", "/v1/responses", "/v1/messages"],
	pricing: {
		input: { unit: "1M tokens", price_per_million_t: 8 },
		output: { unit: "1M tokens", price_per_million_t: 40 },
		caching: { read: { unit: "1M tokens", price_per_million_t: 0.2 } },
	},
	capabilities: { vision: true, function_call: true, reasoning: true },
};

const CATALOGS: Record<string, unknown[]> = {
	"api.fastrouter.ai": fixture("fastrouter-2026-11-14.json"),
	"api.deepinfra.com": fixture("deepinfra-2026-11-14.json"),
	"api.novita.ai": [NOVITA_ROW],
	"zenmux.ai": [ZENMUX_ROW],
	"api.routeway.ai": [ROUTEWAY_ROW],
	// Both Cline endpoints share the host; the recommended list reads empty.
	"api.cline.bot": fixture("cline-models-2026-11-14.json"),
};

let home: string;

beforeEach(() => {
	mkdirSync(resolve(".smoke-artifacts"), { recursive: true });
	home = mkdtempSync(resolve(".smoke-artifacts", "cost-units-"));
	vi.stubEnv("HOME", home);
	vi.stubEnv("USERPROFILE", home);
	vi.stubEnv("PI_CODING_AGENT_DIR", resolve(home, ".pi/agent"));
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: string | URL | Request) => {
			const url = new URL(input instanceof Request ? input.url : String(input));
			if (url.hostname === "models.dev") return Response.json({});
			const data = CATALOGS[url.hostname];
			return data
				? Response.json({ data })
				: new Response(null, { status: 503 });
		}),
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
	rmSync(home, { recursive: true, force: true });
});

/** pi-ai's charge for one million input and one million output tokens. */
function chargeForMillion(model: ProviderModelConfig | undefined) {
	expect(model, "model published").toBeDefined();
	const cost = calculateCost(model as Parameters<typeof calculateCost>[0], {
		input: 1_000_000,
		output: 1_000_000,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 2_000_000,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	});
	return { input: cost.input, output: cost.output };
}

// Recurrence: OpenRouter-style catalogs quote USD per token ("0.000002");
// the shared mapper copied that string as-is, so pi-ai charged $0.000002 for
// a million tokens of a $2/M model.
it("charges an OpenRouter-style catalog's per-token price per million tokens", async () => {
	const { fetchFastrouterModels } =
		await import("../providers/fastrouter/fastrouter-models.ts");
	const models = await fetchFastrouterModels("");
	// Catalog: prompt "0.000002", completion "0.00001" USD per token.
	expect(
		chargeForMillion(
			models.find((m) => m.id === "anthropic/claude-sonnet-5.5"),
		),
	).toEqual({ input: 2, output: 10 });
});

// Cline maps its OpenRouter-style catalog with its own mapper; it must use
// the same per-token conversion as the shared one.
it("charges Cline's per-token price per million tokens", async () => {
	const { fetchClineCatalog } =
		await import("../providers/cline/cline-models.ts");
	const { all } = await fetchClineCatalog();
	// Catalog: prompt "0.0000015", completion "0.0000075" USD per token.
	expect(
		chargeForMillion(all.find((m) => m.id === "google/gemini-4-hydrogen")),
	).toEqual({ input: 1.5, output: 7.5 });
});

// Recurrence: per-million catalogs were divided by 1e6 into the per-token
// unit pi-ai does not use, so a $14.25/M output price charged $0.00001425.
it("charges a per-million catalog's price unchanged", async () => {
	const { fetchDeepinfraModels } =
		await import("../providers/deepinfra/deepinfra.ts");
	const models = await fetchDeepinfraModels("");
	// Catalog: input_tokens 2.85 (as 2.8499999999999996), output_tokens 14.25.
	const charge = chargeForMillion(
		models.find((m) => m.id === "moonshotai/Kimi-K3"),
	);
	expect(charge.input).toBeCloseTo(2.85, 9);
	expect(charge.output).toBe(14.25);
});

// Recurrence: Novita's integer `*_price_per_m` is 1/10,000 USD per million
// (3000 beside `price_per_m_decimal: "0.3"`); dividing by 1e6 charged a
// $0.30/M model $0.003 per million tokens.
it("charges Novita's documented decimal price per million tokens", async () => {
	const { fetchNovitaModels } = await import("../providers/novita/novita.ts");
	const models = await fetchNovitaModels("");
	expect(chargeForMillion(models[0])).toEqual({ input: 0.3, output: 1.2 });
});

// Recurrence: ZenMux's `perMTokens` prices were divided by 1e6.
it("charges ZenMux's per-million price unchanged", async () => {
	const { fetchZenmuxCatalog } =
		await import("../providers/zenmux/zenmux-models.ts");
	const { all } = await fetchZenmuxCatalog({});
	expect(chargeForMillion(all[0])).toEqual({ input: 8, output: 40 });
});

// Recurrence: Routeway's `price_per_million_t` was divided by 1e6. Its
// catalog fetcher is private, so this drives the native provider it
// registers, refreshed the way Pi refreshes it.
it("charges Routeway's per-million price unchanged", async () => {
	const { default: routewayProvider } =
		await import("../providers/routeway/routeway.ts");
	const providers: Array<{
		getModels(): ProviderModelConfig[];
		refreshModels?(context: unknown): Promise<void>;
	}> = [];
	const noop = () => {};
	await routewayProvider({
		on: noop,
		registerCommand: noop,
		registerProvider: (provider: (typeof providers)[number]) => {
			providers.push(provider);
		},
	} as never);
	const provider = providers[0]!;
	await provider.refreshModels?.({
		allowNetwork: true,
		credential: { type: "api_key", key: "rw-key" },
		publish: async (publication: { update?: () => void }) => {
			publication.update?.();
			return true;
		},
		signal: new AbortController().signal,
	});
	expect(chargeForMillion(provider.getModels()[0])).toEqual({
		input: 8,
		output: 40,
	});
});
