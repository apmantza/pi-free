/**
 * TokenRouter request shaping through the real path: the native provider's
 * catalog refresh (fetchTokenRouterModels + createNativeOpenAIProvider),
 * pi-ai's real Chat Completions request builder, and the
 * `before_provider_request` handler the extension registers, wired through
 * pi-ai's `onPayload` the way Pi's runner wires it. Only HTTP is stubbed.
 *
 * Catalog rows follow TokenRouter's `/v1/models` shape (id, object, created,
 * owned_by, supported_endpoint_types); the catalog needs a key, so they are
 * not a live capture.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai/compat";
import { describe, expect, it, vi } from "vitest";
import {
	refreshNativeCatalog,
	sentRequestBody,
	useCatalogHttp,
} from "./helpers/native-catalog.ts";

const row = (id: string) => ({
	id,
	object: "model",
	created: 0,
	owned_by: "tokenrouter",
	supported_endpoint_types: ["openai"],
});

const CATALOG = {
	data: [row("MiniMax-M3"), row("deepseek-v4-flash")],
};

const http = useCatalogHttp("api.tokenrouter.com", () => CATALOG, [
	"TOKENROUTER_API_KEY",
]);

type Handler = (event: unknown, ctx: unknown) => unknown;

async function setup(): Promise<{
	send: (id: string, reasoning?: string) => Promise<Record<string, unknown>>;
}> {
	const mod = await import("../providers/tokenrouter/tokenrouter.ts");
	const handlers = new Map<string, Handler>();
	const pi = {
		registerProvider: vi.fn(),
		registerCommand: vi.fn(),
		on: (event: string, handler: Handler) => handlers.set(event, handler),
	} as unknown as ExtensionAPI;
	await mod.default(pi);
	const onRequest = handlers.get("before_provider_request");
	expect(onRequest).toBeDefined();
	const { all } = await refreshNativeCatalog(mod.tokenRouterProviderOptions);
	const models = new Map<string, Model<Api>>(all.map((m) => [m.id, m]));
	const send = (id: string, reasoning?: string) => {
		const model = models.get(id)!;
		return sentRequestBody(http, model, reasoning, (payload) =>
			onRequest!({ type: "before_provider_request", payload }, { model }),
		);
	};
	return { send };
}

describe("TokenRouter wire payloads", () => {
	// Evidence for #690: MiniMax-M3 carries no proxy compat, so pi-ai's
	// builder never emits a `thinking` object for it and the former
	// `enabled -> adaptive` rewrite (#229) could not fire; it was removed.
	// MiniMax still reasons by default (its inline <think> output is
	// extracted on message_end) and its effort is clamped.
	it("sends MiniMax-M3 no thinking object and a clamped effort", async () => {
		const { send } = await setup();
		const body = await send("MiniMax-M3", "high");
		expect(body).not.toHaveProperty("thinking");
		expect(body.reasoning_effort).toBe("xhigh");
		expect(body.reasoning_split).toBe(true);
	});

	// Pins the compat strip: DeepSeek-style proxy compat sends pi-ai's
	// `thinking` object and, with `supportsReasoningEffort` off, no effort.
	it("sends DeepSeek models thinking and no reasoning_effort", async () => {
		const { send } = await setup();
		const body = await send("deepseek-v4-flash", "high");
		expect(body.thinking).toEqual({ type: "enabled" });
		expect(body).not.toHaveProperty("reasoning_effort");
	});

	// Recurrence (e71be8f, 2026-08-21): pi-ai sent effort values the route
	// rejects (`400: reasoning_effort must be low, medium, or xhigh`).
	it("clamps every Pi level onto the gateway's accepted efforts", async () => {
		const { send } = await setup();
		const sent: Record<string, unknown> = {};
		for (const level of ["minimal", "low", "medium", "high", "xhigh"]) {
			sent[level] = (await send("MiniMax-M3", level)).reasoning_effort;
		}
		expect(sent).toEqual({
			minimal: "low",
			low: "low",
			medium: "medium",
			high: "xhigh",
			xhigh: "xhigh",
		});
	});
});
