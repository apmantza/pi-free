/**
 * Ollama Cloud publishes only models whose /api/show capabilities include
 * "tools" (#690: the filter is the shared keepToolCallingModels gate),
 * driven through the native refresh with the real fetchAllModels. Only HTTP
 * is stubbed; ids are from the live ollama.com/v1/models list (2026-11-15).
 */

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

let home: string;

beforeEach(() => {
	mkdirSync(resolve(".smoke-artifacts"), { recursive: true });
	home = mkdtempSync(resolve(".smoke-artifacts", "ollama-tools-"));
	vi.stubEnv("HOME", home);
	vi.stubEnv("USERPROFILE", home);
	vi.stubEnv("PI_CODING_AGENT_DIR", resolve(home, ".pi/agent"));
	vi.stubEnv("OLLAMA_API_KEY", "");
	vi.resetModules();
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
			const url = String(input instanceof Request ? input.url : input);
			if (url.endsWith("/v1/models")) {
				return Response.json({
					data: [{ id: "glm-5.3" }, { id: "inkling-2-small" }],
				});
			}
			if (url.endsWith("/api/show")) {
				const { model } = JSON.parse(String(init?.body)) as { model: string };
				return Response.json({
					details: { parameter_size: "", quantization_level: "" },
					model_info: {},
					capabilities:
						model === "glm-5.3" ? ["completion", "tools"] : ["completion"],
				});
			}
			return new Response(null, { status: 503 });
		}),
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
	rmSync(home, { recursive: true, force: true });
});

// Guards the fold onto the shared gate: a model whose capabilities omit
// "tools" must not be offered to the agent.
it("publishes only models whose capabilities include tools", async () => {
	const { createOllamaProvider } =
		await import("../providers/ollama/ollama.ts");
	const { provider, stored } = createOllamaProvider([]);
	await provider.refreshModels?.({
		allowNetwork: true,
		credential: { type: "api_key", key: "ol-fixture" },
		store: { read: async () => undefined, write: async () => {} },
	} as never);
	expect(stored.all.map((m) => m.id)).toEqual(["glm-5.3"]);
});
