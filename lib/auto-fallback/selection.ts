/**
 * Candidate selection for auto-fallback.
 *
 * Picks the next model to switch to after a failure. Implements the
 * selection strategy agreed in design (Q3 = D):
 *
 *   1. Compute the candidate set:
 *      - **provider scope** (default): every free model in the SAME
 *        provider as the failing one. Pi may switch model ids without
 *        changing provider identity, so this is the safe default.
 *      - **global scope**: every free model across every registered
 *        provider. User must opt in via `auto_fallback_scope: "global"`.
 *      - **whitelist scope**: only the providers the user listed in
 *        `auto_fallback_providers`.
 *   2. Exclude the current model itself (no point switching to the
 *      same model on the same provider).
 *   3. Exclude anything in the blacklist (active TTL entries + hard bans).
 *   4. Sort by CI score descending — best-quality candidate first.
 *   5. If no scored candidates remain, fall back to the alphabetical
 *      order of remaining unblacklisted candidates so the function still
 *      returns SOMETHING usable.
 *
 * Selection is a pure decision: it does NOT call `pi.setModel`. The caller
 * (auto-fallback entry point) takes the returned candidate and applies it.
 */

import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { getHardcodedScore } from "../../provider-failover/benchmark-lookup.ts";
import type { Blacklist } from "./blacklist.ts";

/** Scope of the fallback candidate pool (Q1 = D, configurable). */
export type FallbackScope = "provider" | "global" | "whitelist";

/** A model selected by the fallback logic, ready to be passed to pi.setModel. */
export interface FallbackCandidate {
	provider: string;
	modelId: string;
	name: string;
	ciScore: number | null;
}

export interface SelectionOptions {
	scope: FallbackScope;
	whitelist?: ReadonlyArray<string>;
	blacklist: Blacklist;
	/**
	 * Get all free-model candidates. Receives the optional scope; for
	 * provider-local it filters by the failing provider, otherwise it
	 * returns the union across providers.
	 */
	getCandidates: (scopeFilter?: string) => ReadonlyArray<CandidateSource>;
}

/** Minimum data the selector needs about a candidate model. */
export interface CandidateSource {
	provider: string;
	modelId: string;
	name: string;
}

/**
 * Pick the next fallback model, or null if the candidate pool is empty.
 *
 * @param currentProvider - Provider id of the failing model (used by
 *     scope=provider to filter; ignored otherwise).
 * @param currentModelId - Model id of the failing model (always excluded
 *     from candidates, even when the provider has multiple ids).
 */
export function rankFallbackCandidates(
	currentProvider: string,
	currentModelId: string,
	options: SelectionOptions,
): FallbackCandidate[] {
	const scopedCandidates = filterByScope(
		options.getCandidates(),
		options.scope,
		currentProvider,
		options.whitelist,
	);

	const filtered: CandidateSource[] = [];
	for (const candidate of scopedCandidates) {
		// Always skip the failing model itself.
		if (
			candidate.provider === currentProvider &&
			candidate.modelId === currentModelId
		) {
			continue;
		}
		// Skip blacklisted (in-TTL soft ban + hard ban).
		if (options.blacklist.isBlacklisted(modelKey(candidate.provider, candidate.modelId))) {
			continue;
		}
		filtered.push(candidate);
	}

	if (filtered.length === 0) return [];

	// Score and sort. CI score is best-effort; missing scores rank below
	// any scored candidate. Stable secondary sort by model id keeps the
	// output deterministic across calls with identical inputs.
	const scored = filtered
		.map((candidate) => ({
			...candidate,
			ciScore: lookupCi(candidate.provider, candidate.modelId, candidate.name),
		}))
		.sort((a, b) => {
			if (a.ciScore === b.ciScore) {
				return `${a.provider}/${a.modelId}`.localeCompare(
					`${b.provider}/${b.modelId}`,
				);
			}
			if (a.ciScore === null) return 1;
			if (b.ciScore === null) return -1;
			return b.ciScore - a.ciScore;
		});

	return scored;
}

/**
 * Pick the single best fallback candidate (top of `rankFallbackCandidates`),
 * or null if the scoped pool is empty. Kept for callers that only need one.
 */
export function selectFallbackModel(
	currentProvider: string,
	currentModelId: string,
	options: SelectionOptions,
): FallbackCandidate | null {
	return rankFallbackCandidates(currentProvider, currentModelId, options)[0] ?? null;
}

function filterByScope(
	all: ReadonlyArray<CandidateSource>,
	scope: FallbackScope,
	currentProvider: string,
	whitelist: ReadonlyArray<string> | undefined,
): CandidateSource[] {
	if (scope === "provider") {
		return all.filter((c) => c.provider === currentProvider);
	}
	if (scope === "whitelist") {
		if (!whitelist || whitelist.length === 0) return [];
		const set = new Set(whitelist);
		return all.filter((c) => set.has(c.provider));
	}
	// "global" — all candidates across all providers.
	return [...all];
}

function lookupCi(
	provider: string,
	modelId: string,
	name: string,
): number | null {
	// `getHardcodedScore` accepts name, id, and optional provider. We pass
	// through all three so the benchmark-lookup heuristics have the same
	// signals they get from `enhanceModelNameWithCodingIndex`.
	try {
		return getHardcodedScore(name, modelId, provider);
	} catch {
		// Benchmark lookup is best-effort — a missing score is fine.
		return null;
	}
}

/** Build a stable composite key for blacklist + log lines. */
export function modelKey(provider: string, modelId: string): string {
	return `${provider}/${modelId}`;
}

/**
 * Convenience helper to project `ProviderModelConfig` arrays from
 * `lib/registry.ts` into the slim shape the selector needs.
 */
export function projectCandidates(
	models: ReadonlyArray<ProviderModelConfig & { provider?: string }>,
	providerId: string,
): CandidateSource[] {
	const projected: CandidateSource[] = [];
	for (const model of models) {
		// Prefer the model-level provider stamp (set by the enhancer or the
		// native provider); fall back to the registration id otherwise.
		const provider = model.provider ?? providerId;
		projected.push({
			provider,
			modelId: model.id,
			name: model.name,
		});
	}
	return projected;
}