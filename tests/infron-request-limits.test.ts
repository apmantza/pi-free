/**
 * Infron request sizing and transport, driven through the real native
 * provider: catalog refresh (fetchInfronModels + createNativeOpenAIProvider)
 * and the real pi-ai Chat Completions stream. Only HTTP is stubbed.
 *
 * Catalog rows are trimmed copies of the live public catalog
 * (llm.onerouter.pro/v1/models, read 2026-11-14).
 */

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import type { Api, Model } from "@earendil-works/pi-ai/compat";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const BASE = {
	object: "model",
	category_type: "LLM",
	is_display_only: false,
	deprecated: false,
	output_modalities: ["text"],
	supports_streaming: true,
};

const CATALOG = [
	{
		...BASE,
		id: "qwen/qwen3.8-27b:free",
		display_name: "Qwen: Qwen3.8 27B Uncensored (Free)",
		context_length: 256_000,
		max_input_tokens: 256_000,
		max_output_tokens: 256_000,
		input_modalities: ["text", "image", "video"],
		min_prompt_price: 0,
		min_completion_price: 0,
		supported_endpoint_types: ["openai"],
		providers: [{ provider_slug: "infron/us", context_length: 204_000 }],
	},
	{
		...BASE,
		id: "qwen/qwen3.5-122b-a10b",
		display_name: "Qwen: Qwen3.5 122B A10B",
		context_length: 262_144,
		max_input_tokens: 262_144,
		max_output_tokens: 65_500,
		input_modalities: ["text"],
		min_prompt_price: 0.4,
		min_completion_price: 3.2,
		supported_endpoint_types: ["openai"],
		providers: [
			{ provider_slug: "alibaba/sg", context_length: 262_100 },
			{ provider_slug: "deepinfra", context_length: 16_384 },
			{ provider_slug: "atlas-cloud", context_length: 262_140 },
		],
	},
	{
		...BASE,
		id: "z-ai/glm-4.7",
		display_name: "Z.ai: GLM 4.7",
		context_length: 200_000,
		max_input_tokens: 200_000,
		max_output_tokens: 128_000,
		input_modalities: ["text"],
		min_prompt_price: 0.6,
		min_completion_price: 2.2,
		supported_endpoint_types: ["openai"],
		providers: [{ provider_slug: "z-ai", context_length: 204_800 }],
	},
	{
		...BASE,
		id: "openai/gpt-5-chat",
		display_name: "OpenAI: GPT-5 Chat",
		context_length: 128_000,
		max_input_tokens: 16_400,
		max_output_tokens: 16_400,
		input_modalities: ["text", "image"],
		min_prompt_price: 1.25,
		min_completion_price: 10,
		supported_endpoint_types: ["openai"],
		providers: [{ provider_slug: "azure", context_length: 400 }],
	},
	{
		...BASE,
		id: "openai/gpt-5-codex",
		display_name: "OpenAI: GPT-5 Codex",
		context_length: 400_000,
		max_input_tokens: 400_000,
		max_output_tokens: 128_000,
		input_modalities: ["text", "image"],
		min_prompt_price: 1.25,
		min_completion_price: 10,
		supported_endpoint_types: ["openai-response"],
		providers: [{ provider_slug: "azure", context_length: 400_000 }],
	},
	{
		...BASE,
		id: "google/gemini-4-hydrogen",
		display_name: "Google: Gemini 4 Hydrogen",
		context_length: 1_048_576,
		max_output_tokens: 65_536,
		input_modalities: ["text", "image"],
		min_prompt_price: 1.2,
		min_completion_price: 9.6,
		supported_endpoint_types: null,
		providers: [{ provider_slug: "google-vertex", context_length: 1_048_576 }],
	},
];

let home: string;
let bodies: Record<string, unknown>[];

