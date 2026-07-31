import type { Model, Provider } from "@earendil-works/pi-ai/compat";
import { createModels } from "@earendil-works/pi-ai/compat";
import { describe, expect, it } from "vitest";

function model(id: string): Model<"openai-completions"> {
	return {
		id,
		name: id,
		api: "openai-completions",
		provider: "native-filter-test",
		baseUrl: "https://example.test/v1",
		reasoning: false,
		input: ["text"],
		cost: { input: id === "free" ? 0 : 1, output: id === "free" ? 0 : 1, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 32_000,
		maxTokens: 4_096,
	};
}

describe("native filterModels availability snapshots", () => {
	it("settles on the filtered view after re-registering the same provider", async () => {
		const all = [model("free"), model("paid")];
		let freeOnly = true;
		const provider: Provider<"openai-completions"> = {
			id: "native-filter-test",
			name: "Native filter test",
			auth: {
				apiKey: {
					name: "Test API key",
					resolve: async () => ({ auth: { apiKey: "test-key" } }),
				},
			},
			getModels: () => all,
			filterModels: (models) =>
				freeOnly ? models.filter((item) => item.id === "free") : models,
			stream: () => undefined as never,
			streamSimple: () => undefined as never,
		};
		const models = createModels();
		models.setProvider(provider);

		expect((await models.getAvailable()).map((item) => item.id)).toEqual([
			"free",
		]);
		expect(models.getModels().map((item) => item.id)).toEqual(["free", "paid"]);

		freeOnly = false;
		models.setProvider(provider);

		expect((await models.getAvailable()).map((item) => item.id)).toEqual([
			"free",
			"paid",
		]);
	});
});
