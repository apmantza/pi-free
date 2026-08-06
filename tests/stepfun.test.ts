import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getApiKey: vi.fn((): string | undefined => undefined),
	fetchModels: vi.fn(async (_args: unknown) => [{ id: "step-3.7-flash" }]),
	applyHidden: vi.fn((models: unknown[]) => models),
	registerNativeOpenAIProvider: vi.fn(),
}));

vi.mock("../config.ts", () => ({
	getStepfunApiKey: () => mocks.getApiKey(),
	getStepfunShowPaid: () => false,
	applyHidden: (models: unknown[], _providerId?: string) =>
		mocks.applyHidden(models),
}));
vi.mock("../lib/util.ts", () => ({
	fetchOpenAICompatibleModels: (...args: unknown[]) =>
		mocks.fetchModels(args),
}));
vi.mock("../lib/native-provider.ts", () => ({
	createNativeApiKeyAuth: (options: {
		name: string;
		prompt: string;
		source: string;
		getApiKey: () => string | undefined;
	}) => ({
		apiKey: {
			name: options.name,
			async login(interaction: { prompt: (input: unknown) => Promise<string> }) {
				return { type: "api_key", key: await interaction.prompt({}) };
			},
			async resolve(input: { credential?: { key?: string } }) {
				const key = input.credential?.key ?? options.getApiKey();
				return key
					? { auth: { apiKey: key }, source: options.source }
					: undefined;
			},
		},
	}),
	registerNativeOpenAIProvider: (...args: unknown[]) =>
		mocks.registerNativeOpenAIProvider(...args),
}));

import stepfunProvider from "../providers/stepfun/stepfun.ts";
import { stepfunAuth } from "../providers/stepfun/stepfun-auth.ts";
import { fetchStepfunModels } from "../providers/stepfun/stepfun-models.ts";

beforeEach(() => {
	vi.clearAllMocks();
	mocks.getApiKey.mockReturnValue(undefined);
});

describe("StepFun native provider", () => {
	it("resolves stored and ambient API keys without exposing them", async () => {
		mocks.getApiKey.mockReturnValue("ambient-test-key");
		expect(
			await stepfunAuth.apiKey?.resolve({
				ctx: {} as never,
				credential: { type: "api_key", key: "stored-test-key" },
				signal: new AbortController().signal,
			} as never),
		).toMatchObject({ auth: { apiKey: "stored-test-key" } });
		expect(
			await stepfunAuth.apiKey?.resolve({
				ctx: {} as never,
				signal: new AbortController().signal,
			} as never),
		).toMatchObject({ auth: { apiKey: "ambient-test-key" } });
	});

	it("does not resolve auth when no key is configured", async () => {
		expect(
			await stepfunAuth.apiKey?.resolve({
				ctx: {} as never,
				signal: new AbortController().signal,
			} as never),
		).toBeUndefined();
	});

	it("registers StepFun through the native OpenAI lifecycle", () => {
		const pi = {} as ExtensionAPI;
		stepfunProvider(pi);

		expect(mocks.registerNativeOpenAIProvider).toHaveBeenCalledWith(
			pi,
			expect.objectContaining({
				providerId: "stepfun",
				name: "StepFun",
				baseUrl: "https://api.stepfun.ai/step_plan/v1",
			}),
		);
	});

	it("fetches and hides models using Pi's native refresh inputs", async () => {
		const signal = new AbortController().signal;
		const models = await fetchStepfunModels("test-key", signal);

		expect(mocks.fetchModels).toHaveBeenCalledWith([
			"stepfun",
			"https://api.stepfun.ai/step_plan/v1",
			"test-key",
			expect.objectContaining({ contextWindow: 128_000, maxTokens: 16_384 }),
			undefined,
			signal,
		]);
		expect(mocks.applyHidden).toHaveBeenCalledWith(models);
	});
});