beforeEach(() => {
	mkdirSync(resolve(".smoke-artifacts"), { recursive: true });
	home = mkdtempSync(resolve(".smoke-artifacts", "infron-limits-"));
	vi.stubEnv("HOME", home);
	vi.stubEnv("USERPROFILE", home);
	vi.stubEnv("PI_CODING_AGENT_DIR", resolve(home, ".pi/agent"));
	bodies = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
			const url = new URL(input instanceof Request ? input.url : String(input));
			if (url.hostname !== "llm.onerouter.pro")
				return new Response(null, { status: 503 });
			if (url.pathname === "/v1/models")
				return Response.json({ data: CATALOG });
			bodies.push(JSON.parse(String(init?.body ?? "{}")));
			return Response.json({ error: { message: "boundary" } }, { status: 400 });
		}),
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
	rmSync(home, { recursive: true, force: true });
});

async function refreshedCatalog(): Promise<Model<Api>[]> {
	const { createNativeOpenAIProvider } =
		await import("../lib/native-provider.ts");
	const { infronProviderOptions } =
		await import("../providers/infron/infron.ts");
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
	const handle = createNativeOpenAIProvider(infronProviderOptions);
	await handle.provider.refreshModels?.({
		store,
		allowNetwork: true,
		credential: { type: "api_key", key: "sk-fixture" },
	} as never);
	return handle.stored.all as Model<Api>[];
}

// Live 2026-11-14, a real Pi turn on the free Qwen model: 400
// "max_completion_tokens=250189 cannot be greater than
// max_model_len=max_total_tokens=204800". The catalog lists the model at
// 256000 tokens, but its only serving provider is 204000; pi-ai sizes the
// request from contextWindow, so the published window must be the served one.
it("sizes a free Qwen turn within the window its provider serves", async () => {
	const { normalizeContext, streamSimpleOpenAICompletions } =
		await import("@earendil-works/pi-ai/compat");
	const model = (await refreshedCatalog()).find(
		(m) => m.id === "qwen/qwen3.8-27b:free",
	);
	expect(model).toBeDefined();
	await streamSimpleOpenAICompletions(
		model as Model<"openai-completions">,
		normalizeContext({
			messages: [{ role: "user", content: "hi", timestamp: 0 }],
		}),
		{ apiKey: "sk-fixture" },
	).result();
	expect(bodies).toHaveLength(1);
	const requested = Number(
		bodies[0]!.max_completion_tokens ?? bodies[0]!.max_tokens,
	);
	expect(requested).toBeGreaterThan(0);
	expect(requested).toBeLessThanOrEqual(204_000);
});

// The window is the largest one any serving provider accepts (the gateway
// routes a long request to a provider that fits it), never the smallest:
// qwen3.5-122b's deepinfra route serves 16384 tokens beside two ~262k routes.
// A provider listed above the model window does not raise it (29 live rows,
// e.g. glm-4.7 at 200000 with a 204800 provider). A provider window too small to hold pi-ai's 4096-token safety margin is
// not taken at face value: the live catalog lists gpt-5-chat on azure at 400
// tokens, which would size every request to a single output token.
it("publishes the largest credible provider window", async () => {
	const byId = new Map((await refreshedCatalog()).map((m) => [m.id, m]));
	expect(byId.get("qwen/qwen3.5-122b-a10b")?.contextWindow).toBe(262_140);
	expect(byId.get("z-ai/glm-4.7")?.contextWindow).toBe(200_000);
	expect(byId.get("openai/gpt-5-chat")?.contextWindow).toBe(128_000);
});

// Live 2026-11-14: six entries (gpt-5.x-codex, gpt-5-pro, gpt-5.4-pro) list
// only the Responses endpoint, yet were published on Chat Completions, the
// only transport this provider streams. Entries that do not list the Chat
// Completions endpoint at all (gemini-4-hydrogen lists none) are refused too.
it("publishes only models the gateway serves over Chat Completions", async () => {
	const ids = (await refreshedCatalog()).map((m) => m.id).sort();
	expect(ids).toEqual([
		"openai/gpt-5-chat",
		"qwen/qwen3.5-122b-a10b",
		"qwen/qwen3.8-27b:free",
		"z-ai/glm-4.7",
	]);
});
