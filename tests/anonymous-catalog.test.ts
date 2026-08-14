/**
 * Anonymous catalog resolution (#421).
 *
 * Pi's MutableModels.refresh() gates every provider's refreshModels() behind
 * auth resolution: if apiKey.resolve() returns undefined the catalog never
 * fetches. Providers with a public model catalog therefore resolve a truthy
 * keyless result when no credential is configured, so their models populate
 * anonymously. Providers whose catalogs require auth (stepfun, anyapi, bai,
 * opengateway) must keep resolving undefined.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("../config.ts", () => ({
	getCrofaiApiKey: () => undefined,
	getDeepinfraApiKey: () => undefined,
	getNovitaApiKey: () => undefined,
	getRoutewayApiKey: () => undefined,
	getSambanovaApiKey: () => undefined,
	getOpenmodelApiKey: () => undefined,
	getStepfunApiKey: () => undefined,
	getAnyapiApiKey: () => undefined,
	getBaiApiKey: () => undefined,
	getOpengatewayApiKey: () => undefined,
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
import { openmodelAuth } from "../providers/openmodel/openmodel-auth.ts";
import { stepfunAuth } from "../providers/stepfun/stepfun-auth.ts";
import { anyapiAuth } from "../providers/anyapi/anyapi-auth.ts";
import { baiAuth } from "../providers/bai/bai-auth.ts";
import { opengatewayAuth } from "../providers/opengateway/opengateway-auth.ts";
import { createNativeApiKeyAuth } from "../lib/native-provider.ts";

const anonymous = { auth: {}, source: "public catalog (no account)" };

function resolveInput() {
	return {
		ctx: {} as never,
		credential: undefined,
		signal: new AbortController().signal,
	} as never;
}

describe("shared-factory providers with public catalogs", () => {
	it.each([
		["crofai", crofaiAuth],
		["deepinfra", deepinfraAuth],
		["novita", novitaAuth],
		["routeway", routewayAuth],
		["sambanova", sambanovaAuth],
		["openmodel", openmodelAuth],
	])("%s resolves keyless auth so the public catalog can refresh", async (_name, auth) => {
		const result = await auth.apiKey?.resolve(resolveInput());
		expect(result).toEqual(anonymous);
		// No apiKey.check: a check would hide the public catalog before login.
		expect(auth.apiKey).not.toHaveProperty("check");
	});
});

describe("shared-factory providers with auth-required catalogs", () => {
	it.each([
		["stepfun", stepfunAuth],
		["anyapi", anyapiAuth],
		["bai", baiAuth],
		["opengateway", opengatewayAuth],
	])("%s still resolves undefined without a key", async (_name, auth) => {
		expect(await auth.apiKey?.resolve(resolveInput())).toBeUndefined();
	});
});

describe("createNativeApiKeyAuth anonymousCatalog option", () => {
	it("resolves undefined without the opt-in", async () => {
		const auth = createNativeApiKeyAuth({
			name: "Test key",
			prompt: "Test key",
			source: "TEST_API_KEY",
			getApiKey: () => undefined,
		});
		expect(await auth.apiKey?.resolve(resolveInput())).toBeUndefined();
	});

	it("resolves keyless auth with the opt-in", async () => {
		const auth = createNativeApiKeyAuth({
			name: "Test key",
			prompt: "Test key",
			source: "TEST_API_KEY",
			getApiKey: () => undefined,
			anonymousCatalog: true,
		});
		expect(await auth.apiKey?.resolve(resolveInput())).toEqual(anonymous);
	});

	it("still prefers stored and ambient keys when configured", async () => {
		const auth = createNativeApiKeyAuth({
			name: "Test key",
			prompt: "Test key",
			source: "TEST_API_KEY",
			getApiKey: () => "ambient-key",
			anonymousCatalog: true,
		});
		expect(
			await auth.apiKey?.resolve({
				ctx: {} as never,
				credential: { type: "api_key", key: "stored-key" },
				signal: new AbortController().signal,
			} as never),
		).toMatchObject({ auth: { apiKey: "stored-key" }, source: "stored API key" });
		expect(await auth.apiKey?.resolve(resolveInput())).toMatchObject({
			auth: { apiKey: "ambient-key" },
			source: "TEST_API_KEY",
		});
	});
});
