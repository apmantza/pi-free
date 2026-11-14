/**
 * #609: bespoke providers must publish stored.complete.
 *
 * `stored.complete` ("stored.all is the whole catalog, not a restored
 * subset") was written only by the shared factory's own callbacks, so the
 * bespoke providers (cline, kilo, llm7, ollama, zenmux) never
 * set it and their toggle always under-reported ("restored ... full
 * catalog not yet fetched"). Drives llm7's real refreshModels — its fetch
 * is purely local, no network or credential — and observes the shared
 * `stored` record through the provider handle.
 */

import { describe, expect, it } from "vitest";
import type {
	ModelsPublication,
	RefreshModelsContext,
} from "@earendil-works/pi-ai/compat";
import { createLlm7Provider } from "../providers/llm7/llm7-provider.ts";

/**
 * Minimal production-faithful refresh context: Pi's generation-checked
 * publication runs the update when the generation is current.
 */
function refreshContext(): RefreshModelsContext {
	return {
		allowNetwork: true,
		signal: new AbortController().signal,
		publish: async ({ update }: ModelsPublication) => {
			update?.();
			return true;
		},
	};
}

describe("bespoke stored.complete (#609)", () => {
	it("marks the catalog complete after a successful fetch", async () => {
		const { provider, stored } = createLlm7Provider();
		await provider.refreshModels?.(refreshContext());
		expect(stored.all.length).toBeGreaterThan(0);
		// Pre-fix this is undefined: llm7's callbacks assign stored.all/free
		// but nothing ever sets the complete flag.
		expect(stored.complete).toBe(true);
	});

	it("marks a restored-only catalog incomplete", async () => {
		const { provider, stored } = createLlm7Provider();
		const restored = [
			{
				id: "default",
				name: "LLM7 Default",
				provider: "llm7",
				api: "openai-completions",
				baseUrl: "https://llm7.io/v1",
				reasoning: false,
				input: ["text" as const],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 32_000,
				maxTokens: 4_096,
			},
		];
		await provider.refreshModels?.({
			...refreshContext(),
			allowNetwork: false,
			stored: { models: restored, checkedAt: Date.now() },
		});
		// Restore publishes a possibly-partial subset: the toggle must not
		// present subset counts as catalog totals. Pre-fix this stays
		// undefined (indistinguishable from complete by the === true check
		// only by accident — the explicit false is the contract).
		expect(stored.all.length).toBeGreaterThan(0);
		expect(stored.complete).toBe(false);
	});
});
