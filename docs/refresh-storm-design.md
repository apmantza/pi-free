# Refresh-storm design (refs #573)

## Problem

Pi's `setProvider` does three things inseparably (verified against the
installed pi-coding-agent bundle, `ModelsImpl` + `ModelRuntime`):

1. `supersedeProviderRefresh(id)` — aborts that provider's in-flight
   refresh generation;
2. `updateModelSnapshot()` — re-reads `getModels()` live for `/model`;
3. an offline `refresh({allowNetwork: false})` (restore phase).

pi-free re-registers providers from extension load, toggle
captures/restores, and probe completions. When those land inside the
session-start nudge's fetch window, the fetch dies and — pre-fix —
nothing ever published (stale catalogs, `refresh ok 0`, `2 aborts`).

## Current defense (shipped, TLC-verified)

Bounded backoff (5s/15s/30s) + completion-stamp check + epoch guard
(`lib/native-provider.ts`). `tla/RefreshB` + `tla/RefreshR-B` hold
exhaustively iff per-session storm <= 3 kills; production showed
exactly 2. The storm is absorbed, not suppressed.

## What was tried and reverted

Skipping `setProvider` for identical provider references. It kills the
abort (step 1) but also skips the snapshot sync and offline refresh
(steps 2–3), which `/model` rendering depends on — re-publish is
load-bearing, pinned by the kilo/cline/llm7 reRegister wiring tests.
Do not retry this without a replacement snapshot-sync path.

## Options if storms grow past the boundary

**Stay the course (recommended while observed aborts/session <= 3).**
No new mechanism; the backoff absorbs the storm. Metric already exists:
per-provider abort counters in startup-timing, surfaced by
`/pi-free-health` (`2 aborts` flags).

**Session-start barrier batching.** Collect dirty providers during the
capture phase and re-register them in one pass after captures settle,
instead of once per handler. Cuts storm events from O(handlers) to one
burst — still aborts a single generation, which the backoff absorbs.
Costs: a coordination point across toggle/probe/capture paths, and
briefly delayed snapshot sync (seconds). Probe completions are
unbounded in time, so the barrier needs a deadline; completion-time
re-registers stay for genuinely changed catalogs (compare id-sets,
cheap) and skip for identical ones. Adopt if sustained aborts/session
exceed 3.

**Upstream Pi API (long-term).** What we actually need is snapshot-sync
without supersede: either a `syncSnapshot()` entry point or a
`setProvider(p, {preserveRefresh: true})` option for identical
references. Any such API must preserve effects 2–3 above, not just skip
`setProvider`. File upstream; not blocking.

## Explicit non-goals

- Fetch-on-toggle (a second refresh initiator reintroduces abort
  pressure against the nudge).
- Unbounded retries (repeat the same race; the storm budget argument in
  `tla/README.md` shows why 1+3 is the right shape).
- Blocking a toggle on refresh completion (toggles are synchronous UX;
  staleness is flagged, not gated — `StoredModels.complete`).
