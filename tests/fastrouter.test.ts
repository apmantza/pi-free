import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getApiKey: vi.fn((): string | undefined => undefined),
	fetchModels: vi.fn(async (_options: unknown) => []),
	registerNativeOpenAIProvider: vi.fn(),
}));

vi.mock("../config.ts", () => ({
	getFastrouterApiKey: () => mocks.getApiKey(),
	getFastrouterShowPaid: () => false,
	applyHidden: (models: unknown[]) => models,
}));
vi.mock("../providers/model-fetcher.ts", () => ({
	fetchOpenRouterCompatibleModels: (options: unknown) =>
		mocks.fetchModels(options as never),
}));
vi.mock("../lib/native-provider.ts", () => ({
	registerNativeOpenAIProvider: (...args: unknown[]) =>
		mocks.registerNativeOpenAIProvider(...args),
}));

import { fastrouterAuth } from "../providers/fastrouter/fastrouter-auth.ts";
import { fetchFastrouterModels } from "../providers/fastrouter/fastrouter-models.ts";
import fastrouterProvider from "../providers/fastrouter/fastrouter.ts";

beforeEach(() => {
	vi.clearAllMocks();
	mocks.getApiKey.mockReturnValue(undefined);
});

describe("FastRouter native provider", () => {
	it("resolves keyless auth for the public catalog", async () => {
		const result = await fastrouterAuth.apiKey?.resolve({
			ctx: {} as never,
			signal: new AbortController().signal,
		} as never);
		expect(result).toEqual({
			auth: {},
			source: "public catalog (no account)",
		});
		expect(fastrouterAuth.apiKey).not.toHaveProperty("check");
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

	it("registers one native provider with unauthenticated refresh enabled", () => {
		const pi = {} as ExtensionAPI;
		fastrouterProvider(pi);

		expect(mocks.registerNativeOpenAIProvider).toHaveBeenCalledWith(
			pi,
			expect.objectContaining({
				providerId: "fastrouter",
				baseUrl: "https://api.fastrouter.ai/api/v1",
				allowUnauthenticated: true,
			}),
		);
	});

	it("fetches the public catalog without manufacturing an auth header", async () => {
		const signal = new AbortController().signal;
		await fetchFastrouterModels("", signal);
		expect(mocks.fetchModels).toHaveBeenCalledWith(
			expect.objectContaining({
				providerId: "fastrouter",
				baseUrl: "https://api.fastrouter.ai/api/v1",
				apiKey: undefined,
				signal,
			}),
		);
	});

	it("excludes media-generation output modalities from the catalog", async () => {
		await fetchFastrouterModels("");
		expect(mocks.fetchModels).toHaveBeenCalledWith(
			expect.objectContaining({
				excludeOutputModalities: ["image", "audio", "video", "speech"],
			}),
		);
	});
});
