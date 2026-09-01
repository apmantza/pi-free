/**
 * Registration point for the auto-fallback status accessor.
 *
 * Breaks the `index.ts` ↔ `lib/health.ts` import cycle: `index.ts` (or
 * whichever module wires the extension) registers the handle here at
 * setup time, and `lib/health.ts` reads it from here instead of importing
 * `index.ts` back. The value is intentionally a live lookup, not a
 * snapshot, so `/pi-free-health` always reports current state even after
 * an extension reload replaces the handle.
 */

import type { AutoFallbackHandle } from "./auto-fallback/index.ts";

let getAutoFallbackHandle: (() => AutoFallbackHandle | undefined) | undefined;

/** Register (or replace) the status accessor. Called from `index.ts` setup. */
export function registerAutoFallbackStatusGetter(
 getter: () => AutoFallbackHandle | undefined,
): void {
 getAutoFallbackHandle = getter;
}

/** Read the current handle, or undefined when the extension isn't wired yet. */
export function getAutoFallback(): AutoFallbackHandle | undefined {
 return getAutoFallbackHandle?.();
}
