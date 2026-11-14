/**
 * B.AI catalog classification through the real native refresh.
 *
 * B.AI's /v1/models is keyed (anonymous: 401 "Invalid token", 2026-11-14) and
 * exposes no pricing: minimal OpenAI-shim `{id, object, created, owned_by,
 * supported_endpoint_types}` entries. Only HTTP is stubbed; the rows below use
 * that shape with ids from B.AI's pricing page. Classification falls to
 * Route B name detection plus the `:free` suffix promotion stamp.
 */

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const CATALOG = [
	"deepseek-v4-flash",
	"deepseek-v4-flash-vision-exp",
	"mimo-v2.5",
	"claude-opus-4.8",
	"gpt-5.2",
	"some-model:free",
].map((id) => ({
	id,
	object: "model",
	created: 1_760_000_000,
	owned_by: "b.ai",
	supported_endpoint_types: ["openai"],
}));

let home: string;

beforeEach(() => {
	mkdirSync(resolve(".smoke-artifacts"), { recursive: true });
	home = mkdtempSync(resolve(".smoke-artifacts", "bai-"));
	vi.stubEnv("HOME", home);
	vi.stubEnv("USERPROFILE", home);
	vi.stubEnv("PI_CODING_AGENT_DIR", resolve(home, ".pi/agent"));
	vi.stubEnv("BAI_API_KEY", "sk-bai-test");
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: string | URL | Request) => {
			const url = new URL(input instanceof Request ? input.url : String(input));
			if (url.hostname === "models.dev") return Response.json({});
			if (url.hostname === "api.b.ai" && url.pathname === "/v1/models")
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

// #675: deepseek-v4-flash, deepseek-v4-flash-vision-exp and mimo-v2.5 were
// stamped authoritatively free from a 2026-08 promotion. B.AI's pricing page
// (docs.b.ai/llmservice/pricing-and-usage, 2026-11-14) now prices all three
// ($0.15/$0.60 and $0.14/$0.28 per 1M off-peak) and never says "free", so the
// free view must not offer them. The `:free` suffix stays a free signal.
it("keeps priced models out of the free view", async () => {
	const { createNativeOpenAIProvider } =
		await import("../lib/native-provider.ts");
	const { baiProviderOptions } = await import("../providers/bai/bai.ts");
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
	const handle = createNativeOpenAIProvider(baiProviderOptions);
	await handle.provider.refreshModels?.({ store, allowNetwork: true } as never);

	expect(handle.stored.all.map((m) => m.id).sort()).toEqual(
		CATALOG.map((row) => row.id).sort(),
	);
	expect(handle.stored.free.map((m) => m.id)).toEqual(["some-model:free"]);
});
