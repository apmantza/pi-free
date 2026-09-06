/**
 * Pure settled-run decisions for auto-fallback (arch lifecycle review).
 *
 * The `agent_settled` handler in `lib/auto-fallback/index.ts` was the
 * highest-complexity symbol in the repo: recovery, failure classification,
 * abort refinement, strike/switch ordering, and auto-continue dispatch were
 * one 100+ complexity function. The decision logic that needs no runtime
 * state lives here as pure, unit-testable functions; the handler keeps only
 * orchestration (reading/writing its closure state around these decisions).
 */

import { classifyAbort, classifyAssistantFailure } from "./classifier.ts";
import type { FallbackScope } from "./selection.ts";

/** Minimal assistant-message shape the settled-time logic reads. */
export interface SettledAssistantMessage {
	role?: string;
	provider?: string;
	model?: string;
	stopReason?: string;
	errorMessage?: string;
}

/** A classified, actionable settled-run failure. */
export interface SettledFailure {
	provider: string;
	modelId: string;
	reason: string;
	key: string;
}

/**
 * Scope predicate shared by candidate enumeration and exhaustion checks.
 * Extracted so both agree by construction instead of duplicating the
 * provider/whitelist branches (they previously drifted independently).
 */
export function matchesScope(
	providerId: string,
	scope: FallbackScope,
	failingProvider: string | undefined,
	whitelistProviders: readonly string[],
): boolean {
	if (scope === "provider" && providerId !== failingProvider) return false;
	if (scope === "whitelist" && !whitelistProviders.includes(providerId)) {
		return false;
	}
	return true;
}

/**
 * Classify a settled run's final assistant message into an actionable
 * failure, or null when the run needs no fallback response.
 *
 * Encodes the full decision chain: failure-shape gate → identity resolution
 * (message fields win, current model is the fallback) → error-message
 * classification → abort refinement against the last observed HTTP status
 * (Q23 = B; user-initiated aborts stay silent per convention 15).
 * `getLastStatus` is injected so the function stays pure and testable.
 */
export function classifySettledFailure(
	lastAssistant: SettledAssistantMessage | null | undefined,
	currentProvider: string | undefined,
	currentModelId: string | undefined,
	getLastStatus: (
		provider: string,
		modelId: string,
	) => number | undefined,
): SettledFailure | null {
	const isFailure =
		lastAssistant != null &&
		(lastAssistant.stopReason === "error" ||
			lastAssistant.stopReason === "aborted");
	if (!isFailure || lastAssistant == null) return null;

	const failingProvider = lastAssistant.provider ?? currentProvider;
	const failingModelId = lastAssistant.model ?? currentModelId;
	if (!failingProvider || !failingModelId) return null;

	let failureReason = lastAssistant.stopReason ?? "error";
	const classified = classifyAssistantFailure(
		lastAssistant.stopReason,
		lastAssistant.errorMessage,
	);
	if (!classified) return null;
	if (classified === "unrecoverable") return null;

	if (lastAssistant.stopReason === "aborted") {
		const lastStatus = getLastStatus(failingProvider, failingModelId);
		const abortKind = classifyAbort(lastStatus);
		if (!abortKind) return null;
		if (abortKind === "unrecoverable") return null;
		failureReason = `abort+http:${lastStatus ?? "?"}`;
	}

	return {
		provider: failingProvider,
		modelId: failingModelId,
		reason: failureReason,
		key: `${failingProvider}/${failingModelId}`,
	};
}

/** Captured user prompt shape consumed by the auto-continue dispatch. */
export interface CapturedPromptLike {
	text: string;
	images?: unknown[];
}

/**
 * Build the replay payload for an armed auto-continue, or null when there
 * is nothing replayable. Image-bearing prompts keep their multimodal shape;
 * text-only prompts replay as a plain string.
 */
export function buildAutoContinueContent(
	prompt: CapturedPromptLike | null | undefined,
): string | unknown[] | null {
	if (!prompt || !prompt.text) return null;
	if (prompt.images && prompt.images.length > 0) {
		return [{ type: "text", text: prompt.text }, ...prompt.images];
	}
	return prompt.text;
}
