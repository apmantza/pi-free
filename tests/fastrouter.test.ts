import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getApiKey: vi.fn((): string | undefined => undefined),
	registerNativeOpenAIProvider: vi.fn(),
}));

vi.mock("../config.ts", () => ({
	getFastrouterApiKey: () => mocks.getApiKey(),
	getFastrouterShowPaid: () => false,
	applyHidden: (models: unknown[]) => models,
	// Non-key exports pulled in transitively by lib/native-provider.
	getFreeOnly: () => false,
	getProviderShowPaid: () => false,
	saveConfig: async () => undefined,
}));
vi.mock("../lib/native-provider.ts", async (importOriginal) => ({
	...(await importOriginal<typeof import("../lib/native-provider.ts")>()),
	registerNativeOpenAIProvider: (...args: unknown[]) =>
		mocks.registerNativeOpenAIProvider(...args),
}));

import { fastrouterAuth } from "../providers/fastrouter/fastrouter-auth.ts";
import fastrouterProvider from "../providers/fastrouter/fastrouter.ts";

beforeEach(() => {
	vi.clearAllMocks();
	mocks.getApiKey.mockReturnValue(undefined);
});

describe("FastRouter native provider", () => {
	it("resolves undefined without a key, so Pi hides FastRouter (#697)", async () => {
		// Recurrence: a keyless resolve listed 6 FastRouter models for users
		// without a key and every turn failed "No API key for provider".
		const result = await fastrouterAuth.apiKey?.resolve({
			ctx: {} as never,
			signal: new AbortController().signal,
		} as never);
		expect(result).toBeUndefined();
	});

	it("uses stored or ambient keys for authenticated requests", async () => {
		mocks.getApiKey.mockReturnValue("ambient-key");
		expect(
			await fastrouterAuth.apiKey?.resolve({
				ctx: {} as never,
				credential: { type: "api_key", key: "stored-key" },
				signal: new AbortController().signal,
			} as never),
		).toMatchObject({ auth: { apiKey: "stored-key" } });
		expect(
			await fastrouterAuth.apiKey?.resolve({
				ctx: {} as never,
				signal: new AbortController().signal,
			} as never),
		).toMatchObject({ auth: { apiKey: "ambient-key" } });
	});

	it("registers one native provider with the keyed auth", () => {
		const pi = {} as ExtensionAPI;
		fastrouterProvider(pi);

		expect(mocks.registerNativeOpenAIProvider).toHaveBeenCalledWith(
			pi,
			expect.objectContaining({
				providerId: "fastrouter",
				baseUrl: "https://api.fastrouter.ai/api/v1",
				auth: fastrouterAuth,
			}),
		);
	});
});
