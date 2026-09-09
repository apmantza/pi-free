/**
 * In-memory ring of recent user-action outcomes (toggles, restores,
 * fallback switches, refresh nudges), surfaced read-only through
 * /pi-free-health. File-log carries the full trace; this ring is the
 * user-pasteable summary. No I/O, no TUI writes — the health command is
 * the only consumer-facing surface.
 */

import { getActiveRunId } from "./logger.ts";

export type ActionKind = "toggle" | "restore" | "fallback" | "refresh";

export interface ActionRecord {
	at: string;
	run: string | null;
	kind: ActionKind;
	summary: string;
}

const RING_CAP = 20;
const ring: ActionRecord[] = [];

/** Record one user-action outcome. Summaries stay short (health renders them). */
export function recordAction(kind: ActionKind, summary: string): void {
	ring.push({
		at: new Date().toISOString(),
		run: getActiveRunId(),
		kind,
		summary: summary.slice(0, 160),
	});
	if (ring.length > RING_CAP) ring.splice(0, ring.length - RING_CAP);
}

/** Newest-first copy of the ring (empty when nothing recorded yet). */
export function getRecentActions(): ActionRecord[] {
	const out: ActionRecord[] = [];
	for (let i = ring.length - 1; i >= 0; i--) out.push(ring[i]);
	return out;
}

/** Test seam: reset the ring. */
export function clearActions(): void {
	ring.length = 0;
}
