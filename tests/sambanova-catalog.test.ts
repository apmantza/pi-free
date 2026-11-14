/**
 * SambaNova pricing provenance (#690), through the registered native
 * provider: sambanovaProvider -> fetchOpenAICompatibleModels -> refresh ->
 * the free view Pi reads from getModels(). Only HTTP is stubbed.
 *
 * The fixture is the complete public api.sambanova.ai/v1/models catalog
 * captured on 2026-11-15 (five rows, all priced).
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import type { Provider } from "@earendil-works/pi-ai/compat";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fixture = JSON.parse(
	readFileSync(
		new URL("./fixtures/catalogs/sambanova-2026-11-15.json", import.meta.url),
		"utf8",
	),
) as { data: Array<Record<string, unknown>> };

let home: string;
let catalog: unknown[];

beforeEach(() => {
	mkdirSync(resolve(".smoke-artifacts"), { recursive: true });
	home = mkdtempSync(resolve(".smoke-artifacts", "sambanova-"));
	vi.stubEnv("HOME", home);
	vi.stubEnv("USERPROFILE", home);
	vi.stubEnv("PI_CODING_AGENT_DIR", resolve(home, ".pi/agent"));
	vi.stubEnv("SAMBANOVA_API_KEY", "");
	vi.stubEnv("PI_FREE_ONLY", "true");
	vi.resetModules();
	catalog = fixture.data;
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: string | URL | Request) => {
			const url = String(input instanceof Request ? input.url : input);
			const body = url.startsWith("https://api.sambanova.ai/")
				? { data: catalog }
				: {};
			return new Response(JSON.stringify(body), { status: 200 });
		}),
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
	rmSync(home, { recursive: true, force: true });
});

async function freeView(): Promise<string[]> {
	const { default: sambanova } =
		await import("../providers/sambanova/sambanova.ts");
	let provider: Provider | undefined;
	const pi = {
		registerProvider: (p: Provider) => {
			provider ??= p;
		},
		registerCommand: vi.fn(),
		on: vi.fn(),
	};
	await sambanova(pi as never);
	await provider!.refreshModels?.({
		allowNetwork: true,
		credential: { type: "api_key", key: "sn-fixture" },
		store: { read: async () => undefined, write: async () => {} },
	} as never);
	return provider!.getModels().map((m) => m.id);
}

it("has no free model in the live catalog", async () => {
	expect(await freeView()).toEqual([]);
});

// Recurrence (defect shape 15): the provider stamped _pricingKnown true on
// every row, so a row without `pricing` was a $0 price beside priced
// siblings and entered the free view. Derived from a live row with its
// pricing removed.
it("keeps a row without pricing out of the free view", async () => {
	const { pricing: _dropped, ...unpriced } = fixture.data[1]!;
	catalog = [...fixture.data, { ...unpriced, id: "unpriced-derived" }];
	expect(await freeView()).toEqual([]);
});
