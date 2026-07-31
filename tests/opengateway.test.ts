import { afterEach, describe, expect, it, vi } from "vitest";
import {
	fetchOpenGatewayModels,
	getInitialOpenGatewayModels,
	mapOpenGatewayModel,
} from "../providers/opengateway/opengateway.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
	vi.restoreAllMocks();
});

describe("OpenGateway model mapping", () => {
	it("normalizes the accepted MiMo short alias and uses effective pricing", () => {
		const model = mapOpenGatewayModel({
			id: "xiaomi/mimo-v2.5-pro",
			name: "MiMo V2.5-Pro",
			context_window: 262_144,
			pricing: { prompt: "0.000000435", completion: "0.00000087" },
			effective_pricing: {
			prompt: "0.000000522",
			completion: "0.000001044",
		},
		});

		expect(model).toMatchObject({
			id: "mimo-v2.5-pro",
			cost: { input: 0.000000522, output: 0.000001044 },
			contextWindow: 262_144,
			_pricingKnown: true,
			_freeKnown: true,
			_isFree: false,
		});
	});

	it("marks zero-priced promotional models free without treating auto as free", () => {
		const free = mapOpenGatewayModel({
			id: "nvidia/nemotron-3-ultra-550b-a55b:free",
			name: "Nemotron 3 Ultra",
			pricing: { prompt: "0", completion: "0" },
		});
		const auto = mapOpenGatewayModel({
			id: "auto",
			name: "Auto (smart routing)",
		});

		expect(free).toMatchObject({
			_freeKnown: true,
			_isFree: true,
			_pricingKnown: true,
		});
		expect(auto).toMatchObject({ _pricingKnown: false });
		expect(auto).not.toHaveProperty("_freeKnown");
	});

	it("includes the current catalog as an offline initial list", () => {
		const models = getInitialOpenGatewayModels();

		expect(models.map((model) => model.id)).toEqual(
			expect.arrayContaining([
				"auto",
				"mimo-v2.5-pro",
				"google/gemini-3.1-flash-lite",
				"nvidia/nemotron-3-ultra-550b-a55b:free",
			]),
		);
	});
});

describe("OpenGateway catalog fetch", () => {
	it("fetches the OpenAI-compatible model catalog with bearer auth", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({
				data: [
					{
						id: "xiaomi/mimo-v2.5-pro",
						name: "MiMo V2.5-Pro",
						context_window: 262_144,
						effective_pricing: {
							prompt: "0.000000522",
							completion: "0.000001044",
						},
					},
				],
			}),
		});
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const models = await fetchOpenGatewayModels("test-key");

		expect(fetchMock).toHaveBeenCalledWith(
			"https://opengateway.gitlawb.com/v1/models",
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: "Bearer test-key",
				}),
			}),
		);
		expect(models[0]).toMatchObject({ id: "mimo-v2.5-pro" });
	});
});
