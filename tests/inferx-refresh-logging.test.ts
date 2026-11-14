/**
 * InferX refresh transitions and their log records (#690), driven through
 * the registered native provider (inferxProvider -> refreshModels ->
 * fetchInferxModels -> fetchOpenAICompatibleModels). Only HTTP is stubbed;
 * the logger mirrors warnings to console.warn at LOG_LEVEL=warn.
 */

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import type { Provider } from "@earendil-works/pi-ai/compat";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

let home: string;
let warn: ReturnType<typeof vi.spyOn>;
let respond: (signal: AbortSignal | undefined) => Promise<Response>;

beforeEach(() => {
	mkdirSync(resolve(".smoke-artifacts"), { recursive: true });
	home = mkdtempSync(resolve(".smoke-artifacts", "inferx-log-"));
	vi.stubEnv("HOME", home);
	vi.stubEnv("USERPROFILE", home);
	vi.stubEnv("PI_CODING_AGENT_DIR", resolve(home, ".pi/agent"));
	vi.stubEnv("INFERX_API_KEY", "");
	// Mirror warnings to the console, where this test observes them.
	vi.stubEnv("LOG_LEVEL", "warn");
	vi.resetModules();
	warn = vi.spyOn(console, "warn").mockImplementation(() => {});
	respond = async () => Response.json({ data: [] });
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
			const url = String(input instanceof Request ? input.url : input);
			if (url.startsWith("https://model.inferx.net/"))
				return respond(init?.signal ?? undefined);
			return Response.json({});
		}),
	);
});

afterEach(() => {
	warn.mockRestore();
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
	rmSync(home, { recursive: true, force: true });
});

async function registered(): Promise<Provider> {
	const { default: inferx } = await import("../providers/inferx/inferx.ts");
	let provider: Provider | undefined;
	await inferx({
		registerProvider: (p: Provider) => {
			provider ??= p;
		},
		registerCommand: vi.fn(),
		on: vi.fn(),
	} as never);
	return provider!;
}

function refresh(provider: Provider, signal?: AbortSignal) {
	return provider.refreshModels?.({
		allowNetwork: true,
		credential: { type: "api_key", key: "ix-fixture" },
		store: { read: async () => undefined, write: async () => {} },
		...(signal && { signal }),
	} as never);
}

function warnings(): string[] {
	return warn.mock.calls.map((call: unknown[]) => String(call[0]));
}

// Recurrence: Pi supersedes the startup refresh by aborting it. The shared
// fetcher returns [] for an abort without logging (convention 15), and
// InferX then warned "Catalog returned no usable chat models" as if the
// catalog were broken.
it("an aborted refresh logs no warning", async () => {
	const controller = new AbortController();
	respond = async (signal) => {
		controller.abort();
		throw signal?.reason ?? new Error("aborted");
	};
	await refresh(await registered(), controller.signal);
	expect(warnings().filter((w) => w.includes("inferx"))).toEqual([]);
});

// A failed fetch is already logged once by the shared fetcher as an error;
// InferX does not add a second "no usable chat models" warning for it.
it("a failed fetch is not reported as an empty catalog", async () => {
	respond = async () =>
		Response.json({ error: "no tenant context" }, { status: 401 });
	await refresh(await registered());
	expect(warnings().filter((w) => w.includes("no usable chat models"))).toEqual(
		[],
	);
});

// The warning stays for what it describes: the catalog answered, and none
// of its rows is a chat model.
it("warns when the catalog lists only non-chat endpoints", async () => {
	respond = async () =>
		Response.json({ data: [{ id: "Qwen3-Embedding-8B", object: "model" }] });
	await refresh(await registered());
	expect(
		warnings().filter((w) => w.includes("no usable chat models")),
	).toHaveLength(1);
});
