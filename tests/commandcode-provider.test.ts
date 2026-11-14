/**
 * CommandCode provider wire and free-view tests (#674).
 *
 * Only HTTP is stubbed: /models answers the public catalog captured
 * anonymously on 2026-11-14 (tests/fixtures, unchanged), and every chat POST
 * is recorded and answered with a 400. The provider is the one
 * `commandCodeProvider` registers with Pi; requests are built by pi-ai's real
 * anthropic-messages and openai-completions streams through the lazy bridge.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import type { Api, Model, Provider } from "@earendil-works/pi-ai/compat";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

interface CatalogRow {
	id: string;
	name: string;
	supported_endpoints: string[];
}

const CATALOG = JSON.parse(
	readFileSync(
		resolve(__dirname, "fixtures/commandcode-catalog-2026-11-14.json"),
		"utf8",
	),
) as { object: string; data: CatalogRow[] };

let home: string;
let posts: string[];

beforeEach(() => {
	vi.resetModules();
	mkdirSync(resolve(".smoke-artifacts"), { recursive: true });
	home = mkdtempSync(resolve(".smoke-artifacts", "commandcode-"));
	vi.stubEnv("HOME", home);
	vi.stubEnv("USERPROFILE", home);
	vi.stubEnv("PI_CODING_AGENT_DIR", resolve(home, ".pi/agent"));
	vi.stubEnv("COMMAND_CODE_API_KEY", "user_test");
	posts = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
			const url = input instanceof Request ? input.url : String(input);
			const method = input instanceof Request ? input.method : init?.method;
			if (new URL(url).hostname !== "api.commandcode.ai")
				return new Response(null, { status: 503 });
			if (method === "POST") {
				// Path only: the Anthropic SDK adds `?beta=true`, which the
				// gateway route accepts (anonymous probe: 401, not 404).
				posts.push(new URL(url).origin + new URL(url).pathname);
				return Response.json(
					{ error: { type: "invalid_request_error", message: "boundary" } },
					{ status: 400 },
				);
			}
			if (url === "https://api.commandcode.ai/provider/v1/models")
				return Response.json(CATALOG);
			return new Response(null, { status: 404 });
		}),
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
	rmSync(home, { recursive: true, force: true });
});

/** Register through the production entry and refresh the catalog once. */
async function registeredProvider(): Promise<Provider> {
	let registered: Provider | undefined;
	const pi = {
		registerNativeProvider: () => {},
		registerProvider: (provider: Provider) => {
			registered = provider;
		},
		registerCommand: () => {},
		on: () => {},
	};
	const { default: commandCodeProvider } =
		await import("../providers/commandcode/commandcode.ts");
	await commandCodeProvider(pi as never);
	let persisted: unknown;
	await registered!.refreshModels?.({
		allowNetwork: true,
		store: {
			read: async () => persisted,
			write: async (next: unknown) => {
				persisted = next;
			},
			delete: async () => {
				persisted = undefined;
			},
		},
	} as never);
	expect(registered!.getModels()).toHaveLength(CATALOG.data.length);
	return registered!;
}

async function postUrlFor(provider: Provider, id: string): Promise<string> {
	const { normalizeContext } = await import("@earendil-works/pi-ai/compat");
	const model = provider.getModels().find((m) => m.id === id) as Model<Api>;
	posts.length = 0;
	await provider
		.streamSimple(
			model,
			normalizeContext({
				messages: [{ role: "user", content: "hi", timestamp: 0 }],
			}),
			{ apiKey: "user_test", maxTokens: 16 },
		)
		.result();
	expect(posts, id).toHaveLength(1);
	return posts[0]!;
}

// Live 2026-11-14: the Anthropic SDK appends /v1/messages to the model
// baseUrl, so claude-* turns went to /provider/v1/v1/messages, which answers
// 404 "not a registered API route"; /provider/v1/messages is the real route.
it("sends every claude model to /provider/v1/messages", async () => {
	const provider = await registeredProvider();
	const claude = CATALOG.data.filter((row) => row.id.startsWith("claude-"));
	expect(claude.length).toBeGreaterThan(0);
	for (const row of claude) {
		expect(await postUrlFor(provider, row.id), row.id).toBe(
			"https://api.commandcode.ai/provider/v1/messages",
		);
	}
});

// Keeps the anthropic rewrite from leaking onto the OpenAI transport.
it("keeps chat-completions models on /provider/v1/chat/completions", async () => {
	const provider = await registeredProvider();
	for (const id of ["gpt-6-sol", "thinkingmachines/inkling-2-small:free"]) {
		expect(await postUrlFor(provider, id), id).toBe(
			"https://api.commandcode.ai/provider/v1/chat/completions",
		);
	}
});

// Live 2026-11-14: the catalog marks free models only with a `:free` id
// suffix (display names "Inkling 2 Small", "Glyph Cluster"), the curated
// free ids were gone, and the default free view came out empty.
it("shows exactly the :free catalog ids in the free view", async () => {
	const provider = await registeredProvider();
	const visible = provider.filterModels!(provider.getModels(), undefined)
		.map((m) => m.id)
		.sort();
	expect(visible).toEqual([
		"stealth/glyph-cluster:free",
		"thinkingmachines/inkling-2-small:free",
	]);
});

// The transport split keys on the `claude-` prefix, not on the catalog's
// supported_endpoints. This pins that the two agree on the captured catalog:
// it fails when a recapture brings a non-claude /messages-only model or a
// claude model served over chat completions.
it("prefix transport rule agrees with supported_endpoints on the captured catalog", async () => {
	const { apiForCommandCodeModel } =
		await import("../providers/commandcode/commandcode-models.ts");
	for (const row of CATALOG.data) {
		const chat = row.supported_endpoints.includes("/chat/completions");
		expect(apiForCommandCodeModel(row.id), row.id).toBe(
			chat ? "openai-completions" : "anthropic-messages",
		);
		if (!chat) expect(row.supported_endpoints, row.id).toContain("/messages");
	}
});
