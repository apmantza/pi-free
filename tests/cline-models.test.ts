import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../config.ts", () => ({
	applyHidden: <T>(models: T[]) => models,
}));

vi.mock("../lib/model-metadata.ts", () => ({
	safeEnrichModelsWithModelsDev: async <T>(models: T[]) => models,
}));

vi.mock("../lib/registry.ts", () => ({
	isFreeModel: (model: { cost?: { input?: number; output?: number } }) =>
		(model.cost?.input ?? 0) === 0 && (model.cost?.output ?? 0) === 0,
}));

import { fetchClineCatalog } from "../providers/cline/cline-models.ts";

function catalogModel(id: string) {
	return {
		id,
		pricing: {
			prompt: "0.000001",
			completion: "0.000002",
		},
		architecture: { output_modalities: ["text"] },
	};
}

function stubClineEndpoints(freeIds: string[], catalog: unknown[]) {
	const fetchMock = vi.fn(async (url: string) => {
		const body = url.includes("recommended-models")
			? { free: freeIds.map((id) => ({ id })) }
			: { data: catalog };
		return new Response(JSON.stringify(body), {
			status: 200,
			statusText: "OK",
			headers: { "Content-Type": "application/json" },
		});
	});
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("Cline free-to-try catalog matching", () => {
	it("marks only exact free-to-try ids free; dated variants stay paid", async () => {
		const freeId = "deepseek/deepseek-v4-flash";
		const datedQualifiedId = "deepseek/deepseek-v4-flash-0731";
		const datedLeafId = "deepseek-v4-flash-0731";
		const paidVariantId = "deepseek/deepseek-v4-flash-pro";
		const otherProviderId = "other/deepseek-v4-flash";

		stubClineEndpoints(
			[freeId],
			[
				catalogModel(freeId),
				catalogModel(datedQualifiedId),
				catalogModel(datedLeafId),
				catalogModel(paidVariantId),
				catalogModel(otherProviderId),
			],
		);

		const { all, free } = await fetchClineCatalog();
		const byId = new Map(all.map((model) => [model.id, model]));

		// Exact match is free.
		expect(byId.get(freeId)).toMatchObject({
			cost: { input: 0, output: 0 },
			name: expect.not.stringContaining("💰"),
		});
		expect(free.map((model) => model.id)).toEqual([freeId]);

		// Dated/leaf/other-provider variants are paid — the old fuzzy aliasing
		// zero-priced dated variants that return 402 at request time.
		for (const id of [datedQualifiedId, datedLeafId, paidVariantId, otherProviderId]) {
			expect(byId.get(id)?.cost.input).toBeGreaterThan(0);
		}
	});
});
