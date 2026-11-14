/**
 * Venice through the real native provider (#690): catalog refresh
 * (fetchVeniceModels + createNativeOpenAIProvider) and the provider's own
 * Chat Completions stream. Only HTTP is stubbed; models.dev is not on this
 * path.
 *
 * The fixture holds rows captured verbatim from the public
 * api.venice.ai/api/v1/models?type=text endpoint on 2026-11-15.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import type { Api, Model } from "@earendil-works/pi-ai/compat";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fixture = JSON.parse(
	readFileSync(
		new URL("./fixtures/catalogs/venice-2026-11-15.json", import.meta.url),
		"utf8",
	),
) as { data: Array<Record<string, unknown>> };

let home: string;
let catalog: unknown[];
let bodies: Record<string, unknown>[];

beforeEach(() => {
	mkdirSync(resolve(".smoke-artifacts"), { recursive: true });
	home = mkdtempSync(resolve(".smoke-artifacts", "venice-"));
	vi.stubEnv("HOME", home);
	vi.stubEnv("USERPROFILE", home);
	vi.stubEnv("PI_CODING_AGENT_DIR", resolve(home, ".pi/agent"));
	vi.stubEnv("VENICE_API_KEY", "");
	catalog = fixture.data;
	bodies = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
			const url = new URL(input instanceof Request ? input.url : String(input));
			if (url.hostname !== "api.venice.ai")
				return new Response(null, { status: 503 });
			if (url.pathname === "/api/v1/models")
				return Response.json({ data: catalog });
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

async function refreshed() {
	const { createNativeOpenAIProvider } =
		await import("../lib/native-provider.ts");
	const { veniceProviderOptions } =
		await import("../providers/venice/venice.ts");
	let persisted: unknown;
	const handle = createNativeOpenAIProvider(veniceProviderOptions);
	await handle.provider.refreshModels?.({
		store: {
			read: async () => persisted,
			write: async (next: unknown) => {
				persisted = next;
			},
			delete: async () => {
				persisted = undefined;
			},
		},
		allowNetwork: true,
		credential: { type: "api_key", key: "vk-fixture" },
	} as never);
	return handle;
}

async function byId(): Promise<Map<string, Model<Api>>> {
	const handle = await refreshed();
	return new Map((handle.stored.all as Model<Api>[]).map((m) => [m.id, m]));
}

// Recurrence: models whose row states supportsFunctionCalling false (live:
// grok-4-20-multi-agent and three e2ee-* models) were offered to the agent,
// which sends tool definitions on every turn.
it("publishes only models that declare function calling", async () => {
	const ids = [...(await byId()).keys()].sort();
	expect(ids).toEqual([
		"claude-fable-5-2",
		"gemini-4-carbon",
		"venice-uncensored-1-2",
		"zai-org-glm-5-1",
	]);
});

// Recurrence: reasoningEffortOptions was ignored, so pi offered and sent
// every effort level (and "off" as no effort) to models that list a subset:
// claude-fable-5-2 has no "none", zai-org-glm-5-1 has no xhigh/max.
it("maps the listed reasoning_effort values to pi thinking levels", async () => {
	const { getSupportedThinkingLevels } =
		await import("@earendil-works/pi-ai/compat");
	const models = await byId();
	expect(
		getSupportedThinkingLevels(models.get("zai-org-glm-5-1") as never),
	).toEqual(["off", "low", "medium", "high"]);
	expect(
		getSupportedThinkingLevels(models.get("claude-fable-5-2") as never),
	).toEqual(["low", "medium", "high", "xhigh", "max"]);
	// Reasoning without a declared effort list keeps pi-ai's defaults.
	expect(models.get("gemini-4-carbon")?.thinkingLevelMap).toBeUndefined();
	expect(models.get("venice-uncensored-1-2")?.thinkingLevelMap).toBeUndefined();
});

// Recurrence (defect shape 15): a row without pricing was stamped
// _pricingKnown true with $0 placeholders, so Route A would call it free
// beside priced siblings. Derived from a live row with its pricing removed.
it("does not classify a row without published prices as free", async () => {
	const { isFreeModel } = await import("../lib/registry.ts");
	const live = fixture.data.find((row) => row.id === "zai-org-glm-5-1")!;
	const spec = live.model_spec as Record<string, unknown>;
	catalog = [
		...fixture.data,
		{
			...live,
			id: "unpriced-derived",
			model_spec: { ...spec, pricing: undefined },
		},
	];
	const handle = await refreshed();
	const all = handle.stored.all as Model<Api>[];
	expect(all.map((m) => m.id)).toContain("unpriced-derived");
	expect(handle.stored.free.map((m) => m.id)).toEqual([]);
	const unpriced = all.find((m) => m.id === "unpriced-derived")!;
	expect(isFreeModel({ ...unpriced, provider: "venice" }, all)).toBe(false);
});

// Recurrence: venice_parameters.include_venice_system_prompt defaults to true
// (docs.venice.ai chat/completions), so Venice prepended its own system
// prompt to Pi's agent prompt on every request. The flag is set on the
// provider stream itself; a caller's onPayload (Pi's before_provider_request)
// still runs after it and its replacement payload is the one sent.
it("opts every request out of Venice's own system prompt", async () => {
	const { normalizeContext } = await import("@earendil-works/pi-ai/compat");
	const handle = await refreshed();
	const model = (handle.stored.all as Model<Api>[]).find(
		(m) => m.id === "claude-fable-5-2",
	)!;
	const seen: unknown[] = [];
	await handle.provider
		.streamSimple(
			model as Model<"openai-completions">,
			normalizeContext({
				messages: [{ role: "user", content: "hi", timestamp: 0 }],
			}),
			{
				apiKey: "vk-fixture",
				onPayload: (payload) => {
					seen.push(payload);
					return { ...(payload as object), user: "hook" };
				},
			},
		)
		.result();
	expect(bodies).toHaveLength(1);
	expect(bodies[0]!.venice_parameters).toEqual({
		include_venice_system_prompt: false,
	});
	expect(bodies[0]!.user).toBe("hook");
	expect(seen).toHaveLength(1);
	expect(
		(seen[0] as { venice_parameters?: unknown }).venice_parameters,
	).toEqual({ include_venice_system_prompt: false });
});
