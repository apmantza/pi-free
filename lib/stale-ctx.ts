/**
 * Stale extension-context guard helpers (issue #509).
 *
 * Pi invalidates an extension runner's `ExtensionAPI` (`pi`) and every
 * `ExtensionContext` (`ctx`) it handed out as soon as the session is
 * replaced or reloaded (`ctx.newSession()`, `ctx.fork()`,
 * `ctx.switchSession()`, `ctx.reload()`, resume with replacement). From
 * that moment any `pi.*` call or lazy `ctx.*` getter access throws:
 *
 *   "This extension ctx is stale after session replacement or reload. ..."
 *
 * Extension event emission catches handler throws and surfaces them as a
 * user-visible `Extension error (...)`, and detached `session_start` work
 * that rejects is logged as `... detached failed`. Both are pure noise when
 * the cause is simply "the session moved on while async work was in
 * flight" — the follow-up to #393 (fixed for the toggle-opencode path by
 * #394) for the auto-fallback auto-continue path and the detached
 * built-in-toggle capture path.
 *
 * Rule: snapshot what you need from `ctx` synchronously at handler entry,
 * and treat a stale-context throw after an `await` as "session moved on" —
 * log at debug/info and stop work for the dead session instead of throwing.
 */

import { createLogger } from "./logger.ts";

const _logger = createLogger("stale-ctx");

/**
 * Distinctive fragment of Pi's session-replacement guard message. Matched
 * as a substring (not the full sentence) so minor upstream rewording does
 * not silently disable the guard.
 */
const STALE_CTX_FRAGMENT = "is stale after session replacement or reload";

/** True when `error` is Pi's stale extension-context guard (incl. causes). */
export function isStaleContextError(error: unknown): boolean {
 if (!(error instanceof Error)) return false;
 if (error.message.includes(STALE_CTX_FRAGMENT)) return true;
 const cause = (error as { cause?: unknown }).cause;
 return cause instanceof Error && cause.message.includes(STALE_CTX_FRAGMENT);
}

/** Minimal UI surface the safe helpers need (structurally matches pi's ctx). */
export interface NotifyUiLike {
 notify(message: string, type?: "info" | "warning" | "error"): void;
 setStatus(key: string, text: string | undefined): void;
}

export interface NotifyCtxLike {
 ui: NotifyUiLike;
}

function reportStale(action: string, error: unknown): void {
 _logger.debug(
  `stale extension context during ${action}; session moved on, skipping`,
  {
   error: error instanceof Error ? error.message : String(error),
  },
 );
}

/**
 * Best-effort `ctx.ui.notify` that never throws for a dead session — there
 * is no UI left to update. Non-stale errors are rethrown unchanged so real
 * bugs keep their existing visibility.
 */
export function safeNotify(
 ctx: NotifyCtxLike,
 message: string,
 type?: "info" | "warning" | "error",
): void {
 try {
  ctx.ui.notify(message, type);
 } catch (error) {
  if (!isStaleContextError(error)) throw error;
  reportStale("notify", error);
 }
}

/**
 * Best-effort `ctx.ui.setStatus` with the same dead-session semantics as
 * {@link safeNotify}.
 */
export function safeSetStatus(
 ctx: NotifyCtxLike,
 key: string,
 text: string | undefined,
): void {
 try {
  ctx.ui.setStatus(key, text);
 } catch (error) {
  if (!isStaleContextError(error)) throw error;
  reportStale("setStatus", error);
 }
}
