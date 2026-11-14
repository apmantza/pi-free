/**
 * Ollama Cloud free view through the real provider and classifier (#675).
 *
 * Only HTTP is stubbed (/v1/models and /api/show). Ollama Cloud has no free
 * tier: https://ollama.com/pricing (2026-11-14) bills "Pay as you go" per
 * token for every cloud model, and Pro/Max/Team include usage credits. The
 * catalog publishes no prices, so every model maps to $0 and `isFreeModel`
 * falls back to "free" in the name, which no Ollama id carries.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

let home: string;

beforeEach(() => {
	mkdirSync(resolve(".smoke-artifacts"), { recursive: true });
	home = mkdtempSync(resolve(".smoke-artifacts", "ollama-free-"));
	vi.stubEnv("HOME", home);
	vi.stubEnv("USERPROFILE", home);
	vi.stubEnv("PI_CODING_AGENT_DIR", resolve(home, ".pi/agent"));
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
			const url = new URL(input instanceof Request ? input.url : String(input));
			if (url.hostname !== "ollama.com")
				return new Response(null, { status: 503 });
			if (url.pathname === "/v1/models")
				return Response.json({
					object: "list",
					data: [
						{ id: "glm-5.2", object: "model", owned_by: "ollama" },
						{ id: "gpt-oss:120b", object: "model", owned_by: "ollama" },
					],
				});
			if (url.pathname === "/api/show") {
				const { model } = JSON.parse(String(init?.body)) as { model: string };
				return Response.json({
					capabilities: ["completion", "tools", "thinking"],
					model_info: { "general.context_length": 131072 },
					details: {},
					model,
				});
			}
			return new Response(null, { status: 404 });
		}),
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
	rmSync(home, { recursive: true, force: true });
});

// Pre-fix the startup fallback seed was ingested as its own free list, so all
// 20 fallback models showed in the free view until the first refresh emptied
// it: the same paid-shown-free-before-refresh shape as OpenGateway's seed.
it("classifies the startup seed like a refreshed catalog", async () => {
	const { createOllamaProvider } =
		await import("../providers/ollama/ollama.ts");
	const handle = createOllamaProvider();
	expect(handle.stored.all.length).toBeGreaterThan(0);
	expect(handle.stored.free.map((m) => m.id)).toEqual([]);

	let persisted: unknown;
	await handle.provider.refreshModels?.({
		credential: { type: "api_key", key: "ollama-test" },
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
	} as never);
	expect(handle.stored.all.map((m) => m.id)).toEqual([
		"glm-5.2",
		"gpt-oss:120b",
	]);
	expect(handle.stored.free).toEqual([]);
});

// `/probe-ollama` and the session-start probe republish the surviving models
// through `ingest` (registerOllamaProvider's applyModelList), which pre-fix
// passed the same list as the free view: one probe made every model "free".
it("classifies a probe-filtered catalog republished through ingest", async () => {
	const { createOllamaProvider } =
		await import("../providers/ollama/ollama.ts");
	const handle = createOllamaProvider();
	const survivors = handle.stored.all.slice(1);
	handle.ingest(survivors);
	expect(handle.stored.all.map((m) => m.id)).toEqual(
		survivors.map((m) => m.id),
	);
	expect(handle.stored.free).toEqual([]);
});
