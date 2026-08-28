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
	selectFallbackModel,
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

	function candidatesFor(failingProvider: string): FallbackCandidate[] {
		const cfg = getAutoFallbackConfig();
		const scope: FallbackScope = cfg.scope;
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

		const selection = selectFallbackModel(provider, modelId, {
			scope: getAutoFallbackConfig().scope,
			whitelist: getAutoFallbackConfig().whitelistProviders,
			blacklist,
			getCandidates: () => candidatesFor(provider),
		});
		if (!selection) {
			blacklist.recordFailure(
				modelKey(provider, modelId),
				failureReason,
			);
			return { switched: false, reason: "no-candidate" };
		}

		// Resolve the actual Model object from the registry. setModel()
		// expects the registry's identity, not just ids.
		const allModels =
			(ctx.modelRegistry as ModelRegistryLike | undefined)?.getAll?.() ?? [];
		const newModel = allModels.find(
			(m) =>
				m.provider === selection.provider && m.id === selection.modelId,
		);
		if (!newModel) {
			blacklist.recordFailure(
				modelKey(provider, modelId),
				failureReason,
			);
			return { switched: false, reason: "candidate-not-in-catalog" };
		}

		// Record failure on the OLD key before switching.
		blacklist.recordFailure(modelKey(provider, modelId), failureReason);

		const ok = await safeSetModel(newModel);
		if (!ok) {
			return { switched: false, reason: "setModel-rejected" };
		}

		// Remember the user's original pick so we can (optionally) restore.
		if (!preFallbackModel) {
			preFallbackModel = { provider, modelId };
		}

		recordHistory({
			at: Date.now(),
			fromKey: modelKey(provider, modelId),
			toKey: modelKey(selection.provider, selection.modelId),
			reason: failureReason,
			recovered: false,
		});
		getNotifier().recordSwitch({
			fromKey: modelKey(provider, modelId),
			toKey: modelKey(selection.provider, selection.modelId),
			reason: failureReason,
			at: Date.now(),
		});
		_logger.info(
			`auto-fallback: switched ${modelKey(provider, modelId)} → ${modelKey(selection.provider, selection.modelId)} (reason=${failureReason})`,
		);

		const idemKey = `${failureKey}:${turnIndex ?? "?"}`;
		handledFailureKeys.add(idemKey);
		return { switched: true, reason: failureReason };
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
			});

			extensionPi.on("agent_start", (_event, ctx) => {
				lastSeenCtx = ctx;
			});

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
				if (!lastAssistant) return;

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
					maybeRestorePreFallback(ctx);
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