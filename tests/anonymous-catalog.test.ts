/**
 * Logged-out provider visibility (#530).
 *
 * Pi hides providers whose auth doesn't resolve: if apiKey.resolve()
 * returns undefined the catalog never fetches and /model stays clean.
 * Providers whose catalogs are unusable without a key must therefore
 * resolve undefined when no credential is configured — a visible-but-
 * unchattable catalog is clutter, not discovery. Only genuinely
 * keyless-usable providers (cline, fastrouter, llm7) resolve keyless.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("../config.ts", () => ({
	getCrofaiApiKey: () => undefined,
	getDeepinfraApiKey: () => undefined,
	getNovitaApiKey: () => undefined,
	getRoutewayApiKey: () => undefined,
	getSambanovaApiKey: () => undefined,
	getCommandCodeApiKey: () => undefined,
	getInfronApiKey: () => undefined,
	getVeniceApiKey: () => undefined,
	getStepfunApiKey: () => undefined,
	getAnyapiApiKey: () => undefined,
	getBaiApiKey: () => undefined,
	getOpengatewayApiKey: () => undefined,
	getKiloApiKey: () => undefined,
	getRequestyApiKey: () => undefined,
	getZenmuxApiKey: () => undefined,
	getClineApiKey: () => undefined,
	getFastrouterApiKey: () => undefined,
	getLlm7ApiKey: () => undefined,
	// Non-key exports pulled in transitively by lib/registry / native-provider.
	getFreeOnly: () => false,
	getProviderShowPaid: () => false,
	saveConfig: async () => undefined,
	applyHidden: (models: unknown[]) => models,
}));

import { crofaiAuth } from "../providers/crofai/crofai-auth.ts";
import { deepinfraAuth } from "../providers/deepinfra/deepinfra-auth.ts";
import { novitaAuth } from "../providers/novita/novita-auth.ts";
import { routewayAuth } from "../providers/routeway/routeway-auth.ts";
import { sambanovaAuth } from "../providers/sambanova/sambanova-auth.ts";
import { commandCodeAuth } from "../providers/commandcode/commandcode-auth.ts";
import { infronAuth } from "../providers/infron/infron-auth.ts";
import { veniceAuth } from "../providers/venice/venice-auth.ts";
import { stepfunAuth } from "../providers/stepfun/stepfun-auth.ts";
import { anyapiAuth } from "../providers/anyapi/anyapi-auth.ts";
import { baiAuth } from "../providers/bai/bai-auth.ts";
import { opengatewayAuth } from "../providers/opengateway/opengateway-auth.ts";
import { kiloApiKeyAuth } from "../providers/kilo/kilo-auth.ts";
import { requestyAuth } from "../providers/requesty/requesty-auth.ts";
import { zenmuxAuth } from "../providers/zenmux/zenmux-auth.ts";
import { clineApiKeyAuth } from "../providers/cline/cline-auth.ts";
import { fastrouterAuth } from "../providers/fastrouter/fastrouter-auth.ts";
import { llm7Auth } from "../providers/llm7/llm7-auth.ts";
import { createNativeApiKeyAuth } from "../lib/native-provider.ts";

function resolveInput() {
	return {
		ctx: {} as never,
		credential: undefined,
		signal: new AbortController().signal,
	} as never;
}

describe("shared-factory providers hide without a key (#530)", () => {
	it.each([
		["crofai", crofaiAuth],
		["deepinfra", deepinfraAuth],
		["novita", novitaAuth],
		["routeway", routewayAuth],
		["sambanova", sambanovaAuth],
		["commandcode", commandCodeAuth],
		["infron", infronAuth],
		["venice", veniceAuth],
		["stepfun", stepfunAuth],
		["anyapi", anyapiAuth],
		["bai", baiAuth],
		["opengateway", opengatewayAuth],
	])("%s resolves undefined without a key", async (_name, auth) => {
		expect(await auth.apiKey?.resolve(resolveInput())).toBeUndefined();
	});
});

describe("custom-resolver providers hide without a key (#530)", () => {
	it.each([
		["kilo", { apiKey: kiloApiKeyAuth }],
		["requesty", requestyAuth],
		["zenmux", zenmuxAuth],
	])("%s resolves undefined without a key", async (_name, auth) => {
		expect(await auth.apiKey?.resolve(resolveInput())).toBeUndefined();
	});
});

describe("keyless allowlist still resolves (cline, fastrouter, llm7)", () => {
	it.each([
		["cline", { apiKey: clineApiKeyAuth }],
		["fastrouter", fastrouterAuth],
		["llm7", llm7Auth],
	])("%s resolves keyless auth for the public catalog", async (_name, auth) => {
		const result = await auth.apiKey?.resolve(resolveInput());
		expect(result).toBeDefined();
		expect(result?.auth).toBeDefined();
		// No apiKey.check: a check would hide the public catalog before login.
		expect(auth.apiKey).not.toHaveProperty("check");
	});
});

describe("createNativeApiKeyAuth", () => {
	it("resolves undefined without a key", async () => {
		const auth = createNativeApiKeyAuth({
			name: "Test key",
			prompt: "Test key",
			source: "TEST_API_KEY",
			getApiKey: () => undefined,
		});
		expect(await auth.apiKey?.resolve(resolveInput())).toBeUndefined();
	});

	it("still prefers stored and ambient keys when configured", async () => {
		const auth = createNativeApiKeyAuth({
			name: "Test key",
			prompt: "Test key",
			source: "TEST_API_KEY",
			getApiKey: () => "ambient-key",
		});
		expect(
			await auth.apiKey?.resolve({
				ctx: {} as never,
				credential: { type: "api_key", key: "stored-key" },
				signal: new AbortController().signal,
			} as never),
		).toMatchObject({
			auth: { apiKey: "stored-key" },
			source: "stored API key",
		});
		expect(await auth.apiKey?.resolve(resolveInput())).toMatchObject({
			auth: { apiKey: "ambient-key" },
			source: "TEST_API_KEY",
		});
	});
});
