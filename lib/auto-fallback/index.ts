/**
 * Auto-fallback entry point.
 *
 * Wires the classifier + blacklist + selector + notifier + commands into
 * Pi's event bus. Subscribes to:
 *
 *   - `after_provider_response` — refresh `fallbackState` with the latest
 *     HTTP status per key. Used by the abort heuristic (Q23 = B).
 *   - `message_end` — when the assistant message has stopReason
 *     "error"/"aborted", update the blacklist with the failure class.
 *     Fast path: blacklist is updated even when Pi will retry, so a
 *     second attempt with the same broken model does not happen needlessly.
 *   - `agent_end` — PRIMARY trigger. When `willRetry === false` AND the
 *     last assistant message was a recoverable failure, run the selector
 *     and `pi.setModel()` to the next candidate. Per Q30 = B this is the
 *     only point at which we actually switch models; everything else is
 *     bookkeeping.
 *   - `agent_settled` — recovery: if the previous switch landed on a
 *     model that subsequently succeeded, clear its blacklist entry and
 *     (per restoreMode) optionally switch back to the user's pre-fallback
 *     model.
 *   - `model_select` — clear the pre-fallback marker if the user has
 *     manually picked another model (so we don't try to "restore" over
 *     their explicit choice).
 *
 * Per Q2, every callback early-returns when the global free-only toggle
 * is OFF. Per Q25 = C, the blacklist is preserved across toggle changes
 * so toggling back on immediately benefits from the existing state.
 *
 * Per Q7 = A and AGENTS.md convention: extension code cannot interrupt
 * an in-flight run. `pi.setModel()` always rewrites the global default
 * (issue #1248, not_planned); we accept the stickiness and document it
 * in the README + the `/pi-free-health` status line.
 */

import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { getProviderRegistry } from "../registry.ts";
import { fallbackState } from "../fallback-state.ts";
import { createLogger } from "../logger.ts";
import {
	classifyAssistantFailure,
	classifyAbort,
	classifyHttpStatus,
} from "./classifier.ts";
import { createBlacklist, type Blacklist } from "./blacklist.ts";
import { getAutoFallbackConfig } from "./config.ts";
import {
	modelKey,
	rankFallbackCandidates,
	type FallbackCandidate,
	type FallbackScope,
} from "./selection.ts";
import { createNotifier, type Notifier } from "./notify.ts";
import {
	registerAutoFallbackCommands,
	type HistoryEntry,
} from "./commands.ts";

const _logger = createLogger("auto-fallback");

/** Exposed for `/pi-free-health`. */
export interface AutoFallbackStatus {
	enabled: boolean;
	exhausted: boolean;
	blacklistSize: number;
	switchCount: number;
	lastSwitchAt: number | null;
	lastSwitchReason: string | null;
}

/** Max entries kept in the in-memory switch history (Q27 = C). */
const MAX_HISTORY = 50;

/**
 * Loose type for the Model objects pi-coding-agent exposes through
 * `modelRegistry.getAll()`. We only read `provider` + `id` from them.
 */
interface ModelIdentity {
	provider: string;
	id: string;
}

/**
 * Loose type for the registry exposed on `ExtensionContext.modelRegistry`.
 * The official typing is overloaded; we only need two methods.
 */
interface ModelRegistryLike {
	getAll?: () => ModelIdentity[];
	/** Resolves the provider's auth, or undefined if no usable auth (no key). */
	getProviderAuth?: (provider: string) => Promise<unknown>;
}

export interface AutoFallbackHandle {
	register(pi: ExtensionAPI): void;
	getStatus(): AutoFallbackStatus;
}

