/**
 * OpenGateway's startup seed against the live catalog (#675).
 *
 * The seed (`initialModels`) is what the picker shows before the first
 * refresh. Only HTTP is stubbed: /v1/models answers rows captured live on
 * 2026-11-14 (unchanged apart from the dropped `description` prose).
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// Live /v1/models rows (2026-11-14). `aliases` is how the gateway resolves
// an older id: inclusionai/ling-3.0-flash:free now routes to the paid
// ling-3.1-flash, and the retired nemotron-3-ultra :free id to the free
// nemotron-3.5-super-vl:free.
const CATALOG = [
	{
		id: "auto",
		object: "model",
		name: "Auto (smart routing)",
		aliases: ["twigpine/auto", "gitlawb/auto"],
		context_window: null,
		pricing: null,
		effective_pricing: null,
		promo: null,
		supports_tools: null,
		latency: null,
		created: 1783468800,
		x402_price: null,
		docs_url: "https://twigpine.com/opengateway",
		status: "active",
		successor: null,
		retired_at: null,
	},
	{
		id: "mindai/macaron-v1-tall",
		object: "model",
		name: "Macaron V1 Tall",
		aliases: [],
		context_window: 262144,
		pricing: {
			prompt: "0.00000045",
			completion: "0.0000026",
			input_cache_read: "0.00000008",
		},
		effective_pricing: {
			prompt: "0.00000054",
			completion: "0.00000312",
			input_cache_read: "0.000000096",
		},
		promo: null,
		supports_tools: true,
		latency: "fast",
		created: 1785369600,
		x402_price: { usd: "0.02", max_output_tokens: 4096 },
		docs_url: "https://twigpine.com/opengateway",
		status: "active",
		successor: null,
		retired_at: null,
	},
	{
		id: "nvidia/nemotron-3.5-super-vl:free",
		object: "model",
		name: "Nemotron 3.5 Super VL (free)",
		aliases: ["nvidia/nemotron-3-ultra-550b-a55b:free"],
		context_window: 1000000,
		pricing: { prompt: "0", completion: "0", input_cache_read: "0" },
		effective_pricing: { prompt: "0", completion: "0", input_cache_read: "0" },
		promo: null,
		supports_tools: true,
		latency: "medium",
		created: 1794182400,
		x402_price: null,
		docs_url: "https://twigpine.com/opengateway",
		status: "active",
		successor: null,
		retired_at: null,
	},
	{
		id: "nvidia/nemotron-3.5-super-vl",
		object: "model",
		name: "Nemotron 3.5 Super VL",
		aliases: ["nvidia/nemotron-3-ultra-550b-a55b"],
		context_window: 1048576,
		pricing: {
			prompt: "0.00000015",
			completion: "0.0000005",
			input_cache_read: "0.00000002",
		},
		effective_pricing: {
			prompt: "0.00000018",
			completion: "0.0000006",
			input_cache_read: "0.000000024",
		},
		promo: null,
		supports_tools: true,
		latency: "medium",
		created: 1794182400,
		x402_price: { usd: "0.01", max_output_tokens: 4096 },
		docs_url: "https://twigpine.com/opengateway",
		status: "active",
		successor: null,
		retired_at: null,
	},
	{
		id: "inclusionai/ling-3.1-flash",
		object: "model",
		name: "Ling 3.1 Flash",
		aliases: [
			"inclusionai/ling-3.0-flash:free",
			"inclusionai/ling-3.0-flash",
			"inclusionai/ling-3.0-tiny:free",
		],
		context_window: 1000000,
		pricing: {
			prompt: "0.000000075",
			completion: "0.000000225",
			input_cache_read: "0.000000015",
		},
		effective_pricing: {
			prompt: "0.00000009",
			completion: "0.00000027",
			input_cache_read: "0.000000018",
		},
		promo: null,
		supports_tools: true,
		latency: "fast",
		created: 1794182400,
		x402_price: { usd: "0.005", max_output_tokens: 4096 },
		docs_url: "https://twigpine.com/opengateway",
		status: "active",
		successor: null,
		retired_at: null,
	},
	{
		id: "xiaomi/mimo-v2.6-flash",
		object: "model",
		name: "MiMo V2.6-Flash",
		aliases: ["xiaomi/mimo-v2.5", "mimo-v2.5"],
		context_window: 262144,
		pricing: {
			prompt: "0.00000014",
			completion: "0.00000028",
			input_cache_read: "0.0000000028",
		},
		effective_pricing: {
			prompt: "0.000000168",
			completion: "0.000000336",
			input_cache_read: "0.00000000336",
		},
		promo: null,
		supports_tools: true,
		latency: "fast",
		created: 1792540800,
		x402_price: { usd: "0.005", max_output_tokens: 4096 },
		docs_url: "https://twigpine.com/opengateway",
		status: "active",
		successor: null,
		retired_at: null,
	},
];

let home: string;

beforeEach(() => {
	mkdirSync(resolve(".smoke-artifacts"), { recursive: true });
	home = mkdtempSync(resolve(".smoke-artifacts", "opengateway-"));
	vi.stubEnv("HOME", home);
	vi.stubEnv("USERPROFILE", home);
	vi.stubEnv("PI_CODING_AGENT_DIR", resolve(home, ".pi/agent"));
	vi.stubEnv("OPENGATEWAY_API_KEY", "ogw_live_test");
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: string | URL | Request) => {
			const url = new URL(input instanceof Request ? input.url : String(input));
			if (url.pathname === "/v1/models")
				return Response.json({ object: "list", data: CATALOG });
			return new Response(null, { status: 503 });
		}),
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
	rmSync(home, { recursive: true, force: true });
});

// Pre-fix the seed offered mindai/macaron-v1-tall ($0.54/$3.12 per 1M live)
// and inclusionai/ling-3.0-flash:free (an alias of the paid ling-3.1-flash)
// at $0, so the free view listed paid models until the first refresh.
it("never seeds a free model the live catalog does not serve free", async () => {
	const { createNativeOpenAIProvider } =
		await import("../lib/native-provider.ts");
	const { createOpengatewayProviderOptions } =
		await import("../providers/opengateway/opengateway.ts");
	const handle = createNativeOpenAIProvider(createOpengatewayProviderOptions());
	const seededFree = handle.stored.free.map((m) => m.id);

	let persisted: unknown;
	const store = {
		read: async () => persisted,
		write: async (next: unknown) => {
			persisted = next;
		},
		delete: async () => {
			persisted = undefined;
		},
	};
	await handle.provider.refreshModels?.({ store, allowNetwork: true } as never);
	const liveFree = new Set(handle.stored.free.map((m) => m.id));
	expect([...liveFree]).toEqual(["nvidia/nemotron-3.5-super-vl:free"]);

	const resolveLive = (id: string) =>
		CATALOG.find((row) => row.id === id || row.aliases.includes(id))?.id;
	for (const id of seededFree) {
		expect(liveFree.has(resolveLive(id) ?? ""), id).toBe(true);
	}
});
