/**
 * Agnes AI's OpenAI-compatible model catalog.
 *
 * Agnes AI exposes a plain OpenAI `/v1/models` list (id, object, created,
 * owned_by, supported_endpoint_types) with NO pricing, modality or
 * architecture fields. The catalog mixes text chat models with image/video
 * generators, and every row (generators included) lists
 * `supported_endpoint_types: ["openai"]` (live, 2026-11-15), so the catalog
 * itself cannot tell them apart (defect shape 16: never drop by id
 * substring). Admission and the free verdict therefore come from one curated
 * table built from Agnes's docs; see `AGNES_TEXT_MODELS`.
 */

import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { applyHidden } from "../../config.ts";
import { BASE_URL_AGNES, PROVIDER_AGNES } from "../../constants.ts";
import { fetchOpenAICompatibleModels } from "../../lib/util.ts";

/** Augmented model shape carrying the authoritative free/paid flag. */
type AgnesProviderModel = ProviderModelConfig & {
	_freeKnown?: boolean;
	_isFree?: boolean;
};

/**
 * Agnes's text chat models and whether each is free, from the docs index
 * (https://wiki.agnes-ai.com/llms.txt, "Text" section) and the pricing page
 * (https://wiki.agnes-ai.com/en/docs/pricing), both read 2026-11-15. Free
 * offers there are promotional with no published end date and apply to
 * default users only; revisit this table at every release audit.
 *
 * This is an admit-list: a catalog id not named here (an image/video
 * generator, or an undocumented row such as `agnes-2.5-pro-alpha`) is not
 * published, because no catalog field says it is a chat model.
 * `agnes-3.0-pro` is documented as coming soon.
 */
const AGNES_TEXT_MODELS: ReadonlyMap<string, { free: boolean }> = new Map([
	["agnes-2.5-flash", { free: true }],
	["agnes-3.0-flash", { free: true }],
	["agnes-2.5-pro", { free: false }],
	["agnes-2.5-pro-beta", { free: false }],
	["agnes-2.5-pro-theta", { free: false }],
	["agnes-3.0-pro", { free: false }],
]);

/**
 * Fetch Agnes AI's `/v1/models` catalog, keep the documented text chat
 * models, and stamp each with its documented free/paid verdict.
 */
export async function fetchAgnesModels(
	apiKey: string,
	signal?: AbortSignal,
): Promise<ProviderModelConfig[]> {
	const models = await fetchOpenAICompatibleModels(
		PROVIDER_AGNES,
		BASE_URL_AGNES,
		apiKey,
		{
			contextWindow: 128_000,
			maxTokens: 16_384,
		},
		undefined,
		signal,
	);

	const stamped: AgnesProviderModel[] = models.flatMap((model) => {
		const known = AGNES_TEXT_MODELS.get(model.id);
		if (!known) return [];
		return [{ ...model, _freeKnown: true, _isFree: known.free }];
	});

	return applyHidden(stamped, PROVIDER_AGNES);
}
