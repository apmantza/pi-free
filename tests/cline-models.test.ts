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

describe("Cline free-to-try catalog aliases", () => {
	it("applies free pricing before native free splitting for qualified and leaf date aliases", async () => {
		const freeId = "deepseek/deepseek-v4-flash";
		const datedQualifiedId = "deepseek/deepseek-v4-flash-0731";
		const datedLeafId = "deepseek-v4-flash-0731";
		const paidVariantId = "deepseek/deepseek-v4-flash-pro";
		const otherProviderId = "other/deepseek-v4-flash-0731";

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

		for (const id of [freeId, datedQualifiedId, datedLeafId]) {
			expect(byId.get(id)).toMatchObject({
				cost: { input: 0, output: 0 },
				name: expect.not.stringContaining("💰"),
			});
		}

		expect(free.map((model) => model.id)).toEqual([
			freeId,
			datedQualifiedId,
			datedLeafId,
		]);
		expect(byId.get(paidVariantId)?.cost.input).toBeGreaterThan(0);
		expect(byId.get(otherProviderId)?.cost.input).toBeGreaterThan(0);
	});
});
