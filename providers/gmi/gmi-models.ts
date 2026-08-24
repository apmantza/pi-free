/**
 * GMI Cloud's OpenAI-compatible model catalog.
 *
 * GMI Cloud's Inference API follows the OpenAI model-list shape and exposes
 * per-model pricing (`pricing.prompt`/`pricing.completion`), which the shared
 * mapper reads so pi-free's Route A cost-based free-detector is active. The
 * shared mapper preserves pricing/capability metadata and applies models.dev
 * enrichment without introducing a second cache or freshness policy.
 *
 * Promotional free models: GMI runs time-limited "free week" promotions
 * (e.g. MiniMax Week, 2026-08-24 → 2026-09-06) where specific models are free
 * to use at the billing layer even though the `/v1/models` `pricing` field
 * still reports nonzero list prices. Such models are stamped authoritatively
 * free (`_freeKnown`/`_isFree`, the same escape hatch used by the anyapi/bai/
 * agnes gateways) for the duration of the promotion so the free-only view and
 * `/free-providers` counts are correct; the stamp auto-expires when the
 * promotion ends so the models revert to paid per the pricing API.
 */

import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { applyHidden } from "../../config.ts";
import { BASE_URL_GMI, PROVIDER_GMI } from "../../constants.ts";
import { fetchOpenAICompatibleModels } from "../../lib/util.ts";

/** Augmented model shape carrying the authoritative free/paid flag. */
type GmiProviderModel = ProviderModelConfig & {
	_freeKnown?: boolean;
	_isFree?: boolean;
};

interface Promotion {
	/** Model ids (as published by GMI's /v1/models) that are free for the window. */
	modelIds: readonly string[];
	/** Inclusive start (ms since epoch). */
	startMs: number;
	/** Exclusive end (ms since epoch) — promotion is active while startMs <= now < endMs. */
	endMs: number;
	/** Human-readable label for logging. */
	label: string;
}

/**
 * Known GMI free-week promotions. Keep this list in sync with GMI's
 * announcements (https://x.com/gmi_cloud). Each window is [inclusive, exclusive).
 */
const PROMOTIONS: readonly Promotion[] = [
	{
		// "unlimited MiniMax M3 and M2.7, 14 days FREE on GMI Cloud from 8/24
		// to 9/6" — https://x.com/gmi_cloud/status/2091925007756857368
		modelIds: ["MiniMaxAI/MiniMax-M3", "MiniMaxAI/MiniMax-M2.7"],
		startMs: Date.UTC(2026, 7, 24), // 2026-08-24 00:00 UTC (month is 0-indexed)
		endMs: Date.UTC(2026, 8, 7), // 2026-09-07 00:00 UTC (end of 9/6)
		label: "GMI MiniMax Week (M3, M2.7 free)",
	},
];

/**
 * Model ids that are authoritatively free right now because an active GMI
 * promotion makes them free at the billing layer despite nonzero list prices.
 */
function activePromotionalFreeIds(now: number = Date.now()): Set<string> {
	const free = new Set<string>();
	for (const promo of PROMOTIONS) {
		if (now >= promo.startMs && now < promo.endMs) {
			for (const id of promo.modelIds) free.add(id);
		}
	}
	return free;
}

/**
 * Fetch GMI Cloud's authenticated `/v1/models` catalog, then stamp any model
 * that is free under an active GMI promotion as authoritatively free.
 */
export async function fetchGmiModels(
	apiKey: string,
	signal?: AbortSignal,
): Promise<ProviderModelConfig[]> {
	const models = await fetchOpenAICompatibleModels(
		PROVIDER_GMI,
		BASE_URL_GMI,
		apiKey,
		{
			contextWindow: 128_000,
			maxTokens: 16_384,
		},
		undefined,
		signal,
	);

	const promotionalFree = activePromotionalFreeIds();
	const stamped: GmiProviderModel[] = models.map((model) => {
		if (!promotionalFree.has(model.id)) return model;
		return {
			...model,
			_freeKnown: true,
			_isFree: true,
		};
	});

	return applyHidden(stamped, PROVIDER_GMI);
}