export function createAutoFallback(): AutoFallbackHandle {
	// Fresh state on each createAutoFallback() call (extension reload).
	const blacklist: Blacklist = createBlacklist();
	const history: HistoryEntry[] = [];
	let preFallbackModel: { provider: string; modelId: string } | null = null;
	const handledFailureKeys = new Set<string>();
	let lastSeenCtx: ExtensionContext | undefined;
	let pi: ExtensionAPI | undefined;

	// Auto-continue: capture the user's most recent prompt so that after a
	// successful fallback switch we can re-issue it on the new model without
	// the user having to manually re-send. Pi has no turn-replay hook (issue
	// #1248, not_planned), so this is the only way to keep a failed turn's
	// intent moving forward.
	interface CapturedPrompt {
		text: string;
		images?: unknown[];
	}
	let lastUserPrompt: CapturedPrompt | null = null;
	let pendingAutoContinue: { failureKey: string; turnIndex: number | undefined } | null =
		null;
	let autoContinueBudget = 0;
	let budgetInitialized = false;

	// Built lazily on first event (we need a fresh ctx per event, and the
	// notifier config is resolved when the first switch happens so live
	// /toggle-auto-fallback changes apply).
	let notifier: Notifier | undefined;

	function getNotifier(): Notifier {
		if (notifier) return notifier;
		const cfg = getAutoFallbackConfig();
		notifier = createNotifier(() => lastSeenCtx, { level: cfg.notifyLevel });
		return notifier;
	}

	function isAutoFallbackLive(): boolean {
		const current = getAutoFallbackConfig();
		return current.enabled;
	}

	function recordHistory(entry: HistoryEntry): void {
		history.push(entry);
		if (history.length > MAX_HISTORY) {
			history.splice(0, history.length - MAX_HISTORY);
		}
	}

	function candidatesFor(
		failingProvider: string,
		scopeOverride?: FallbackScope,
	): FallbackCandidate[] {
		const cfg = getAutoFallbackConfig();
		const scope: FallbackScope = scopeOverride ?? cfg.scope;
		const registry = getProviderRegistry();
		const out: FallbackCandidate[] = [];
		for (const [providerId, entry] of registry) {
			if (scope === "provider" && providerId !== failingProvider) continue;
			if (
				scope === "whitelist" &&
				!cfg.whitelistProviders.includes(providerId)
			) {
				continue;
			}
			for (const m of entry.stored.free) {
				out.push({
					provider: providerId,
					modelId: m.id,
					name: m.name,
					ciScore: null,
				});
			}
		}
		return out;
	}

	async function performSwitch(
		ctx: ExtensionContext,
		failureReason: string,
		failureKey: string,
		turnIndex: number | undefined,
	): Promise<{ switched: boolean; reason: string }> {
		if (!pi) return { switched: false, reason: "pi-not-registered" };
		const current = ctx.model;
		if (!current) return { switched: false, reason: "no-current-model" };
		const provider = current.provider;
		const modelId = current.id;
		if (!provider || !modelId) {
			return { switched: false, reason: "no-current-model-identity" };
		}

		// Always blacklist the model that failed so a later same-turn retry
		// (or a future turn) does not loop on it.
		blacklist.recordFailure(modelKey(provider, modelId), failureReason);

		const cfg = getAutoFallbackConfig();
		// Rank candidates by CI score. Prefer the configured scope
		// (provider/whitelist); if that yields nothing and the scope is
		// provider, fall through to a GLOBAL pool so a provider-wide outage
		// still triggers a switch to *any* other free model instead of
		// silently doing nothing.
		const ranked = rankFallbackCandidates(provider, modelId, {
			scope: cfg.scope,
			whitelist: cfg.whitelistProviders,
			blacklist,
			getCandidates: () => candidatesFor(provider, cfg.scope),
		});
		if (ranked.length === 0 && cfg.scope === "provider") {
			ranked.push(
				...rankFallbackCandidates(provider, modelId, {
					scope: "global",
					whitelist: cfg.whitelistProviders,
					blacklist,
					getCandidates: () => candidatesFor(provider, "global"),
				}),
			);
		}

		if (ranked.length === 0) {
			const exhausted = noCandidatesAvailable();
			ctx.ui.notify(
				exhausted
					? `Auto-fallback: no other free model available (provider ${provider} exhausted) — staying on ${provider}/${modelId}.`
					: `Auto-fallback: no alternative free model for ${provider}/${modelId}.`,
				"warning",
			);
			return { switched: false, reason: "no-candidate" };
		}

		const registry = ctx.modelRegistry as ModelRegistryLike | undefined;
		const allModels = registry?.getAll?.() ?? [];
		// Try each candidate in CI-score order. Skip providers that have no
		// usable auth — pi.setModel() rejects those with "No API key", so we
		// must not waste a switch attempt (and the resulting warning) on a
		// provider the user hasn't configured.
		let tried = 0;
		for (const cand of ranked) {
			const newModel = allModels.find(
				(m) => m.provider === cand.provider && m.id === cand.modelId,
			);
			if (!newModel) {
				blacklist.recordFailure(
					modelKey(cand.provider, cand.modelId),
					"not-in-catalog",
				);
				continue;
			}
			// Provider auth resolution can reject (no usable credential); treat
			// a throw the same as "no auth" and skip the candidate.
			let hasAuth = true;
			if (registry?.getProviderAuth) {
				try {
					hasAuth = !!(await registry.getProviderAuth(cand.provider));
				} catch {
				hasAuth = false;
				}
			}
			if (!hasAuth) {
				// Provider has no usable auth (e.g. needs an API key). Skip it
				// and remember not to retry it this session window.
				blacklist.recordFailure(
					modelKey(cand.provider, cand.modelId),
					"no-auth",
				);
				tried++;
				continue;
			}
			const ok = await safeSetModel(newModel);
			if (!ok) {
				blacklist.recordFailure(
					modelKey(cand.provider, cand.modelId),
					"setModel-rejected",
				);
				tried++;
				continue;
			}

			// Success: remember the user's original pick so we can
			// (optionally) restore it later.
			if (!preFallbackModel) {
				preFallbackModel = { provider, modelId };
			}

			recordHistory({
				at: Date.now(),
				fromKey: modelKey(provider, modelId),
				toKey: modelKey(cand.provider, cand.modelId),
				reason: failureReason,
				recovered: false,
			});
			getNotifier().recordSwitch({
				fromKey: modelKey(provider, modelId),
				toKey: modelKey(cand.provider, cand.modelId),
				reason: failureReason,
				at: Date.now(),
			});
			_logger.info(
				`auto-fallback: switched ${modelKey(provider, modelId)} → ${modelKey(cand.provider, cand.modelId)} (reason=${failureReason})`,
			);

			const idemKey = `${failureKey}:${turnIndex ?? "?"}`;
			handledFailureKeys.add(idemKey);
			// Mark for auto-continue: agent_settled will replay the captured
			// prompt on the new model so the user doesn't have to re-send.
			pendingAutoContinue = { failureKey, turnIndex };
			return { switched: true, reason: failureReason };
		}

		// We had candidates but none were switchable (all lacked auth or
		// rejected the switch).
		ctx.ui.notify(
			`Auto-fallback: no switchable free model available (tried ${tried} candidate${tried === 1 ? "" : "s"}; the rest need an API key or rejected the switch).`,
			"warning",
		);
		return { switched: false, reason: "no-switchable-candidate" };
	}

	function maybeRestorePreFallback(ctx: ExtensionContext): void {
		const cfg = getAutoFallbackConfig();
		if (cfg.restoreMode === "manual") return;
		if (!preFallbackModel) return;
		if (!ctx.model) return;
		if (
			ctx.model.provider === preFallbackModel.provider &&
			ctx.model.id === preFallbackModel.modelId
		) {
			preFallbackModel = null;
			return;
		}
		const allModels =
			(ctx.modelRegistry as ModelRegistryLike | undefined)?.getAll?.() ?? [];
		const restoreModel = allModels.find(
			(m) =>
				m.provider === preFallbackModel?.provider &&
				m.id === preFallbackModel?.modelId,
		);
		if (!restoreModel) {
			preFallbackModel = null;
			return;
		}
		void safeSetModel(restoreModel).then((ok) => {
			if (ok) {
				_logger.info(
					`auto-fallback: restored ${preFallbackModel?.provider}/${preFallbackModel?.modelId} after recovery`,
				);
			}
			preFallbackModel = null;
		});
	}

	function clearHandledFailures(): void {
		if (handledFailureKeys.size > 64) handledFailureKeys.clear();
	}

	function noCandidatesAvailable(): boolean {
		const cfg = getAutoFallbackConfig();
		const registry = getProviderRegistry();
		const failingProvider = lastSeenCtx?.model?.provider;
		let hasAny = false;
		for (const [providerId, entry] of registry) {
			if (
				cfg.scope === "provider" &&
				providerId !== failingProvider
			) {
				continue;
			}
			if (
				cfg.scope === "whitelist" &&
				!cfg.whitelistProviders.includes(providerId)
			) {
				continue;
			}
			for (const m of entry.stored.free) {
				const key = modelKey(providerId, m.id);
				if (!blacklist.isBlacklisted(key)) {
					hasAny = true;
					break;
				}
			}
			if (hasAny) break;
		}
		return !hasAny;
	}

	async function safeSetModel(model: unknown): Promise<boolean> {
		if (!pi) return false;
		try {
			return await pi.setModel(model as Parameters<ExtensionAPI["setModel"]>[0]);
		} catch (err) {
			const name = err instanceof Error ? err.name : String(err);
			if (name === "AbortError") return false;
			_logger.warn("auto-fallback: setModel threw", {
				error: err instanceof Error ? err.message : String(err),
			});
			return false;
		}
	}

	/**
	 * Re-issue the captured user prompt on the now-active model. Called from
	 * `agent_settled` after a successful fallback switch. Pi has no turn-
	 * replay hook, so this is the only way to keep the conversation moving
	 * without the user manually re-sending. `expandPromptTemplates` is
	 * disabled to avoid surprising template expansion on a replay.
	 */
	function safeSendUserMessage(content: string | unknown[]): void {
		if (!pi) return;
		const sender = (pi as unknown as {
			sendUserMessage?: (
				content: unknown,
				options?: { expandPromptTemplates?: boolean },
			) => Promise<unknown> | void;
		}).sendUserMessage;
		if (typeof sender !== "function") return;
		try {
			void sender(content, { expandPromptTemplates: false });
		} catch (err) {
			_logger.warn("auto-fallback: sendUserMessage threw", {
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	return {
		register(extensionPi: ExtensionAPI) {
			pi = extensionPi;

			registerAutoFallbackCommands(extensionPi, {
				blacklist,
				getHistory: () => history.slice(),
				isEnabled: isAutoFallbackLive,
				isExhausted: () => blacklist.size() > 0 && noCandidatesAvailable(),
			});

			extensionPi.on("session_start", () => {
				handledFailureKeys.clear();
				pendingAutoContinue = null;
				lastUserPrompt = null;
				budgetInitialized = false;
			});

			extensionPi.on("agent_start", (_event, ctx) => {
				lastSeenCtx = ctx;
			});

			// Capture the user's most recent prompt so we can replay it on
			// the new model after an auto-fallback switch (see safeSendUserMessage).
			extensionPi.on(
				"before_agent_start",
				(event, ctx) => {
					lastSeenCtx = ctx;
					const e = event as { prompt?: string; images?: unknown[] };
					if (e && typeof e.prompt === "string") {
						lastUserPrompt = { text: e.prompt, images: e.images };
					}
				},
			);

			extensionPi.on(
				"after_provider_response",
				(event, ctx) => {
					lastSeenCtx = ctx;
					if (!isAutoFallbackLive()) return;
					const provider = ctx.model?.provider;
					const modelId = ctx.model?.id;
					if (!provider || !modelId) return;
					fallbackState.recordResponse(provider, modelId, event.status);
					const kind = classifyHttpStatus(event.status);
					if (kind === "recoverable" || kind === "unrecoverable") {
						blacklist.recordFailure(
							modelKey(provider, modelId),
							`http:${event.status}`,
						);
					}
				},
			);

			extensionPi.on("message_end", (event, ctx) => {
				lastSeenCtx = ctx;
				if (!isAutoFallbackLive()) return;
				const msg = (
					event as {
						message?: {
							provider?: string;
							model?: string;
							stopReason?: string;
							errorMessage?: string;
						};
					}
				).message;
				if (!msg) return;
				const provider = msg.provider ?? ctx.model?.provider;
				const modelId = msg.model ?? ctx.model?.id;
				if (!provider || !modelId) return;
				const classified = classifyAssistantFailure(
					msg.stopReason,
					msg.errorMessage,
				);
				if (!classified) return;
				blacklist.recordFailure(
					modelKey(provider, modelId),
					msg.stopReason === "aborted"
						? "abort"
						: msg.errorMessage?.slice(0, 80) ?? "error",
				);
			});

			extensionPi.on("agent_end", async (event, ctx) => {
				lastSeenCtx = ctx;
				clearHandledFailures();
				if (!isAutoFallbackLive()) return;
				const willRetry =
					(event as { willRetry?: boolean }).willRetry === true;
				if (willRetry) return;
				const messages = (
					event as {
						messages?: Array<{
							provider?: string;
							model?: string;
							stopReason?: string;
							errorMessage?: string;
						}>;
					}
				).messages;
				if (!Array.isArray(messages) || messages.length === 0) return;

				const lastAssistant = [...messages]
					.reverse()
					.find(
						(m) =>
							m.stopReason === "error" || m.stopReason === "aborted",
					);
				if (!lastAssistant) {
					// Successful turn (no error/aborted in any assistant
					// message). Refill the auto-continue budget so a future,
					// independent failure gets a fresh allowance rather than
					// being penalised by a previous failure chain.
					autoContinueBudget = getAutoFallbackConfig().autoContinueMax;
					budgetInitialized = true;
					return;
				}

				const provider = lastAssistant.provider ?? ctx.model?.provider;
				const modelId = lastAssistant.model ?? ctx.model?.id;
				if (!provider || !modelId) return;

				let failureReason = lastAssistant.stopReason ?? "error";
				const classified = classifyAssistantFailure(
					lastAssistant.stopReason,
					lastAssistant.errorMessage,
				);
				if (!classified) return;
				if (classified === "unrecoverable") return;

				// Abort refinement (Q23 = B): combine with last HTTP status.
				if (lastAssistant.stopReason === "aborted") {
					const lastStatus = fallbackState.getLastStatus(provider, modelId);
					const abortKind = classifyAbort(lastStatus);
					if (!abortKind) return; // user-initiated, not a failure
					if (abortKind === "unrecoverable") return;
					failureReason = `abort+http:${lastStatus ?? "?"}`;
				}

				const failureKey = `${provider}/${modelId}`;
				const turnIndex = (event as { turnIndex?: number }).turnIndex;
				const idemKey = `${failureKey}:${turnIndex ?? "?"}`;
				if (handledFailureKeys.has(idemKey)) return;
				handledFailureKeys.add(idemKey);

				await performSwitch(ctx, failureReason, failureKey, turnIndex);
			});

			extensionPi.on("agent_settled", async (_event, ctx) => {
				lastSeenCtx = ctx;
				if (!isAutoFallbackLive()) return;
				if (!ctx.model) return;
				const key = modelKey(ctx.model.provider, ctx.model.id);
				const entry = [...history].reverse().find((h) => h.toKey === key);
				if (entry && !entry.recovered) {
					entry.recovered = true;
					blacklist.clear(key);
					getNotifier().clearStatus();
					// Budget is refilled in agent_end on a successful turn
					// (not here on landing) so a chained-failure loop
					// depletes it instead of being reset every switch.
					maybeRestorePreFallback(ctx);
				}

				// Auto-continue: if we just switched due to a failure, replay
				// the captured prompt on the now-active model so the user
				// doesn't have to re-send manually. Pi has no turn-replay hook
				// (issue #1248, not_planned), so this is the only way to keep
				// the conversation moving. Bounded by autoContinueBudget to
				// prevent infinite auto-replay loops when many models fail in
				// a row.
				if (pendingAutoContinue) {
					const cfg = getAutoFallbackConfig();
					// Lazy first-time init: the recovery block already (re)sets
					// the budget when a prior switch recovered. For the very
					// first auto-continuation of a session there is no prior
					// recovery, so we seed the budget here from config.
					if (!budgetInitialized) {
						autoContinueBudget = cfg.autoContinueMax;
						budgetInitialized = true;
					}
					if (
						cfg.autoContinue &&
						autoContinueBudget > 0 &&
						lastUserPrompt &&
						lastUserPrompt.text
					) {
						autoContinueBudget--;
						const prompt = lastUserPrompt;
						const content: string | unknown[] =
							prompt.images && prompt.images.length > 0
								? [{ type: "text", text: prompt.text }, ...prompt.images]
								: prompt.text;
						_logger.info(
							`auto-fallback: auto-continuing on ${ctx.model.provider}/${ctx.model.id} (budget remaining: ${autoContinueBudget})`,
						);
						pendingAutoContinue = null;
						safeSendUserMessage(content);
					} else {
						pendingAutoContinue = null;
					}
				}
			});

			extensionPi.on("model_select", (_event, ctx) => {
				lastSeenCtx = ctx;
				if (preFallbackModel && ctx.model) {
					if (
						ctx.model.provider !== preFallbackModel.provider ||
						ctx.model.id !== preFallbackModel.modelId
					) {
						preFallbackModel = null;
					}
				}
			});
		},

		getStatus(): AutoFallbackStatus {
			const cfg = getAutoFallbackConfig();
			const last = history.length > 0 ? history[history.length - 1] : null;
			return {
				enabled: cfg.enabled,
				exhausted: blacklist.size() > 0 && noCandidatesAvailable(),
				blacklistSize: blacklist.size(),
				switchCount: history.length,
				lastSwitchAt: last?.at ?? null,
				lastSwitchReason: last?.reason ?? null,
			};
		},
	};
}