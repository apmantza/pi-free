/**
 * Drive a keyed OpenAI-compatible native provider through its real refresh
 * path (provider fetcher + mapper + createNativeOpenAIProvider) and pi-ai's
 * real Chat Completions request builder, with only HTTP stubbed.
 *
 * `useCatalogHttp` pins HOME/USERPROFILE/PI_CODING_AGENT_DIR under
 * `.smoke-artifacts`, serves `catalog` at `https://<host>/.../models`,
 * answers every other request to `host` with a 400 after recording its JSON
 * body, and refuses all other hosts (models.dev enrichment fails open).
 */

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import type { Api, Model } from "@earendil-works/pi-ai/compat";
import { afterEach, beforeEach, expect, vi } from "vitest";
import type { NativeOpenAIProviderOptions } from "../../lib/native-provider.ts";

export function useCatalogHttp(
	host: string,
	catalog: () => unknown,
	clearEnv: readonly string[] = [],
): { bodies: () => Record<string, unknown>[] } {
	let home = "";
	let bodies: Record<string, unknown>[] = [];
	beforeEach(() => {
		mkdirSync(resolve(".smoke-artifacts"), { recursive: true });
		home = mkdtempSync(resolve(".smoke-artifacts", `${host}-`));
		vi.stubEnv("HOME", home);
		vi.stubEnv("USERPROFILE", home);
		vi.stubEnv("PI_CODING_AGENT_DIR", resolve(home, ".pi/agent"));
		for (const name of clearEnv) vi.stubEnv(name, "");
		bodies = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
				const url = new URL(
					input instanceof Request ? input.url : String(input),
				);
				if (url.hostname !== host) return new Response(null, { status: 503 });
				if (url.pathname.endsWith("/models")) return Response.json(catalog());
				bodies.push(JSON.parse(String(init?.body ?? "{}")));
				return Response.json(
					{ error: { message: "boundary" } },
					{ status: 400 },
				);
			}),
		);
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.unstubAllEnvs();
		rmSync(home, { recursive: true, force: true });
	});
	return { bodies: () => bodies };
}

export async function refreshNativeCatalog(
	options: NativeOpenAIProviderOptions,
): Promise<{
	all: Model<Api>[];
	free: Model<Api>[];
	/** What Pi shows under the free view: `filterModels(getModels())`. */
	freeView: readonly Model<Api>[];
}> {
	const { createNativeOpenAIProvider, filterNativeModels } =
		await import("../../lib/native-provider.ts");
	let persisted: unknown;
	const handle = createNativeOpenAIProvider(options);
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
		credential: { type: "api_key", key: "sk-fixture" },
	} as never);
	// Pi's free view: the provider's filter (filterNativeModels over the
	// stored free list) with the view forced to free, since the global
	// free-only default is module state captured at import.
	const freeView = filterNativeModels(
		options.providerId,
		handle.provider.getModels(),
		{ freeModels: handle.stored.free, forceFree: true },
	);
	return {
		all: handle.stored.all as Model<Api>[],
		free: handle.stored.free as Model<Api>[],
		freeView,
	};
}

/**
 * The JSON body pi-ai's real request builder sends for one turn. `onPayload`
 * is the hook Pi's runner wires `before_provider_request` handlers into.
 */
export async function sentRequestBody(
	http: { bodies: () => Record<string, unknown>[] },
	model: Model<Api>,
	reasoning?: string,
	onPayload?: (payload: unknown) => unknown,
): Promise<Record<string, unknown>> {
	const { normalizeContext, streamSimpleOpenAICompletions } =
		await import("@earendil-works/pi-ai/compat");
	const before = http.bodies().length;
	await streamSimpleOpenAICompletions(
		model as Model<"openai-completions">,
		normalizeContext({
			messages: [{ role: "user", content: "hi", timestamp: 0 }],
		}),
		{
			apiKey: "sk-fixture",
			...(reasoning && { reasoning }),
			...(onPayload && { onPayload }),
		} as never,
	).result();
	const sent = http.bodies().slice(before);
	expect(sent).toHaveLength(1);
	return sent[0]!;
}
